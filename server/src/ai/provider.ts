import type { LLMMessage, LLMRequest, LLMResponse, LLMStreamChunk, MCPToolDefinition } from '@local-agent/shared';

/**
 * Abstract LLM Provider Interface
 * Defines the contract for different LLM implementations
 */
export interface LLMProvider {
  /**
   * Complete a chat request
   */
  complete(request: LLMRequest): Promise<LLMResponse>;

  /**
   * Stream a chat request
   */
  stream(request: LLMRequest): AsyncGenerator<LLMStreamChunk>;

  /**
   * Convert MCP tools to provider format
   */
  convertMCPToolsToProvider(tools: Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }>): MCPToolDefinition[];
}

/**
 * Base provider configuration
 */
export interface LLMProviderConfig {
  apiKey: string;
  defaultModel: string;
}
