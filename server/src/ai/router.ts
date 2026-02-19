import type { LLMRequest, LLMResponse, LLMStreamChunk, MCPToolDefinition } from '@local-agent/shared';
import type { LLMProvider } from './provider.js';
import { GrokProvider } from './grok-provider.js';
import { OpenAIProvider } from './openai-provider.js';
import { AnthropicProvider } from './anthropic-provider.js';

export interface LLMRouterConfig {
  provider?: 'grok' | 'openai' | 'anthropic';
  grokKey?: string;
  openaiKey?: string;
  anthropicKey?: string;
  defaultModel?: string;
  routerEnabled?: boolean;
  rules?: Array<{
    keywords: string[];
    model: string;
  }>;
}

/**
 * LLM Router
 * Routes requests to appropriate models and providers based on configuration
 */
export class LLMRouter {
  private provider: LLMProvider;
  private defaultModel: string;
  private routerEnabled: boolean;
  private rules: Array<{ keywords: string[]; model: string }>;

  constructor(config: LLMRouterConfig) {
    // Determine which provider to use
    const providerType = config.provider || 'grok';

    if (providerType === 'grok') {
      if (!config.grokKey) {
        throw new Error('GROK_API_KEY is required for Grok provider');
      }
      this.provider = new GrokProvider({
        apiKey: config.grokKey,
        defaultModel: config.defaultModel || 'grok-4-1-fast-reasoning',
      });
      this.defaultModel = config.defaultModel || 'grok-4-1-fast-reasoning';
    } else if (providerType === 'openai') {
      if (!config.openaiKey) {
        throw new Error('OPENAI_API_KEY is required for OpenAI provider');
      }
      this.provider = new OpenAIProvider({
        apiKey: config.openaiKey,
        defaultModel: config.defaultModel || 'gpt-4',
      });
      this.defaultModel = config.defaultModel || 'gpt-4';
    } else if (providerType === 'anthropic') {
      if (!config.anthropicKey) {
        throw new Error('ANTHROPIC_API_KEY is required for Anthropic provider');
      }
      this.provider = new AnthropicProvider({
        apiKey: config.anthropicKey,
        defaultModel: config.defaultModel || 'claude-sonnet-4-20250514',
      });
      this.defaultModel = config.defaultModel || 'claude-sonnet-4-20250514';
    } else {
      throw new Error(`Unknown provider: ${providerType}`);
    }

    this.routerEnabled = config.routerEnabled ?? false;
    this.rules = config.rules || [];
  }

  /**
   * Select the best model for a given message
   */
  selectModel(message: string): string {
    if (!this.routerEnabled) {
      return this.defaultModel;
    }

    const lowerMessage = message.toLowerCase();

    for (const rule of this.rules) {
      for (const keyword of rule.keywords) {
        if (lowerMessage.includes(keyword.toLowerCase())) {
          return rule.model;
        }
      }
    }

    return this.defaultModel;
  }

  /**
   * Complete a chat request
   */
  async complete(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model || this.selectModel(request.messages[request.messages.length - 1]?.content || '');
    return this.provider.complete({ ...request, model });
  }

  /**
   * Stream a chat request
   */
  async *stream(request: LLMRequest): AsyncGenerator<LLMStreamChunk> {
    const model = request.model || this.selectModel(request.messages[request.messages.length - 1]?.content || '');
    yield* this.provider.stream({ ...request, model });
  }

  /**
   * Convert MCP tools to provider format
   */
  convertMCPToolsToOpenAI(tools: Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }>): MCPToolDefinition[] {
    return this.provider.convertMCPToolsToProvider(tools);
  }
}

/**
 * Create an LLM router instance
 */
export function createLLMRouter(config: LLMRouterConfig): LLMRouter {
  return new LLMRouter(config);
}
