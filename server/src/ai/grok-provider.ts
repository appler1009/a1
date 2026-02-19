import OpenAI from 'openai';
import type { LLMRequest, LLMResponse, LLMStreamChunk, ToolCall, MCPToolDefinition } from '@local-agent/shared';
import type { LLMProvider, LLMProviderConfig } from './provider.js';

/**
 * Grok LLM Provider
 * Uses xAI's Grok API with OpenAI-compatible interface
 */
export class GrokProvider implements LLMProvider {
  private client: OpenAI;
  private defaultModel: string;

  constructor(config: LLMProviderConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: 'https://api.x.ai/v1',
    });
    this.defaultModel = config.defaultModel || 'grok-4-1-fast-reasoning';
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model || this.defaultModel;
    console.log(`[GrokProvider] Making completion request with model: ${model}`);
    console.log(`[GrokProvider] Available tools: ${request.tools?.length || 0} tools`, {
      toolNames: request.tools?.map(t => t.function?.name).filter(Boolean),
    });

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
    console.log(`[GrokProvider] Received response: ${choice.message.content?.substring(0, 100)}...`);
    if (choice.message.tool_calls?.length) {
      console.log(`[GrokProvider] Tool calls requested: ${choice.message.tool_calls.map(tc => tc.function.name).join(', ')}`);
    }

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
    console.log(`[GrokProvider] Streaming request with model: ${model}`);
    console.log(`[GrokProvider] Available tools for streaming: ${request.tools?.length || 0} tools`, {
      toolNames: request.tools?.map(t => t.function?.name).filter(Boolean),
    });

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

    const parseToolArgs = (argsString: string): Record<string, unknown> => {
      if (!argsString.trim()) return {};

      try {
        return JSON.parse(argsString);
      } catch (e) {
        // If parsing fails, try to extract the first complete JSON object
        // This handles cases where multiple JSON objects are concatenated
        let braceCount = 0;
        let inString = false;
        let escaped = false;

        for (let i = 0; i < argsString.length; i++) {
          const char = argsString[i];

          if (escaped) {
            escaped = false;
            continue;
          }

          if (char === '\\') {
            escaped = true;
            continue;
          }

          if (char === '"') {
            inString = !inString;
            continue;
          }

          if (!inString) {
            if (char === '{') braceCount++;
            if (char === '}') {
              braceCount--;
              if (braceCount === 0) {
                // Found complete object
                try {
                  return JSON.parse(argsString.substring(0, i + 1));
                } catch (innerError) {
                  console.error('[GrokProvider] Failed to parse extracted JSON:', innerError);
                  return {};
                }
              }
            }
          }
        }

        console.error('[GrokProvider] Could not find complete JSON object in:', argsString.substring(0, 100));
        return {};
      }
    };

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
              console.log(`[GrokProvider] Tool call streaming: ${currentToolCall.name}`);
              const parsedArgs = parseToolArgs(toolCallArgs);
              yield {
                type: 'tool_call',
                toolCall: {
                  id: currentToolCall.id!,
                  name: currentToolCall.name!,
                  arguments: parsedArgs,
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
      console.log(`[GrokProvider] Tool call streaming: ${currentToolCall.name}`);
      const parsedArgs = parseToolArgs(toolCallArgs);
      yield {
        type: 'tool_call',
        toolCall: {
          id: currentToolCall.id,
          name: currentToolCall.name,
          arguments: parsedArgs,
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
