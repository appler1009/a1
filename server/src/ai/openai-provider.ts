import OpenAI from 'openai';
import type { LLMRequest, LLMResponse, LLMStreamChunk, ToolCall, MCPToolDefinition } from '@local-agent/shared';
import type { LLMProvider, LLMProviderConfig } from './provider.js';

/**
 * OpenAI LLM Provider
 */
export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private defaultModel: string;

  constructor(config: LLMProviderConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey });
    this.defaultModel = config.defaultModel;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model || this.defaultModel;

    const response = await this.client.chat.completions.create({
      model,
      messages: request.messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 4096,
      tools: request.tools,
    });

    const choice = response.choices[0];

    return {
      content: choice.message.content || '',
      model: response.model,
      tokens: {
        prompt: response.usage?.prompt_tokens ?? 0,
        completion: response.usage?.completion_tokens ?? 0,
        total: response.usage?.total_tokens ?? 0,
      },
      toolCalls: choice.message.tool_calls?.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      })),
    };
  }

  async *stream(request: LLMRequest): AsyncGenerator<LLMStreamChunk> {
    const model = request.model || this.defaultModel;

    const stream = await this.client.chat.completions.create({
      model,
      messages: request.messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 4096,
      stream: true,
      tools: request.tools,
    });

    let currentToolCall: Partial<ToolCall> | null = null;
    let toolCallArgs = '';

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      if (!delta) continue;

      // Handle text content
      if (delta.content) {
        yield { type: 'text', content: delta.content };
      }

      // Handle tool calls
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.index === 0 && tc.id) {
            // Start of new tool call
            if (currentToolCall) {
              // Yield previous tool call
              yield {
                type: 'tool_call',
                toolCall: {
                  id: currentToolCall.id!,
                  name: currentToolCall.name!,
                  arguments: JSON.parse(toolCallArgs),
                },
              };
            }
            currentToolCall = { id: tc.id, name: tc.function?.name };
            toolCallArgs = '';
          }

          if (tc.function?.arguments) {
            toolCallArgs += tc.function.arguments;
          }
        }
      }
    }

    // Yield final tool call if any
    if (currentToolCall && currentToolCall.id && currentToolCall.name) {
      yield {
        type: 'tool_call',
        toolCall: {
          id: currentToolCall.id,
          name: currentToolCall.name,
          arguments: JSON.parse(toolCallArgs),
        },
      };
    }

    yield { type: 'done' };
  }

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
