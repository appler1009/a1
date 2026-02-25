import Anthropic from '@anthropic-ai/sdk';
import type { MCPToolInfo } from '@local-agent/shared';
import type { InProcessMCPModule } from '../adapters/InProcessAdapter.js';

const MODEL = 'claude-haiku-4-5-20251001';
const CONCURRENCY = 5; // max parallel item fetches + analyses

export class ProcessEachInProcess implements InProcessMCPModule {
  private anthropic = new Anthropic();

  // Required index signature so TypeScript accepts this as InProcessMCPModule
  [key: string]: unknown;

  getTools(): MCPToolInfo[] {
    return [
      {
        name: 'processEach',
        description:
          'Process a list of items (email IDs, file IDs, etc.) one at a time using a focused AI call per item. ' +
          'Use this when you have many items to analyze and want to avoid context overflow. ' +
          'Each item is fetched via the specified tool and analyzed independently with a small model. ' +
          'Returns a compact JSON array of per-item results that fit in this context window.',
        inputSchema: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of item IDs or values to process (e.g., Gmail message IDs)',
            },
            tool: {
              type: 'string',
              description: 'MCP tool name to call for each item to fetch its content (e.g., "gmailGetMessage")',
            },
            toolArg: {
              type: 'string',
              description: 'Argument name to pass each item value as to the fetch tool (e.g., "id" for gmailGetMessage)',
            },
            task: {
              type: 'string',
              description:
                'What to extract or determine from each item\'s content. Be specific. ' +
                'E.g.: "Does this email mention an invoice? If yes return the invoice number, otherwise return null."',
            },
            accountEmail: {
              type: 'string',
              description: 'Optional: which account to use when calling the fetch tool',
            },
          },
          required: ['items', 'tool', 'toolArg', 'task'],
        },
      },
    ];
  }

  async processEach(args: {
    items: string[];
    tool: string;
    toolArg: string;
    task: string;
    accountEmail?: string;
  }): Promise<{ type: 'text'; text: string }> {
    const { items, tool, toolArg, task, accountEmail } = args;

    if (!items || items.length === 0) {
      return { type: 'text', text: JSON.stringify([]) };
    }

    console.log(`[ProcessEach] Starting: ${items.length} items, tool=${tool}, toolArg=${toolArg}`);

    // Dynamic import avoids the circular dep:
    //   manager.ts → registry.ts → process-each.ts → manager.ts
    const { mcpManager } = await import('../manager.js');
    const { toolCache } = await import('../tool-cache.js');

    // Resolve the serverId for the fetch tool once (not per-item)
    const cachedEntry = toolCache.findToolServer(tool);
    if (!cachedEntry) {
      // Tool not yet cached — scan all servers once to warm the cache
      const found = await mcpManager.findTool(tool);
      if (!found) {
        return { type: 'text', text: JSON.stringify({ error: `Unknown tool: ${tool}` }) };
      }
    }
    const serverId = toolCache.findToolServer(tool)?.serverId;
    if (!serverId) {
      return { type: 'text', text: JSON.stringify({ error: `Could not resolve serverId for tool: ${tool}` }) };
    }

    console.log(`[ProcessEach] Tool "${tool}" is on server "${serverId}"`);

    // Process items in batches to limit concurrency
    const results: Array<{ item: string; result?: string | null; error?: string }> = [];

    for (let i = 0; i < items.length; i += CONCURRENCY) {
      const batch = items.slice(i, i + CONCURRENCY);
      console.log(`[ProcessEach] Batch ${Math.floor(i / CONCURRENCY) + 1}: items ${i + 1}–${i + batch.length}`);

      const batchResults = await Promise.all(
        batch.map(item => this.processOneItem(mcpManager, serverId, tool, toolArg, item, task, accountEmail))
      );
      results.push(...batchResults);
    }

    console.log(`[ProcessEach] Done. ${results.length} results.`);
    return { type: 'text', text: JSON.stringify(results, null, 2) };
  }

  private async processOneItem(
    mcpManager: { callTool(serverId: string, name: string, args: Record<string, unknown>): Promise<unknown> },
    serverId: string,
    tool: string,
    toolArg: string,
    item: string,
    task: string,
    accountEmail?: string
  ): Promise<{ item: string; result?: string | null; error?: string }> {
    // Step 1: Fetch the item's content
    const fetchArgs: Record<string, unknown> = { [toolArg]: item };
    if (accountEmail) fetchArgs.accountEmail = accountEmail;

    let content: string;
    try {
      const toolResult = await mcpManager.callTool(serverId, tool, fetchArgs);

      // callTool returns unknown — normalise to string
      if (toolResult && typeof toolResult === 'object') {
        const r = toolResult as Record<string, unknown>;
        if (r.type === 'error') return { item, error: String(r.error) };
        content = r.type === 'text' ? String(r.text ?? '') : JSON.stringify(toolResult);
      } else {
        content = String(toolResult ?? '');
      }
    } catch (err) {
      return { item, error: String(err) };
    }

    if (!content || content === '[]' || content === 'null' || content.trim() === '') {
      return { item, result: null };
    }

    // Step 2: Analyze with a small, fast LLM call
    try {
      const response = await this.anthropic.messages.create({
        model: MODEL,
        max_tokens: 256,
        messages: [
          {
            role: 'user',
            content:
              `<content>\n${content.slice(0, 8000)}\n</content>\n\n` +
              `Task: ${task}\n\n` +
              `Be concise. Answer only what was asked.`,
          },
        ],
      });

      const text =
        response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
      return { item, result: text };
    } catch (err) {
      return { item, error: `LLM error: ${String(err)}` };
    }
  }
}
