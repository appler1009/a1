import { v4 as uuidv4 } from 'uuid';
import type { LLMRouter } from '../ai/router.js';
import type { IMainDatabase, ScheduledJob } from '../storage/main-db.js';
import type { LLMMessage } from '@local-agent/shared';
import { mcpManager } from '../mcp/index.js';
import { updateToolManifest } from '../mcp/in-process/meta-mcp-search.js';
import { notifyScheduledJobCompletion } from '../discord/bot.js';
import { getByokRouter } from '../utils/byok.js';

// Tools never surfaced to a scheduled job runner via search_tool
const JOB_RUNNER_EXCLUDED_TOOLS = ['schedule_task', 'list_scheduled_jobs', 'list_roles', 'switch_role'];

// Block a tool that appears this many consecutive times in a row
const MAX_CONSECUTIVE_SAME_TOOL = 2;

// Phase 1 base tools always available to the job runner
const SEARCH_TOOL_DEF = {
  name: 'search_tool',
  description: `Search for MCP tools using natural language. Call this FIRST to discover tools for your task.
Examples: "get weather forecast", "fetch a web page", "search email"
The system will make the recommended tools available immediately after this call.`,
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Natural language description of what you want to accomplish' },
      limit: { type: 'number', default: 5, description: 'Maximum results to return (default: 5)' },
    },
    required: ['query'],
  },
  serverId: 'meta-mcp-search',
};

const MEMORY_BASE_TOOLS = [
  {
    name: 'memory_search_nodes',
    description: 'Search the knowledge graph for relevant entities and observations about this role.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search query' } }, required: ['query'] },
    serverId: 'memory',
  },
  {
    name: 'memory_read_graph',
    description: 'Read all entities and observations from the knowledge graph.',
    inputSchema: { type: 'object', properties: {} },
    serverId: 'memory',
  },
  {
    name: 'memory_open_nodes',
    description: 'Retrieve specific entities by name from the knowledge graph.',
    inputSchema: { type: 'object', properties: { names: { type: 'array', items: { type: 'string' }, description: 'Entity names to retrieve' } }, required: ['names'] },
    serverId: 'memory',
  },
];

export class JobRunner {
  private static readonly MAX_ITERATIONS = 8;

  constructor(
    private readonly llmRouter: LLMRouter,
    private readonly db: IMainDatabase,
    private readonly executeTool: (
      userId: string,
      toolName: string,
      args: Record<string, unknown>,
      roleId?: string,
    ) => Promise<{ text: string }>,
  ) {}

