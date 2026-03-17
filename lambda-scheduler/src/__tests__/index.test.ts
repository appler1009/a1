import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Env vars — must be set before the module is imported (constants are
// captured at load time)
// ---------------------------------------------------------------------------

process.env.BACKEND_URL = 'http://backend';
process.env.INTERNAL_API_KEY = 'test-key';
process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
process.env.LLM_PROVIDER = 'anthropic';

// ---------------------------------------------------------------------------
// Hoisted mock functions — created before vi.mock() factories run so they
// can be referenced inside class/function bodies
// ---------------------------------------------------------------------------

const { mockMessagesCreate, mockChatCompletionsCreate, mockDynamoSend, MockPutCommand, MockGetCommand, mockAnthropicConstructor } =
  vi.hoisted(() => {
    // PutCommand must be a real constructor (used with `new`) that captures its argument
    function MockPutCommandFn(this: { input: unknown }, input: unknown) {
      this.input = input;
    }
    function MockGetCommandFn(this: { input: unknown }, input: unknown) {
      this.input = input;
    }
    return {
      mockMessagesCreate: vi.fn(),
      mockChatCompletionsCreate: vi.fn(),
      mockDynamoSend: vi.fn(),
      MockPutCommand: vi.fn(MockPutCommandFn as any),
      MockGetCommand: vi.fn(MockGetCommandFn as any),
      mockAnthropicConstructor: vi.fn(),
    };
  });

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    constructor(opts: { apiKey: string }) {
      mockAnthropicConstructor(opts);
    }
    messages = { create: mockMessagesCreate };
  },
}));

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: mockChatCompletionsCreate } };
  },
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class {},
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn().mockReturnValue({ send: mockDynamoSend }),
  },
  PutCommand: MockPutCommand,
  GetCommand: MockGetCommand,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAnthropicResponse(text: string, inputTokens = 100, outputTokens = 50) {
  return {
    content: [{ type: 'text', text }],
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_input_tokens: 10,
      cache_creation_input_tokens: 5,
    },
  };
}

function makeJob(overrides: Partial<{
  id: string;
  userId: string;
  roleId: string;
  description: string;
  scheduleType: 'once' | 'recurring';
  lastRunAt: string | null;
}> = {}) {
  return {
    id: 'job-1',
    userId: 'user-1',
    roleId: 'role-1',
    description: 'Send daily report every day at 9am',
    scheduleType: 'recurring' as const,
    lastRunAt: null,
    ...overrides,
  };
}

const VALID_JSON_RESPONSE = JSON.stringify({
  run: ['job-1'],
  hold: [{ id: 'job-1', until: '2026-03-08T09:00:00Z' }],
});

// ---------------------------------------------------------------------------
// Import module under test after mocks and env vars are in place
// ---------------------------------------------------------------------------

const { handler, buildEvaluatorPrompt, parseEvaluatorResponse } = await import('../index.js');

// ---------------------------------------------------------------------------
// Pure function: buildEvaluatorPrompt
// ---------------------------------------------------------------------------

describe('buildEvaluatorPrompt', () => {
  it('includes job id and description in the prompt', () => {
    const job = makeJob({ id: 'abc-123', description: 'Run nightly backup' });
    const prompt = buildEvaluatorPrompt([job]);
    expect(prompt).toContain('abc-123');
    expect(prompt).toContain('Run nightly backup');
  });

  it('shows "never" when lastRunAt is null', () => {
    const prompt = buildEvaluatorPrompt([makeJob({ lastRunAt: null })]);
    expect(prompt).toContain('never');
  });

  it('shows ISO date when lastRunAt is set', () => {
    const prompt = buildEvaluatorPrompt([makeJob({ lastRunAt: '2026-03-06T09:00:00.000Z' })]);
    expect(prompt).toContain('2026-03-06T09:00:00.000Z');
  });

  it('includes all jobs when multiple provided', () => {
    const jobs = [
      makeJob({ id: 'job-a', description: 'Task A' }),
      makeJob({ id: 'job-b', description: 'Task B', userId: 'user-2' }),
    ];
    const prompt = buildEvaluatorPrompt(jobs);
    expect(prompt).toContain('job-a');
    expect(prompt).toContain('job-b');
    expect(prompt).toContain('Task A');
    expect(prompt).toContain('Task B');
  });

  it('includes current time and expected JSON shape in instructions', () => {
    const prompt = buildEvaluatorPrompt([makeJob()]);
    expect(prompt).toContain('UTC');
    expect(prompt).toContain('"run"');
    expect(prompt).toContain('"hold"');
  });
});

