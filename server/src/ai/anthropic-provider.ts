import Anthropic from '@anthropic-ai/sdk';
import type { LLMRequest, LLMResponse, LLMStreamChunk, ToolCall, MCPToolDefinition } from '@local-agent/shared';
import type { LLMProvider, LLMProviderConfig } from './provider.js';

/**
 * Anthropic Claude LLM Provider
 * Uses Anthropic's Claude API with native tool support
 */
export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  private defaultModel: string;

  constructor(config: LLMProviderConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
    });
    this.defaultModel = config.defaultModel || 'claude-sonnet-4-20250514';
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model || this.defaultModel;
    console.log(`[AnthropicProvider] Making completion request with model: ${model}`);
    console.log(`[AnthropicProvider] Available tools: ${request.tools?.length || 0} tools`, {
      toolNames: request.tools?.map(t => t.function?.name).filter(Boolean),
    });

    // Convert messages to Anthropic format
    const { system, messages } = this.convertMessages(request.messages);

    const response = await this.client.messages.create({
      model,
      max_tokens: request.maxTokens ?? 4096,
      system,
      messages,
      tools: request.tools ? this.convertToolsToAnthropic(request.tools) : undefined,
    });

    console.log(`[AnthropicProvider] Received response with ${response.content.length} content blocks`);

    // Extract text and tool calls from response
    let content = '';
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    if (toolCalls.length > 0) {
      console.log(`[AnthropicProvider] Tool calls requested: ${toolCalls.map(tc => tc.name).join(', ')}`);
    }

    return {
      content,
      model: response.model,
      tokens: {
        prompt: response.usage.input_tokens,
        completion: response.usage.output_tokens,
        total: response.usage.input_tokens + response.usage.output_tokens,
      },
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  async *stream(request: LLMRequest): AsyncGenerator<LLMStreamChunk> {
    const model = request.model || this.defaultModel;
    console.log(`[AnthropicProvider] Streaming request with model: ${model}`);
    console.log(`[AnthropicProvider] Available tools for streaming: ${request.tools?.length || 0} tools`, {
      toolNames: request.tools?.map(t => t.function?.name).filter(Boolean),
    });

    // Convert messages to Anthropic format
    const { system, messages } = this.convertMessages(request.messages);

    const stream = this.client.messages.stream({
      model,
      max_tokens: request.maxTokens ?? 4096,
      system,
      messages,
      tools: request.tools ? this.convertToolsToAnthropic(request.tools) : undefined,
    });

    // Process stream events
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield { type: 'text', content: event.delta.text };
      } else if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        // Tool use started - we'll yield when we have complete tool info
        console.log(`[AnthropicProvider] Tool use started: ${event.content_block.name}`);
      }
    }

    // Get the final message to extract tool calls
    const finalMessage = await stream.finalMessage();

    // Yield tool calls from the final message
    for (const block of finalMessage.content) {
      if (block.type === 'tool_use') {
        console.log(`[AnthropicProvider] Tool call streaming: ${block.name}`);
        yield {
          type: 'tool_call',
          toolCall: {
            id: block.id,
            name: block.name,
            arguments: block.input as Record<string, unknown>,
          },
        };
      }
    }

    yield { type: 'done' };
  }

  /**
   * Convert messages from OpenAI format to Anthropic format
   * Anthropic uses separate 'system' parameter and requires alternating user/assistant messages
   */
  private convertMessages(messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>): {
    system: string | undefined;
    messages: Array<{ role: 'user' | 'assistant'; content: string | Array<{ type: 'text'; text: string }> }>;
  } {
    let system: string | undefined;
    const convertedMessages: Array<{ role: 'user' | 'assistant'; content: string | Array<{ type: 'text'; text: string }> }> = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Anthropic uses a separate system parameter
        system = system ? `${system}\n\n${msg.content}` : msg.content;
      } else {
        convertedMessages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    return { system, messages: convertedMessages };
  }

  /**
   * Convert MCP tools to Anthropic's tool format
   * Anthropic uses a slightly different schema structure
   */
  private convertToolsToAnthropic(tools: MCPToolDefinition[]): Anthropic.Messages.Tool[] {
    return tools.map(tool => ({
      name: tool.function.name,
      description: tool.function.description || '',
      input_schema: tool.function.parameters as Anthropic.Messages.Tool['input_schema'],
    }));
  }

  /**
   * Convert MCP tools to provider format (standardized interface)
   */
  convertMCPToolsToProvider(tools: Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }>): MCPToolDefinition[] {
    return tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }
}
