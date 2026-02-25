import type { McpAdapter, CallToolResult, MCPToolInfo, MCPResource } from '@local-agent/shared';
import type { InProcessMCPModule } from './InProcessAdapter.js';

/**
 * Inject an `accountEmail` parameter into a tool's inputSchema.
 * This lets the AI specify which account to use when calling the tool.
 */
function injectAccountEmailParam(schema: Record<string, unknown>, emails: string[]): Record<string, unknown> {
  const existingProps = (schema.properties as Record<string, unknown>) || {};
  return {
    ...schema,
    properties: {
      accountEmail: {
        type: 'string',
        description: `Which account to use. Available: ${emails.join(', ')}. Omit to search all accounts.`,
        enum: emails,
      },
      ...existingProps,
    },
  };
}

/**
 * MultiAccountAdapter — aggregates multiple same-service accounts into one adapter.
 *
 * Exposes a single tool set to the AI. Each tool has an injected `accountEmail`
 * parameter so the AI can direct the call to the right account.
 *
 * When `accountEmail` is omitted, the tool is called on ALL accounts and results
 * are merged (arrays concatenated; non-arrays labeled by account).
 *
 * Example: two Gmail accounts → one `gmailSearchMessages` tool with
 *   accountEmail: { enum: ['alice@gmail.com', 'bob@gmail.com'] }
 */
export class MultiAccountAdapter implements McpAdapter {
  readonly id: string;
  readonly userId: string = 'multi-account';
  readonly serverKey: string;

  private accounts = new Map<string, InProcessMCPModule>(); // email → module

  constructor(id: string, serverKey: string) {
    this.id = id;
    this.serverKey = serverKey;
  }

  addAccount(email: string, module: InProcessMCPModule): void {
    this.accounts.set(email, module);
    console.log(`[MultiAccountAdapter:${this.serverKey}] Added account: ${email} (total: ${this.accounts.size})`);
  }

  removeAccount(email: string): void {
    this.accounts.delete(email);
    console.log(`[MultiAccountAdapter:${this.serverKey}] Removed account: ${email}`);
  }

  getAccountEmails(): string[] {
    return Array.from(this.accounts.keys());
  }

  // ---- McpAdapter lifecycle ----

  async connect(): Promise<void> {
    // In-process: nothing to connect
  }

  async reconnect(): Promise<void> {
    // In-process: nothing to reconnect
  }

  isConnected(): boolean {
    return this.accounts.size > 0;
  }

  close(): void {
    this.accounts.clear();
  }

  // ---- Tools ----