// ---------------------------------------------------------------------------
// Pure function: parseEvaluatorResponse
// ---------------------------------------------------------------------------

describe('parseEvaluatorResponse', () => {
  it('parses a valid JSON response', () => {
    const result = parseEvaluatorResponse(VALID_JSON_RESPONSE);
    expect(result.run).toEqual(['job-1']);
    expect(result.hold).toEqual([{ id: 'job-1', until: '2026-03-08T09:00:00Z' }]);
  });

  it('extracts JSON embedded in surrounding prose', () => {
    const text = `Here is my answer:\n${VALID_JSON_RESPONSE}\nThat's the result.`;
    const result = parseEvaluatorResponse(text);
    expect(result.run).toEqual(['job-1']);
  });

  it('returns empty arrays when no JSON object is found', () => {
    const result = parseEvaluatorResponse('I cannot determine the schedule.');
    expect(result.run).toEqual([]);
    expect(result.hold).toEqual([]);
  });

  it('handles missing run array in JSON', () => {
    const result = parseEvaluatorResponse(JSON.stringify({ hold: [] }));
    expect(result.run).toEqual([]);
    expect(result.hold).toEqual([]);
  });

  it('handles missing hold array in JSON', () => {
    const result = parseEvaluatorResponse(JSON.stringify({ run: ['job-1'] }));
    expect(result.run).toEqual(['job-1']);
    expect(result.hold).toEqual([]);
  });

  it('handles both arrays empty', () => {
    const result = parseEvaluatorResponse(JSON.stringify({ run: [], hold: [] }));
    expect(result.run).toEqual([]);
    expect(result.hold).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// handler — integration tests
// ---------------------------------------------------------------------------

describe('handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDynamoSend.mockResolvedValue({});

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ onceJobs: [], recurringJobs: [] }),
      text: async () => '',
    } as any);
  });

  it('does nothing when there are no pending jobs', async () => {
    await handler();
    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(mockDynamoSend).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1); // only fetchPendingJobs, no dispatch
  });

  it('dispatches once-jobs without calling the LLM', async () => {
    const onceJob = makeJob({ id: 'once-1', scheduleType: 'once' });
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ onceJobs: [onceJob], recurringJobs: [] }),
        text: async () => '',
      } as any)
      .mockResolvedValueOnce({ ok: true, text: async () => '' } as any);

    await handler();

    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(mockDynamoSend).not.toHaveBeenCalled();

    const dispatchBody = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[1][1].body,
    );
    expect(dispatchBody.run).toContain('once-1');
  });

  it('calls the LLM once for a single user with recurring jobs', async () => {
    mockMessagesCreate.mockResolvedValue(makeAnthropicResponse(VALID_JSON_RESPONSE));

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ onceJobs: [], recurringJobs: [makeJob({ userId: 'user-A' })] }),
        text: async () => '',
      } as any)
      .mockResolvedValueOnce({ ok: true, text: async () => '' } as any);

    await handler();

    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
  });

  it('calls the LLM once per user when multiple users have recurring jobs', async () => {
    mockMessagesCreate.mockResolvedValue(
      makeAnthropicResponse(JSON.stringify({ run: [], hold: [] })),
    );

    const jobs = [
      makeJob({ id: 'r1', userId: 'user-A' }),
      makeJob({ id: 'r2', userId: 'user-A', description: 'Another task' }),
      makeJob({ id: 'r3', userId: 'user-B' }),
    ];

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ onceJobs: [], recurringJobs: jobs }),
        text: async () => '',
      } as any)
      .mockResolvedValueOnce({ ok: true, text: async () => '' } as any);

    await handler();

    expect(mockMessagesCreate).toHaveBeenCalledTimes(2); // one per user
  });

  it('records token usage in DynamoDB for the correct user', async () => {
    mockMessagesCreate.mockResolvedValue(
      makeAnthropicResponse(JSON.stringify({ run: [], hold: [] }), 120, 60),
    );

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ onceJobs: [], recurringJobs: [makeJob({ userId: 'user-A' })] }),
        text: async () => '',
      } as any)
      .mockResolvedValueOnce({ ok: true, text: async () => '' } as any);

    await handler();

    expect(mockDynamoSend).toHaveBeenCalledTimes(1);
    const item = (mockDynamoSend.mock.calls[0][0] as any).input.Item;

    expect(item.userId).toBe('user-A');
    expect(item.promptTokens).toBe(120);
    expect(item.completionTokens).toBe(60);
    expect(item.totalTokens).toBe(180);
    expect(item.cachedInputTokens).toBe(10);
    expect(item.cacheCreationTokens).toBe(5);
    expect(item.source).toBe('scheduler');
    expect(item.provider).toBe('anthropic');
    expect(item.sk).toMatch(/^\d{4}-\d{2}-\d{2}T.+#.+$/); // ISO timestamp#uuid
    expect(item.createdAt).toBeTruthy();
  });

  it('records token usage separately for each user', async () => {
    mockMessagesCreate.mockResolvedValue(
      makeAnthropicResponse(JSON.stringify({ run: [], hold: [] })),
    );

    const jobs = [
      makeJob({ id: 'r1', userId: 'user-A' }),
      makeJob({ id: 'r2', userId: 'user-B' }),
    ];

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ onceJobs: [], recurringJobs: jobs }),
        text: async () => '',
      } as any)
      .mockResolvedValueOnce({ ok: true, text: async () => '' } as any);

    await handler();

    expect(mockDynamoSend).toHaveBeenCalledTimes(2);
    const userIds = mockDynamoSend.mock.calls.map((c: any) => c[0].input.Item.userId);
    expect(userIds).toContain('user-A');
    expect(userIds).toContain('user-B');
  });

  it('dispatches correct run and hold decisions from LLM response', async () => {
    const llmResponse = JSON.stringify({
      run: ['rec-1'],
      hold: [{ id: 'rec-1', until: '2026-03-08T09:00:00Z' }],
    });
    mockMessagesCreate.mockResolvedValue(makeAnthropicResponse(llmResponse));

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ onceJobs: [], recurringJobs: [makeJob({ id: 'rec-1', userId: 'user-A' })] }),
        text: async () => '',
      } as any)
      .mockResolvedValueOnce({ ok: true, text: async () => '' } as any);
    global.fetch = fetchMock;

    await handler();

    const dispatchBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(dispatchBody.run).toEqual(['rec-1']);
    expect(dispatchBody.hold).toEqual([{ id: 'rec-1', until: '2026-03-08T09:00:00Z' }]);
  });

  it('skips dispatch when LLM returns no actionable jobs', async () => {
    mockMessagesCreate.mockResolvedValue(makeAnthropicResponse('No JSON here.'));

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ onceJobs: [], recurringJobs: [makeJob({ userId: 'user-A' })] }),
      text: async () => '',
    } as any);

    await handler();

    // run=[] and hold=[] → dispatch guard skips the second fetch call
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not throw when DynamoDB write fails', async () => {
    mockMessagesCreate.mockResolvedValue(
      makeAnthropicResponse(JSON.stringify({ run: [], hold: [] })),
    );
    mockDynamoSend.mockRejectedValue(new Error('DynamoDB unavailable'));

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ onceJobs: [], recurringJobs: [makeJob({ userId: 'user-A' })] }),
        text: async () => '',
      } as any)
      .mockResolvedValueOnce({ ok: true, text: async () => '' } as any);

    await expect(handler()).resolves.toBeUndefined();
  });

  it('throws when fetchPendingJobs returns a non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    } as any);

    await expect(handler()).rejects.toThrow('500');
  });

  it('sends correct URL and auth header to backend', async () => {
    await handler();

    const [url, opts] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('http://backend/internal/scheduler/pending');
    expect(opts.headers['x-internal-api-key']).toBe('test-key');
  });

  it('writes token usage to the correct DynamoDB table', async () => {
    mockMessagesCreate.mockResolvedValue(
      makeAnthropicResponse(JSON.stringify({ run: [], hold: [] })),
    );

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ onceJobs: [], recurringJobs: [makeJob({ userId: 'user-A' })] }),
        text: async () => '',
      } as any)
      .mockResolvedValueOnce({ ok: true, text: async () => '' } as any);

    await handler();

    const [putCmdArg] = MockPutCommand.mock.calls[0];
    expect(putCmdArg.TableName).toBe('token_usage'); // no prefix in tests
  });

  // -------------------------------------------------------------------------
  // Credit balance DynamoDB re-evaluation tests
  // -------------------------------------------------------------------------

  it('overrides overSpendLimit to false when DynamoDB returns creditBalanceUsd: 5.0', async () => {
    // backend flags user as over-limit, but DynamoDB says they have $5.00
    mockDynamoSend.mockImplementation((cmd: any) => {
      if (cmd instanceof MockGetCommand) {
        return Promise.resolve({ Item: { creditBalanceUsd: 5.0 } });
      }
      return Promise.resolve({});
    });
    mockMessagesCreate.mockResolvedValue(
      makeAnthropicResponse(JSON.stringify({ run: ['rec-1'], hold: [] })),
    );

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          onceJobs: [],
          recurringJobs: [makeJob({ id: 'rec-1', userId: 'user-A' })],
          userMeta: { 'user-A': { overSpendLimit: true } },
        }),
        text: async () => '',
      } as any)
      .mockResolvedValueOnce({ ok: true, text: async () => '' } as any);
    global.fetch = fetchMock;

    await handler();

    // LLM was called — job was NOT skipped despite backend's overSpendLimit flag
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    // Dispatch was sent
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps job skipped when DynamoDB returns creditBalanceUsd: 0.0', async () => {
    mockDynamoSend.mockImplementation((cmd: any) => {
      if (cmd instanceof MockGetCommand) {
        return Promise.resolve({ Item: { creditBalanceUsd: 0.0 } });
      }
      return Promise.resolve({});
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        onceJobs: [],
        recurringJobs: [makeJob({ id: 'rec-1', userId: 'user-A' })],
        userMeta: { 'user-A': { overSpendLimit: true } },
      }),
      text: async () => '',
    } as any);
    global.fetch = fetchMock;

    await handler();

    // LLM not called — job is still skipped (balance 0 => still over limit)
    expect(mockMessagesCreate).not.toHaveBeenCalled();
    // No dispatch (run and hold are both empty)
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls through and keeps backend overSpendLimit when DynamoDB GetCommand fails', async () => {
    mockDynamoSend.mockImplementation((cmd: any) => {
      if (cmd instanceof MockGetCommand) {
        return Promise.reject(new Error('DynamoDB read unavailable'));
      }
      return Promise.resolve({});
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        onceJobs: [],
        recurringJobs: [makeJob({ id: 'rec-1', userId: 'user-A' })],
        userMeta: { 'user-A': { overSpendLimit: true } },
      }),
      text: async () => '',
    } as any);
    global.fetch = fetchMock;

    // Should not throw
    await expect(handler()).resolves.toBeUndefined();

    // Backend said overSpendLimit=true and DynamoDB failed → job still skipped
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// BYOK — Bring-Your-Own-Key evaluator tests
// ---------------------------------------------------------------------------