  async run(job: ScheduledJob, llmRouter?: LLMRouter): Promise<void> {
    const router = llmRouter ?? this.llmRouter;
    const role = await this.db.getRole(job.roleId);
    const systemPrompt = [
      'You are an autonomous AI agent executing a scheduled background task.',
      `Current time: ${new Date().toISOString()}`,
      'Start by calling search_tool to find the tools you need, then use those tools to complete the task.',
      'Execute the task completely and provide a full summary. Do not ask for clarification.',
      'Once you have retrieved the data you need, compile your response immediately — do not call the same tool again.',
      'CRITICAL: Do NOT call schedule_task. You are inside a scheduled job — scheduling new jobs creates unwanted duplicates.',
      role?.systemPrompt ? `\nRole context: ${role.systemPrompt}` : '',
    ].filter(Boolean).join('\n');

    // Load all tools into the search manifest and build a lookup for Phase 2
    const allMcpTools = await mcpManager.listAllTools();
    await updateToolManifest(allMcpTools);
    const allToolsFlat = allMcpTools.flatMap(({ serverId, tools }) => tools.map(t => ({ ...t, serverId })));
    console.log(`[JobRunner] Job ${job.id} — ${allToolsFlat.length} tools indexed for search`);

    // Phase 1: search_tool + memory base tools
    const phase1Defs = [SEARCH_TOOL_DEF, ...MEMORY_BASE_TOOLS];
    let currentTools = router.convertMCPToolsToOpenAI(phase1Defs);
    let hasLoadedPhase2Tools = false;
    console.log(`[JobRunner] Job ${job.id} — Phase 1 tools: ${phase1Defs.map(t => t.name).join(', ')}`);

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: job.description },
    ];

    let lastToolName: string | null = null;
    let consecutiveToolCount = 0;
    const toolCallLog: Array<{ name: string; createdAt: string }> = [];

    for (let i = 0; i < JobRunner.MAX_ITERATIONS; i++) {
      console.log(`[JobRunner] Job ${job.id} — iteration ${i + 1}/${JobRunner.MAX_ITERATIONS}`);
      const response = await router.complete({ messages, tools: currentTools, userId: job.userId, source: 'scheduler' });
      const toolCalls = response.toolCalls || [];

      if (response.content) {
        console.log(`[JobRunner] Job ${job.id} — AI response: ${response.content.slice(0, 100)}...`);
        messages.push({ role: 'assistant', content: response.content });
      }

      if (toolCalls.length === 0) {
        console.log(`[JobRunner] Job ${job.id} — no tool calls, execution complete`);
        break;
      }

      console.log(`[JobRunner] Job ${job.id} — executing ${toolCalls.length} tool(s): ${toolCalls.map(t => t.name).join(', ')}`);

      const results: string[] = [];
      for (const tc of toolCalls) {
        // Loop detection: block if the same tool is called too many times in a row
        if (tc.name === lastToolName) {
          consecutiveToolCount++;
          if (consecutiveToolCount > MAX_CONSECUTIVE_SAME_TOOL) {
            const blocked = `[Scheduler] "${tc.name}" has been called ${consecutiveToolCount} times consecutively. Stop calling this tool and compile your final response from the data already retrieved.`;
            console.warn(`[JobRunner] Job ${job.id} — loop detected, blocking ${tc.name} (call #${consecutiveToolCount})`);
            results.push(blocked);
            continue;
          }
        } else {
          lastToolName = tc.name;
          consecutiveToolCount = 1;
        }

        // Inject excluded_tools for search_tool calls so hidden tools never appear
        const args = tc.name === 'search_tool'
          ? { ...(tc.arguments as Record<string, unknown>), excluded_tools: JOB_RUNNER_EXCLUDED_TOOLS }
          : tc.arguments as Record<string, unknown>;

        try {
          toolCallLog.push({ name: tc.name, createdAt: new Date().toISOString() });
          const r = await this.executeTool(job.userId, tc.name, args, job.roleId);
          console.log(`[JobRunner] Job ${job.id} — tool ${tc.name} result: ${r.text.slice(0, 100)}...`);

          // Phase 2: after search_tool returns, expand available tools based on results
          if (tc.name === 'search_tool' && !hasLoadedPhase2Tools) {
            const toolNameMatches = r.text.matchAll(/\d+\.\s+\*\*([a-zA-Z0-9_]+)\*\*/g);
            const phase2Defs: Array<{ name: string; description: string; inputSchema: Record<string, unknown>; serverId: string }> = [SEARCH_TOOL_DEF, ...MEMORY_BASE_TOOLS];
            for (const match of toolNameMatches) {
              const toolName = match[1];
              if (JOB_RUNNER_EXCLUDED_TOOLS.includes(toolName)) continue;
              const found = allToolsFlat.find(t => t.name === toolName);
              if (found) {
                phase2Defs.push({ ...found, description: found.description ?? '' });
                console.log(`[JobRunner] Job ${job.id} — Phase 2 adding: ${toolName}`);
              }
            }
            hasLoadedPhase2Tools = true;
            currentTools = router.convertMCPToolsToOpenAI(phase2Defs);
            console.log(`[JobRunner] Job ${job.id} — Phase 2 tools: ${phase2Defs.map(t => t.name).join(', ')}`);
          }

          results.push(r.text);
        } catch (e) {
          const msg = `Error: ${(e as Error).message}`;
          console.error(`[JobRunner] Job ${job.id} — tool ${tc.name} failed:`, e);
          results.push(msg);
        }
      }

      messages.push({ role: 'user', content: results.join('\n\n') });
    }

    // Save tool calls and final response to role's chat history
    for (const tc of toolCallLog) {
      const label = tc.name.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/\s+/g, ' ').toLowerCase().trim();
      await this.db.saveMessage({
        id: uuidv4(),
        userId: job.userId,
        roleId: job.roleId,
        groupId: null,
        from: 'tool' as const,
        content: `*${label}*`,
        createdAt: tc.createdAt,
      });
    }

    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
    if (lastAssistant?.content) {
      await this.db.saveMessage({
        id: uuidv4(),
        userId: job.userId,
        roleId: job.roleId,
        groupId: null,
        from: 'system' as const,
        content: lastAssistant.content,
        createdAt: new Date().toISOString(),
      });
    }

    // Send Discord notification if bot is configured
    const roleInfo = await this.db.getRole(job.roleId);
    if (roleInfo) {
      await notifyScheduledJobCompletion(job.userId, roleInfo.name, job.description).catch(err => {
        console.error('[JobRunner] Failed to send Discord notification:', err);
      });
    }
  }

  /**
   * Run a job and manage its DB lifecycle (status, lastRunAt, error messages).
   * Called by the dispatch endpoint after the Lambda sends its decisions.
   */
  async execute(job: ScheduledJob): Promise<void> {
    console.log(`[JobRunner] Running job ${job.id}: ${job.description.slice(0, 60)}`);

    // Resolve BYOK router for this user — falls back to null (system router used below)
    const [user, byokRouter] = await Promise.all([
      this.db.getUser(job.userId),
      getByokRouter(job.userId),
    ]);
    const hasByok = byokRouter !== null;
    const hasCreditBalance = (user?.creditBalanceUsd ?? 0) >= 0.001;
    if (!hasByok && !hasCreditBalance) {
      console.warn(`[JobRunner] Job ${job.id} skipped — insufficient credits ($${(user?.creditBalanceUsd ?? 0).toFixed(4)} remaining)`);
      await this.db.saveMessage({
        id: uuidv4(),
        userId: job.userId,
        roleId: job.roleId,
        groupId: null,
        from: 'system' as const,
        content: `**Scheduled task skipped:** Your credit balance is empty ($${(user?.creditBalanceUsd ?? 0).toFixed(4)} remaining). Please top up your account under Settings → Billing to continue.`,
        createdAt: new Date().toISOString(),
      });
      return;
    }

    await this.db.updateScheduledJobStatus(job.id, { status: 'running', holdUntil: null });
    try {
      await this.run(job, byokRouter ?? undefined);
      const status = job.scheduleType === 'once' ? 'completed' : 'pending';
      await this.db.updateScheduledJobStatus(job.id, {
        status,
        lastRunAt: new Date(),
        runCount: job.runCount + 1,
      });
      console.log(`[JobRunner] Job ${job.id} completed, status → ${status}`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await this.db.updateScheduledJobStatus(job.id, {
        status: 'failed',
        lastError: errorMsg,
        lastRunAt: new Date(),
        runCount: job.runCount + 1,
        holdUntil: null,
      });
      console.error(`[JobRunner] Job ${job.id} failed:`, err);

      await this.db.saveMessage({
        id: uuidv4(),
        userId: job.userId,
        roleId: job.roleId,
        groupId: null,
        from: 'system' as const,
        content: `**Error running scheduled task:**\n\`\`\`\n${errorMsg}\n\`\`\``,
        createdAt: new Date().toISOString(),
      });
    }
  }
}
