// ============================================
// MCP Adapter Interface (Transport-Agnostic)
// ============================================

import type { MCPToolInfo, MCPResource } from './storage.js';

export interface CallToolResult {
  type: 'text' | 'image' | 'resource' | 'error';
  text?: string;
  mimeType?: string;
  url?: string;
  resource?: unknown;
  error?: string;
}

/**
 * Uniform interface for all MCP server transports (stdio, WebSocket, HTTP, etc.)
 * This abstraction allows the app to work with any MCP server regardless of transport type
 */
export interface McpAdapter {
  readonly id: string; // e.g., 'mcp-google-drive'
  readonly userId: string;
  readonly serverKey: string; // e.g., 'google-drive-full'

  /**
   * List available tools from the MCP server
   */
  listTools(): Promise<MCPToolInfo[]>;

  /**
   * Call a tool on the MCP server
   */
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>;

  /**
   * List available resources from the MCP server
   */
  listResources(): Promise<MCPResource[]>;

  /**
   * Read a specific resource
   */
  readResource(uri: string): Promise<unknown>;

  /**
   * Check if adapter is connected
   */
  isConnected(): boolean;

  /**
   * Reconnect adapter (if connection is lost)
   */
  reconnect(): Promise<void>;

  /**
   * Close/disconnect the adapter
   */
  close(): void;
}

/**
 * Configuration for different transport types
 */
export interface MCPTransportConfig {
  type: 'stdio' | 'websocket' | 'http';
}

export interface StdioTransportConfig extends MCPTransportConfig {
  type: 'stdio';
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

export interface WebSocketTransportConfig extends MCPTransportConfig {
  type: 'websocket';
  url: string;
}

export interface HttpTransportConfig extends MCPTransportConfig {
  type: 'http';
  url: string;
}

export type AnyMCPTransportConfig = StdioTransportConfig | WebSocketTransportConfig | HttpTransportConfig;
