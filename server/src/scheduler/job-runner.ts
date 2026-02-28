import { v4 as uuidv4 } from 'uuid';
import type { LLMRouter } from '../ai/router.js';
import type { MainDatabase, ScheduledJob } from '../storage/main-db.js';
import type { LLMMessage } from '@local-agent/shared';
import { mcpManager, getMcpAdapter } from '../mcp/index.js';
import { notifyScheduledJobCompletion } from '../discord/bot.js';

export class JobRunner {
  private static readonly MAX_ITERATIONS = 8;

  constructor(
    private readonly llmRouter: LLMRouter,
    private readonly db: MainDatabase,
    private readonly executeTool: (
      userId: string,
      toolName: string,
      args: Record<string, unknown>,
      roleId?: string,
    ) => Promise<{ text: string }>,
  ) {}

  async run(job: ScheduledJob): Promise<void> {
    const role = this.db.getRole(job.roleId);
    const systemPrompt = [
      'You are an autonomous AI agent executing a scheduled background task.',
      `Current time: ${new Date().toISOString()}`,
      'Execute the task completely using available tools. Do not ask for clarification.',
      role?.systemPrompt ? `\nRole context: ${role.systemPrompt}` : '',
    ].filter(Boolean).join('\n');

    const allTools = await mcpManager.listAllTools();
    const mcpTools = allTools.flatMap(({ tools: t }) => t);

    // Role-scoped servers (memory, scheduler) are not in mcpManager.listAllTools()
    // because they are created on-demand per role. Fetch their tools explicitly.
    const roleScopedServerIds = ['memory', 'scheduler'];
    for (const serverId of roleScopedServerIds) {
      try {
        const adapter = await getMcpAdapter(job.userId, serverId, job.roleId);
        const roleTools = await adapter.listTools();
        mcpTools.push(...roleTools);
        console.log(`[JobRunner] Job ${job.id} — loaded ${roleTools.length} tools from role-scoped '${serverId}'`);
      } catch (err) {
        console.warn(`[JobRunner] Job ${job.id} — could not load tools from '${serverId}':`, err);
      }
    }

    const tools = this.llmRouter.convertMCPToolsToOpenAI(mcpTools);

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: job.description },
    ];

    for (let i = 0; i < JobRunner.MAX_ITERATIONS; i++) {
      console.log(`[JobRunner] Job ${job.id} — iteration ${i + 1}/${JobRunner.MAX_ITERATIONS}`);
      const response = await this.llmRouter.complete({ messages, tools });
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
      const results = await Promise.all(
        toolCalls.map(tc =>
          this.executeTool(job.userId, tc.name, tc.arguments as Record<string, unknown>, job.roleId)
            .then(r => {
              console.log(`[JobRunner] Job ${job.id} — tool ${tc.name} result: ${r.text.slice(0, 100)}...`);
              return r.text;
            })
            .catch(e => {
              const msg = `Error: ${(e as Error).message}`;
              console.error(`[JobRunner] Job ${job.id} — tool ${tc.name} failed:`, e);
              return msg;
            }),
        ),
      );
      messages.push({ role: 'user', content: results.join('\n\n') });
    }

    // Save job output to role's chat history so user sees it when they open chat
    const now = new Date().toISOString();
    const shortDesc = job.description.length > 60
      ? job.description.slice(0, 60) + '…'
      : job.description;

    this.db.saveMessage({
      id: uuidv4(),
      userId: job.userId,
      roleId: job.roleId,
      groupId: null,
      role: 'system',
      content: `*Scheduled job: ${shortDesc}*`,
      createdAt: now,
    });

    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
    if (lastAssistant?.content) {
      this.db.saveMessage({
        id: uuidv4(),
        userId: job.userId,
        roleId: job.roleId,
        groupId: null,
        role: 'assistant',
        content: lastAssistant.content,
        createdAt: new Date().toISOString(),
      });
    }

    // Send Discord notification if bot is configured
    const roleInfo = this.db.getRole(job.roleId);
    if (roleInfo) {
      await notifyScheduledJobCompletion(job.userId, roleInfo.name, job.description).catch(err => {
        console.error('[JobRunner] Failed to send Discord notification:', err);
      });
    }
  }
}