  async listTools(): Promise<MCPToolInfo[]> {
    if (this.accounts.size === 0) return [];

    const emails = this.getAccountEmails();
    const firstModule = this.accounts.get(emails[0])!;
    const rawTools = await firstModule.getTools();

    return rawTools.map(tool => ({
      name: tool.name,
      description: tool.description || '',
      inputSchema: injectAccountEmailParam(tool.inputSchema || {}, emails),
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    if (this.accounts.size === 0) {
      return { type: 'error', error: `No accounts connected for ${this.serverKey}` };
    }

    const emails = this.getAccountEmails();
    // Accept both 'accountEmail' and 'account' as the routing parameter
    const specifiedEmail = (args.accountEmail ?? args.account) as string | undefined;

    // Strip both routing param variants before forwarding to the underlying module
    const { accountEmail: _a, account: _b, ...restArgs } = args;

    if (specifiedEmail) {
      // Route to the specified account only
      const module = this.accounts.get(specifiedEmail) ?? this.accounts.get(emails[0])!;
      console.log(`[MultiAccountAdapter:${this.serverKey}] callTool ${name} → account: ${specifiedEmail}`);
      return this.callOneModule(module, name, restArgs);
    }

    // No account specified — fan out to all accounts in parallel
    console.log(`[MultiAccountAdapter:${this.serverKey}] callTool ${name} → all ${emails.length} accounts`);

    const results = await Promise.all(
      emails.map(async email => {
        const module = this.accounts.get(email)!;
        const result = await this.callOneModule(module, name, restArgs);
        return { email, result };
      })
    );

    return this.mergeResults(results);
  }

  // ---- Resources (not supported for multi-account) ----

  async listResources(): Promise<MCPResource[]> {
    return [];
  }

  async readResource(_uri: string): Promise<unknown> {
    throw new Error(`Resource reading not supported by MultiAccountAdapter (${this.serverKey})`);
  }

  // ---- Internal ----

  private async callOneModule(
    module: InProcessMCPModule,
    name: string,
    args: Record<string, unknown>
  ): Promise<CallToolResult> {
    try {
      const fn = module[name];
      if (typeof fn !== 'function') {
        throw new Error(`Tool '${name}' not found in module ${this.serverKey}`);
      }
      const result = await (fn as Function).call(module, args);
      return this.normalizeResult(result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[MultiAccountAdapter:${this.serverKey}] Error calling ${name}:`, errorMsg);
      return { type: 'error', error: errorMsg };
    }
  }

  /**
   * Merge results from multiple accounts.
   * - If results are JSON arrays: concatenate them, tagging each item with `_account`.
   * - Otherwise (e.g., gmailGetMessage): return the first non-error result.
   *   This lets the AI call single-item tools without specifying accountEmail and
   *   get back the correct result regardless of which account holds the item.
   */
  private mergeResults(results: { email: string; result: CallToolResult }[]): CallToolResult {
    // Try to parse each result as a JSON array
    const parsed = results.map(({ email, result }) => {
      if (result.type === 'error') {
        return { email, items: null as unknown[] | null, error: result.error, rawResult: result };
      }
      const text = result.type === 'text' ? (result.text ?? '') : '';
      try {
        const data = JSON.parse(text);
        if (Array.isArray(data)) {
          // Tag each item with its source account
          const items = data.map((item: unknown) =>
            item && typeof item === 'object'
              ? { ...(item as object), _account: email }
              : { value: item, _account: email }
          );
          return { email, items, error: undefined as string | undefined, rawResult: result };
        }
      } catch {
        // Not a JSON array
      }
      return { email, items: null as unknown[] | null, rawResult: result, error: undefined as string | undefined };
    });

    const arrayResults  = parsed.filter(p => p.items !== null && !p.error);
    const errorResults  = parsed.filter(p => p.error);
    const successResults = parsed.filter(p => !p.error);

    if (arrayResults.length === results.length) {
      // All results are arrays — merge into one
      const merged = arrayResults.flatMap(p => p.items!);
      return { type: 'text', text: JSON.stringify(merged) };
    }

    if (arrayResults.length > 0) {
      // Some arrays — merge them, note any errors
      const merged = arrayResults.flatMap(p => p.items!);
      const errorNote = errorResults.length > 0
        ? `\n\nErrors: ${errorResults.map(p => `${p.email}: ${p.error}`).join('; ')}`
        : '';
      return { type: 'text', text: JSON.stringify(merged) + errorNote };
    }

    // No arrays (e.g., gmailGetMessage, gmailArchiveMessage) —
    // return the first non-error result so the call succeeds regardless of which
    // account holds the item.
    if (successResults.length > 0) {
      return successResults[0].rawResult;
    }

    // All accounts errored
    const combined = errorResults.map(p => `[${p.email}] ${p.error}`).join('\n');
    return { type: 'error', error: combined };
  }

  private normalizeResult(result: unknown): CallToolResult {
    if (result && typeof result === 'object') {
      const r = result as Record<string, unknown>;

      if (r.type === 'text' || r.type === 'image' || r.type === 'resource' || r.type === 'error') {
        return result as CallToolResult;
      }

      if ('content' in r && Array.isArray(r.content)) {
        const content = r.content[0];
        if (content && typeof content === 'object') {
          if ('text' in content) return { type: 'text', text: content.text as string };
          if ('error' in content) return { type: 'error', error: String(content.error) };
        }
        return { type: 'text', text: JSON.stringify(r.content) };
      }

      if ('text' in r) return { type: 'text', text: String(r.text) };
      if ('error' in r) return { type: 'error', error: String(r.error) };
    }

    if (typeof result === 'string') return { type: 'text', text: result };

    return { type: 'text', text: JSON.stringify(result) };
  }
}