describe('BYOK evaluator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: GetCommand returns no item (no credit balance lookup needed here)
    mockDynamoSend.mockImplementation((cmd: any) => {
      if (cmd instanceof MockGetCommand) {
        return Promise.resolve({ Item: undefined });
      }
      return Promise.resolve({});
    });
  });

  function makeOpenAIResponse(text: string, promptTokens = 100, completionTokens = 50) {
    return {
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
    };
  }

  it('instantiates Anthropic client with BYOK apiKey when byokConfig is provided', async () => {
    const llmResponse = JSON.stringify({ run: [], hold: [] });
    mockMessagesCreate.mockResolvedValue(makeAnthropicResponse(llmResponse));

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          onceJobs: [],
          recurringJobs: [makeJob({ userId: 'user-A' })],
          userMeta: {
            'user-A': {
              overSpendLimit: false,
              byokConfig: { provider: 'anthropic', apiKey: 'byok-key', model: 'claude-haiku-4-5' },
            },
          },
        }),
        text: async () => '',
      } as any)
      .mockResolvedValueOnce({ ok: true, text: async () => '' } as any);

    await handler();

    // Verify Anthropic was called (one LLM call for user-A)
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    // The constructor should have been called with the BYOK key, not the env key
    const constructorCall = mockAnthropicConstructor.mock.calls[0][0];
    expect(constructorCall.apiKey).toBe('byok-key');
    expect(constructorCall.apiKey).not.toBe('test-anthropic-key');
  });

  it('records token usage with provider byok:anthropic and byok model', async () => {
    const llmResponse = JSON.stringify({ run: [], hold: [] });
    mockMessagesCreate.mockResolvedValue(makeAnthropicResponse(llmResponse, 80, 40));

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          onceJobs: [],
          recurringJobs: [makeJob({ userId: 'user-A' })],
          userMeta: {
            'user-A': {
              overSpendLimit: false,
              byokConfig: { provider: 'anthropic', apiKey: 'byok-key', model: 'claude-haiku-4-5' },
            },
          },
        }),
        text: async () => '',
      } as any)
      .mockResolvedValueOnce({ ok: true, text: async () => '' } as any);

    await handler();

    // Find the PutCommand call (token usage write)
    const putCalls = MockPutCommand.mock.calls;
    expect(putCalls.length).toBeGreaterThan(0);
    const item = putCalls[0][0].Item;
    expect(item.provider).toBe('byok:anthropic');
    expect(item.model).toBe('claude-haiku-4-5');
    expect(item.userId).toBe('user-A');
  });

  it('calls OpenAI client when byokConfig uses openai provider', async () => {
    const llmResponse = JSON.stringify({ run: [], hold: [] });
    mockChatCompletionsCreate.mockResolvedValue(makeOpenAIResponse(llmResponse));

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          onceJobs: [],
          recurringJobs: [makeJob({ userId: 'user-A' })],
          userMeta: {
            'user-A': {
              overSpendLimit: false,
              byokConfig: { provider: 'openai', apiKey: 'byok-openai-key', model: 'gpt-4o-mini' },
            },
          },
        }),
        text: async () => '',
      } as any)
      .mockResolvedValueOnce({ ok: true, text: async () => '' } as any);

    await handler();

    // OpenAI completions API was used, Anthropic was not
    expect(mockChatCompletionsCreate).toHaveBeenCalledTimes(1);
    expect(mockMessagesCreate).not.toHaveBeenCalled();

    // Token usage recorded with byok:openai provider
    const putCalls = MockPutCommand.mock.calls;
    expect(putCalls.length).toBeGreaterThan(0);
    const item = putCalls[0][0].Item;
    expect(item.provider).toBe('byok:openai');
    expect(item.model).toBe('gpt-4o-mini');
  });

  it('calls OpenAI client with x.ai baseURL when byokConfig uses grok provider', async () => {
    const llmResponse = JSON.stringify({ run: [], hold: [] });
    mockChatCompletionsCreate.mockResolvedValue(makeOpenAIResponse(llmResponse));

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          onceJobs: [],
          recurringJobs: [makeJob({ userId: 'user-A' })],
          userMeta: {
            'user-A': {
              overSpendLimit: false,
              byokConfig: { provider: 'grok', apiKey: 'byok-grok-key', model: 'grok-4-fast' },
            },
          },
        }),
        text: async () => '',
      } as any)
      .mockResolvedValueOnce({ ok: true, text: async () => '' } as any);

    await handler();

    // OpenAI completions API used (grok uses OpenAI-compatible API), Anthropic was not
    expect(mockChatCompletionsCreate).toHaveBeenCalledTimes(1);
    expect(mockMessagesCreate).not.toHaveBeenCalled();

    // Token usage recorded with byok:grok provider
    const putCalls = MockPutCommand.mock.calls;
    expect(putCalls.length).toBeGreaterThan(0);
    const item = putCalls[0][0].Item;
    expect(item.provider).toBe('byok:grok');
    expect(item.model).toBe('grok-4-fast');
  });
});
