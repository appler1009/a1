/**
 * Unit tests for LLMRouter
 *
 * Uses mock providers to avoid actual API calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMRouter } from '../ai/router.js';
import type { LLMProvider } from '../ai/provider.js';
import type { LLMRequest, LLMResponse, LLMStreamChunk } from '@local-agent/shared';

// ---------------------------------------------------------------------------
// Mock provider factory
// ---------------------------------------------------------------------------

function makeProvider(overrides: Partial<LLMProvider> = {}): LLMProvider {
  return {
    complete: vi.fn(async (req: LLMRequest): Promise<LLMResponse> => ({
      content: 'Hello',
      model: req.model || 'mock-model',
      tokens: { prompt: 10, completion: 5, total: 15, cachedInput: 0, cacheCreation: 0 },
    })),
    stream: vi.fn(async function* (_req: LLMRequest): AsyncGenerator<LLMStreamChunk> {
      yield { type: 'text', content: 'chunk1' };
      yield { type: 'usage', tokens: { prompt: 10, completion: 5, total: 15, cachedInput: 2, cacheCreation: 0 } };
      yield { type: 'done' };
    }),
    convertMCPToolsToProvider: vi.fn(() => []),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers to inject a mock provider into LLMRouter
// ---------------------------------------------------------------------------

function makeRouter(opts: {
  provider?: Partial<LLMProvider>;
  defaultModel?: string;
  routerEnabled?: boolean;
  rules?: Array<{ keywords: string[]; model: string }>;
  onTokensUsed?: (e: any) => void;
}) {
  // We bootstrap with a valid config, then swap the internal provider
  const router = new LLMRouter({
    provider: 'grok',
    grokKey: 'test-key',
    defaultModel: opts.defaultModel ?? 'mock-default',
    routerEnabled: opts.routerEnabled,
    rules: opts.rules,
    onTokensUsed: opts.onTokensUsed,
  });
  const mockProvider = makeProvider(opts.provider ?? {});
  (router as any).provider = mockProvider;
  return { router, mockProvider };
}

// ---------------------------------------------------------------------------
// selectModel
// ---------------------------------------------------------------------------

describe('selectModel', () => {
  it('returns defaultModel when router is disabled', () => {
    const { router } = makeRouter({ defaultModel: 'default-model', routerEnabled: false });
    expect(router.selectModel('anything')).toBe('default-model');
  });

  it('returns defaultModel when no rules match', () => {
    const { router } = makeRouter({
      defaultModel: 'default-model',
      routerEnabled: true,
      rules: [{ keywords: ['code'], model: 'code-model' }],
    });
    expect(router.selectModel('what is the weather')).toBe('default-model');
  });

  it('returns matched rule model when keyword found', () => {
    const { router } = makeRouter({
      defaultModel: 'default-model',
      routerEnabled: true,
      rules: [{ keywords: ['code', 'debug'], model: 'code-model' }],
    });
    expect(router.selectModel('please debug this function')).toBe('code-model');
  });

  it('matching is case-insensitive', () => {
    const { router } = makeRouter({
      defaultModel: 'default-model',
      routerEnabled: true,
      rules: [{ keywords: ['CODE'], model: 'code-model' }],
    });
    expect(router.selectModel('write some code')).toBe('code-model');
  });

  it('returns first matching rule model', () => {
    const { router } = makeRouter({
      defaultModel: 'fallback',
      routerEnabled: true,
      rules: [
        { keywords: ['code'], model: 'first-model' },
        { keywords: ['code'], model: 'second-model' },
      ],
    });
    expect(router.selectModel('code review')).toBe('first-model');
  });
});

// ---------------------------------------------------------------------------
// complete
// ---------------------------------------------------------------------------

describe('complete', () => {
  let router: LLMRouter;
  let mockProvider: LLMProvider;

  beforeEach(() => {
    ({ router, mockProvider } = makeRouter({ defaultModel: 'mock-default' }));
  });

  it('delegates to provider.complete', async () => {
    const req: LLMRequest = { messages: [{ role: 'user', content: 'hi' }] };
    const response = await router.complete(req);
    expect(mockProvider.complete).toHaveBeenCalledOnce();
    expect(response.content).toBe('Hello');
  });

  it('uses model from request if provided', async () => {
    const req: LLMRequest = { model: 'specific-model', messages: [{ role: 'user', content: 'hi' }] };
    await router.complete(req);
    const callArg = (mockProvider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.model).toBe('specific-model');
  });

  it('falls back to selectModel when no model in request', async () => {
    const req: LLMRequest = { messages: [{ role: 'user', content: 'hi' }] };
    await router.complete(req);
    const callArg = (mockProvider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.model).toBe('mock-default');
  });

  it('calls onTokensUsed after successful completion', async () => {
    const onTokensUsed = vi.fn();
    const { router: r } = makeRouter({ onTokensUsed });
    await r.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(onTokensUsed).toHaveBeenCalledOnce();
    const event = onTokensUsed.mock.calls[0][0];
    expect(event.promptTokens).toBe(10);
    expect(event.completionTokens).toBe(5);
    expect(event.totalTokens).toBe(15);
  });

  it('passes userId and source from request to onTokensUsed', async () => {
    const onTokensUsed = vi.fn();
    const { router: r } = makeRouter({ onTokensUsed });
    await r.complete({ messages: [{ role: 'user', content: 'hi' }], userId: 'user-42', source: 'chat' });
    const event = onTokensUsed.mock.calls[0][0];
    expect(event.userId).toBe('user-42');
    expect(event.source).toBe('chat');
  });

  it('does not throw when onTokensUsed is not set', async () => {
    const req: LLMRequest = { messages: [{ role: 'user', content: 'hi' }] };
    const response = await router.complete(req);
    expect(response.content).toBeDefined();
  });

  it('includes provider name in onTokensUsed event', async () => {
    const onTokensUsed = vi.fn();
    const { router: r } = makeRouter({ onTokensUsed });
    await r.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(onTokensUsed.mock.calls[0][0].provider).toBe('grok');
  });
});

// ---------------------------------------------------------------------------
// stream
// ---------------------------------------------------------------------------

describe('stream', () => {
  it('yields chunks from provider stream', async () => {
    const { router } = makeRouter({});
    const chunks: LLMStreamChunk[] = [];
    for await (const chunk of router.stream({ messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk);
    }
    expect(chunks.some(c => c.type === 'text')).toBe(true);
    expect(chunks.some(c => c.type === 'done')).toBe(true);
  });

  it('calls onTokensUsed when usage chunk arrives', async () => {
    const onTokensUsed = vi.fn();
    const { router } = makeRouter({ onTokensUsed });
    // consume stream
    for await (const _ of router.stream({ messages: [{ role: 'user', content: 'hi' }] })) {
      // drain
    }
    expect(onTokensUsed).toHaveBeenCalledOnce();
    const event = onTokensUsed.mock.calls[0][0];
    expect(event.promptTokens).toBe(10);
    expect(event.cachedInputTokens).toBe(2);
  });

  it('still yields usage chunk downstream', async () => {
    const onTokensUsed = vi.fn();
    const { router } = makeRouter({ onTokensUsed });
    const chunks: LLMStreamChunk[] = [];
    for await (const chunk of router.stream({ messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk);
    }
    expect(chunks.some(c => c.type === 'usage')).toBe(true);
  });

  it('passes userId and source in onTokensUsed event', async () => {
    const onTokensUsed = vi.fn();
    const { router } = makeRouter({ onTokensUsed });
    for await (const _ of router.stream({ messages: [{ role: 'user', content: 'hi' }], userId: 'u1', source: 'scheduler' })) {
      // drain
    }
    const event = onTokensUsed.mock.calls[0][0];
    expect(event.userId).toBe('u1');
    expect(event.source).toBe('scheduler');
  });
});

// ---------------------------------------------------------------------------
// constructor validation
// ---------------------------------------------------------------------------

describe('LLMRouter constructor', () => {
  it('throws when grok provider is used without grokKey', () => {
    expect(() => new LLMRouter({ provider: 'grok' })).toThrow('GROK_API_KEY');
  });

  it('throws when openai provider is used without openaiKey', () => {
    expect(() => new LLMRouter({ provider: 'openai' })).toThrow('OPENAI_API_KEY');
  });

  it('throws when anthropic provider is used without anthropicKey', () => {
    expect(() => new LLMRouter({ provider: 'anthropic' })).toThrow('ANTHROPIC_API_KEY');
  });
});
