import type { McpAdapter, CallToolResult } from '@local-agent/shared';
import type { MCPToolInfo, MCPResource } from '@local-agent/shared';

/**
 * Raw tool format that modules may return (with optional inputSchema)
 */
interface RawToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/**
 * Interface for in-process MCP tool modules
 * These modules export tools directly without requiring a separate server process
 */
export interface InProcessToolModule {
  /**
   * List all available tools
   */
  getTools(): Promise<RawToolInfo[]> | RawToolInfo[];

  /**
   * Tools are called as methods on the module
   * The module can have any additional methods/properties
   */
  [toolName: string]: unknown; // Index signature for dynamic tool access
}

/**
 * Interface for in-process MCP resource modules
 */
export interface InProcessResourceModule {
  /**
   * List all available resources
   */
  getResources?(): Promise<MCPResource[]> | MCPResource[];

  /**
   * Read a specific resource by URI
   */
  readResource?(uri: string): Promise<unknown>;
}

/**
 * Combined interface for full in-process MCP modules
 */
export type InProcessMCPModule = InProcessToolModule & InProcessResourceModule;

/**
 * InProcessAdapter - Direct in-process MCP calls
 * 
 * This adapter bypasses the stdio transport and calls MCP tools directly
 * within the same Node.js process. This provides:
 * - Lower latency (no process spawning/IPC overhead)
 * - Better debugging (direct stack traces)
 * - Simpler deployment (no external process management)
 * 
 * Use cases:
 * - Pure Node.js MCP packages that export tools directly
 * - Speed-critical integrations
 * - Development/testing scenarios
 * 
 * Requirements:
 * - The MCP module must export getTools() function returning tool definitions
 * - Each tool must be exported as a callable function
 * - Optional: getResources() and readResource() for resource support
 */
export class InProcessAdapter {
  protected _isConnected = false;

  readonly id: string;
  readonly userId: string;
  readonly serverKey: string;

  constructor(
    id: string,
    userId: string,
    serverKey: string,
    private toolModule: InProcessMCPModule
  ) {
    this.id = id;
    this.userId = userId;
    this.serverKey = serverKey;
    
    // In-process adapters are immediately "connected" since there's no external process
    this._isConnected = true;
  }

  /**
   * Connect - for in-process adapters, this is a no-op since there's nothing to connect to
   */
  async connect(): Promise<void> {
    this._isConnected = true;
  }

  /**
   * List available tools from the in-process module
   */
  async listTools(): Promise<MCPToolInfo[]> {
    if (!this._isConnected) {
      throw new Error(`Adapter ${this.id} is not connected`);
    }

    try {
      const tools = await this.toolModule.getTools();
      // Ensure inputSchema is always present (default to empty object)
      const result: MCPToolInfo[] = [];
      for (const tool of tools) {
        // Explicitly create MCPToolInfo with required inputSchema
        const schema: Record<string, unknown> = tool.inputSchema || {};
        result.push({
          name: tool.name,
          description: tool.description || '',
          inputSchema: schema,
        });
      }
      return result;
    } catch (error) {
      console.error(`[InProcessAdapter:listTools] Error listing tools:`, error);
      throw error;
    }
  }

  /**
   * Call a tool directly in the module
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    if (!this._isConnected) {
      throw new Error(`Adapter ${this.id} is not connected`);
    }

    try {
      const fn = this.toolModule[name];
      
      if (typeof fn !== 'function') {
        throw new Error(`Tool '${name}' not found in module ${this.serverKey}`);
      }

      const result = await fn.call(this.toolModule, args);

      // Normalize result to CallToolResult format
      return this.normalizeResult(result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[InProcessAdapter:callTool] Error calling tool ${name}:`, errorMsg);
      return { type: 'error', error: errorMsg };
    }
  }

  /**
   * List available resources from the in-process module
   */
  async listResources(): Promise<MCPResource[]> {
    if (!this._isConnected) {
      throw new Error(`Adapter ${this.id} is not connected`);
    }

    if (typeof this.toolModule.getResources === 'function') {
      try {
        const resources = await this.toolModule.getResources!();
        return resources;
      } catch (error) {
        console.error(`[InProcessAdapter:listResources] Error listing resources:`, error);
        throw error;
      }
    }

    return [];
  }

  /**
   * Read a specific resource from the in-process module
   */
  async readResource(uri: string): Promise<unknown> {
    if (!this._isConnected) {
      throw new Error(`Adapter ${this.id} is not connected`);
    }

    if (typeof this.toolModule.readResource !== 'function') {
      throw new Error(`Resource reading not supported by ${this.serverKey}`);
    }

    
    try {
      const result = await this.toolModule.readResource!(uri);
      return result;
    } catch (error) {
      console.error(`[InProcessAdapter:readResource] Error reading resource ${uri}:`, error);
      throw error;
    }
  }

  /**
   * Check if adapter is connected
   */
  isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Reconnect - for in-process adapters, just ensure connected state
   */
  async reconnect(): Promise<void> {
    this._isConnected = true;
  }

  /**
   * Close - for in-process adapters, just mark as disconnected
   */
  close(): void {
    this._isConnected = false;
  }

  /**
   * Normalize various result formats to CallToolResult
   */
  private normalizeResult(result: unknown): CallToolResult {
    // Already in correct format
    if (result && typeof result === 'object') {
      const r = result as Record<string, unknown>;
      
      if (r.type === 'text' || r.type === 'image' || r.type === 'resource' || r.type === 'error') {
        return result as CallToolResult;
      }

      // Handle content array format (common in MCP responses)
      if ('content' in r && Array.isArray(r.content)) {
        const content = r.content[0];
        if (content && typeof content === 'object') {
          if ('text' in content) {
            return { type: 'text', text: content.text as string };
          }
          if ('error' in content) {
            return { type: 'error', error: String(content.error) };
          }
        }
        return { type: 'text', text: JSON.stringify(r.content) };
      }

      // Handle simple text response
      if ('text' in r) {
        return { type: 'text', text: String(r.text) };
      }

      // Handle error response
      if ('error' in r) {
        return { type: 'error', error: String(r.error) };
      }
    }

    // String result
    if (typeof result === 'string') {
      return { type: 'text', text: result };
    }

    // Default: serialize to JSON
    return { type: 'text', text: JSON.stringify(result) };
  }
}
