import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpAdapter, CallToolResult } from '@local-agent/shared';
import type { MCPToolInfo, MCPResource } from '@local-agent/shared';

/**
 * Base adapter for all stdio-based MCP servers
 * Subclasses can override prepare() to customize token/env setup
 */
export abstract class BaseStdioAdapter implements McpAdapter {
  protected client: Client;
  protected transport: StdioClientTransport;
  protected _isConnected = false;

  readonly id: string;
  readonly userId: string;
  readonly serverKey: string;

  constructor(
    id: string,
    userId: string,
    serverKey: string,
    protected command: string,
    protected args: string[],
    protected cwd: string,
    protected env: Record<string, string> = {}
  ) {
    this.id = id;
    this.userId = userId;
    this.serverKey = serverKey;

    this.transport = new StdioClientTransport({
      command,
      args,
      cwd,
      env: { ...process.env, ...env } as Record<string, string>,
    });

    this.client = new Client({ name: 'agent-ui', version: '1.0.0' });
  }

  /**
   * Hook for subclasses to prepare MCP-specific setup
   * Called before connecting (e.g., write token files, set env vars)
   */
  protected async prepare(): Promise<void> {
    // Override in subclasses
  }

  async connect(): Promise<void> {
    try {
      console.log(`[BaseStdioAdapter:connect] Connecting adapter: ${this.id}`);
      console.log(`[BaseStdioAdapter:connect] Server key: ${this.serverKey}`);
      console.log(`[BaseStdioAdapter:connect] Command: ${this.command}`);
      console.log(`[BaseStdioAdapter:connect] Args: ${JSON.stringify(this.args)}`);
      console.log(`[BaseStdioAdapter:connect] CWD: ${this.cwd}`);
      console.log(`[BaseStdioAdapter:connect] Calling prepare()...`);

      await this.prepare();

      console.log(`[BaseStdioAdapter:connect] prepare() completed`);

      // Log custom environment variables (excluding npm vars)
      const customEnvKeys = Object.keys(this.env).filter(k => !k.startsWith('npm'));
      console.log(`[BaseStdioAdapter:connect] Custom env vars (${customEnvKeys.length}):`, customEnvKeys);

      // Log specific token-related env vars
      if (this.env.GOOGLE_DRIVE_MCP_TOKEN_PATH) {
        console.log(`[BaseStdioAdapter:connect] GOOGLE_DRIVE_MCP_TOKEN_PATH: ${this.env.GOOGLE_DRIVE_MCP_TOKEN_PATH}`);
      }
      if (this.env.ANTHROPIC_API_KEY) {
        console.log(`[BaseStdioAdapter:connect] ANTHROPIC_API_KEY: ${this.env.ANTHROPIC_API_KEY.substring(0, 10)}...`);
      }

      // Create merged environment
      const mergedEnv = { ...process.env, ...this.env };
      console.log(`[BaseStdioAdapter:connect] Merged env vars that will be passed to MCP:`, {
        'GOOGLE_DRIVE_MCP_TOKEN_PATH': mergedEnv.GOOGLE_DRIVE_MCP_TOKEN_PATH,
        'PATH': mergedEnv.PATH?.substring(0, 50) + '...',
        'NODE_ENV': mergedEnv.NODE_ENV,
        'custom_vars_count': customEnvKeys.length,
      });

      // Update transport env in case prepare() modified this.env
      this.transport = new StdioClientTransport({
        command: this.command,
        args: this.args,
        cwd: this.cwd,
        env: mergedEnv as Record<string, string>,
      });

      console.log(`[BaseStdioAdapter:connect] Transport created, connecting to client...`);
      await this.client.connect(this.transport);
      this._isConnected = true;
      console.log(`[BaseStdioAdapter:connect] Connected successfully!`);
    } catch (error) {
      this._isConnected = false;
      console.error(`[BaseStdioAdapter:connect] Connection failed:`, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async listTools(): Promise<any> {
    if (!this._isConnected) {
      throw new Error(`Adapter ${this.id} is not connected`);
    }
    const res = await (this.client.listTools() as any);
    // Ensure inputSchema is always present (default to empty object)
    return (res.tools as any[]).map((tool: any) => ({
      name: tool.name,
      description: tool.description || '',
      inputSchema: (tool.inputSchema || {}) as Record<string, unknown>,
    })) as MCPToolInfo[];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    if (!this._isConnected) {
      throw new Error(`Adapter ${this.id} is not connected`);
    }

    try {
      const result = await this.client.callTool({ name, arguments: args });

      // Normalize result
      if (typeof result === 'string') {
        return { type: 'text', text: result };
      }

      if (result && typeof result === 'object') {
        if ('error' in result) {
          return { type: 'error', error: String((result as any).error) };
        }
        if ('text' in result) {
          const { text, ...rest } = result as any;
          return { type: 'text', text, ...rest };
        }
        if ('content' in result) {
          return { type: 'text', text: JSON.stringify((result as any).content) };
        }
      }

      return { type: 'text', text: JSON.stringify(result) };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { type: 'error', error: errorMsg };
    }
  }

  async listResources(): Promise<MCPResource[]> {
    if (!this._isConnected) {
      throw new Error(`Adapter ${this.id} is not connected`);
    }
    const res = await this.client.listResources();
    return res.resources;
  }

  async readResource(uri: string): Promise<unknown> {
    if (!this._isConnected) {
      throw new Error(`Adapter ${this.id} is not connected`);
    }
    return this.client.readResource({ uri });
  }

  isConnected(): boolean {
    return this._isConnected;
  }

  async reconnect(): Promise<void> {
    try {
      this.transport.close();
    } catch {
      // Ignore close errors
    }

    this._isConnected = false;
    await this.connect();
  }

  close(): void {
    try {
      this.transport.close();
    } catch {
      // Ignore close errors
    }
    this._isConnected = false;
  }
}
