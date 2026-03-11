import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpAdapter, CallToolResult } from '@local-agent/shared';
import type { MCPToolInfo, MCPResource } from '@local-agent/shared';

/**
 * Base adapter for all stdio-based MCP servers
 * Subclasses can override prepare() to customize token/env setup before connect
 */
export abstract class BaseStdioAdapter implements McpAdapter {
  protected client: Client;
  protected transport!: StdioClientTransport; // initialized in connect()
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
    this.client = new Client({ name: 'agent-ui', version: '1.0.0' });
  }

  /**
   * Hook for subclasses to prepare MCP-specific setup (e.g. write token env vars)
   * Called once before the transport is created.
   */
  protected async prepare(): Promise<void> {
    // Override in subclasses
  }

  async connect(): Promise<void> {
    try {
      await this.prepare();

      this.transport = new StdioClientTransport({
        command: this.command,
        args: this.args,
        cwd: this.cwd,
        env: { ...process.env, ...this.env } as Record<string, string>,
      });

      await this.client.connect(this.transport);
      this._isConnected = true;
    } catch (error) {
      this._isConnected = false;
      console.error(`[MCP] Failed to connect ${this.serverKey}:`, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async listTools(): Promise<MCPToolInfo[]> {
    if (!this._isConnected) {
      throw new Error(`Adapter ${this.id} is not connected`);
    }
    const res = await (this.client.listTools() as any);
    return (res.tools as any[]).map((tool: any) => ({
      name: tool.name,
      description: tool.description || '',
      inputSchema: (tool.inputSchema || {}) as Record<string, unknown>,
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    if (!this._isConnected) {
      throw new Error(`Adapter ${this.id} is not connected`);
    }

    try {
      const result = await this.client.callTool({ name, arguments: args });

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
