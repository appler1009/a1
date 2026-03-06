import type { LLMRequest, LLMResponse, LLMStreamChunk, MCPToolDefinition } from '@local-agent/shared';
import type { LLMProvider } from './provider.js';
import { GrokProvider } from './grok-provider.js';
import { OpenAIProvider } from './openai-provider.js';
import { AnthropicProvider } from './anthropic-provider.js';

export interface TokenUsageEvent {
  userId?: string;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
  source?: string;
}

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
  onTokensUsed?: (event: TokenUsageEvent) => void;
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
  private onTokensUsed?: (event: TokenUsageEvent) => void;
  private providerName: string;

  constructor(config: LLMRouterConfig) {
    // Determine which provider to use
    const providerType = config.provider || 'grok';

    if (providerType === 'grok') {
      if (!config.grokKey) {
        throw new Error('GROK_API_KEY is required for Grok provider');
      }
      this.provider = new GrokProvider({
        apiKey: config.grokKey,
        defaultModel: config.defaultModel || 'grok-4-1-fast-non-reasoning',
      });
      this.defaultModel = config.defaultModel || 'grok-4-1-fast-non-reasoning';
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

    this.providerName = providerType;
    this.routerEnabled = config.routerEnabled ?? false;
    this.rules = config.rules || [];
    this.onTokensUsed = config.onTokensUsed;
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
    const response = await this.provider.complete({ ...request, model });
    if (this.onTokensUsed && response.tokens) {
      this.onTokensUsed({
        userId: request.userId,
        model: response.model,
        provider: this.providerName,
        promptTokens: response.tokens.prompt,
        completionTokens: response.tokens.completion,
        totalTokens: response.tokens.total,
        cachedInputTokens: response.tokens.cachedInput ?? 0,
        cacheCreationTokens: response.tokens.cacheCreation ?? 0,
        source: request.source,
      });
    }
    return response;
  }

  /**
   * Stream a chat request
   */
  async *stream(request: LLMRequest): AsyncGenerator<LLMStreamChunk> {
    const model = request.model || this.selectModel(request.messages[request.messages.length - 1]?.content || '');
    for await (const chunk of this.provider.stream({ ...request, model })) {
      if (chunk.type === 'usage' && chunk.tokens && this.onTokensUsed) {
        this.onTokensUsed({
          userId: request.userId,
          model,
          provider: this.providerName,
          promptTokens: chunk.tokens.prompt,
          completionTokens: chunk.tokens.completion,
          totalTokens: chunk.tokens.total,
          cachedInputTokens: chunk.tokens.cachedInput ?? 0,
          cacheCreationTokens: chunk.tokens.cacheCreation ?? 0,
          source: request.source,
        });
      }
      yield chunk;
    }
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
