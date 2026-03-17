import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — declared before any imports of the module under test
// ---------------------------------------------------------------------------

const mockGetByokRouter = vi.fn();
const mockMcpManager = {
  listAllTools: vi.fn(),
};
const mockUpdateToolManifest = vi.fn();
const mockNotifyScheduledJobCompletion = vi.fn();

vi.mock('../utils/byok.js', () => ({
  getByokRouter: mockGetByokRouter,
}));

vi.mock('../mcp/index.js', () => ({
  mcpManager: mockMcpManager,
}));

vi.mock('../mcp/in-process/meta-mcp-search.js', () => ({
  updateToolManifest: mockUpdateToolManifest,
}));

vi.mock('../discord/bot.js', () => ({
  notifyScheduledJobCompletion: mockNotifyScheduledJobCompletion,
}));

// ---------------------------------------------------------------------------
// Import module under test after mocks are in place
// ---------------------------------------------------------------------------

const { JobRunner } = await import('../scheduler/job-runner.js');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<{
  id: string;
  userId: string;
  roleId: string;
  description: string;
  scheduleType: 'once' | 'recurring';
  runCount: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  holdUntil: Date | null;
  lastRunAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}> = {}) {
  return {
    id: 'job-1',
    userId: 'user-1',
    roleId: 'role-1',
    description: 'Send daily report',
    scheduleType: 'once' as const,
    runCount: 0,
    status: 'pending' as const,
    holdUntil: null,
    lastRunAt: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeLLMRouter(overrides: Partial<{ complete: ReturnType<typeof vi.fn>; convertMCPToolsToOpenAI: ReturnType<typeof vi.fn> }> = {}) {
  return {
    complete: vi.fn().mockResolvedValue({ content: 'Task completed successfully.', toolCalls: [] }),
    convertMCPToolsToOpenAI: vi.fn().mockReturnValue([]),
    ...overrides,
  };
}

function makeDb(overrides: Partial<{
  getUser: ReturnType<typeof vi.fn>;
  getRole: ReturnType<typeof vi.fn>;
  saveMessage: ReturnType<typeof vi.fn>;
  updateScheduledJobStatus: ReturnType<typeof vi.fn>;
  recordTokenUsage: ReturnType<typeof vi.fn>;
}> = {}) {
  return {
    getUser: vi.fn().mockResolvedValue({ id: 'user-1', creditBalanceUsd: 10.0 }),
    getRole: vi.fn().mockResolvedValue({ id: 'role-1', name: 'Daily Reporter', systemPrompt: '' }),
    saveMessage: vi.fn().mockResolvedValue(undefined),
    updateScheduledJobStatus: vi.fn().mockResolvedValue(undefined),
    recordTokenUsage: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // mcpManager.listAllTools returns empty list by default — keeps run() fast
  mockMcpManager.listAllTools.mockResolvedValue([]);
  mockUpdateToolManifest.mockResolvedValue(undefined);
  mockNotifyScheduledJobCompletion.mockResolvedValue(undefined);

  // Default: no BYOK router
  mockGetByokRouter.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// JobRunner.execute
// ---------------------------------------------------------------------------

describe('JobRunner.execute', () => {
  it('skips job and saves message when credit balance < 0.001 and no BYOK', async () => {
    const db = makeDb({
      getUser: vi.fn().mockResolvedValue({ id: 'user-1', creditBalanceUsd: 0.0 }),
    });
    const llmRouter = makeLLMRouter();
    const executeTool = vi.fn();
    const runner = new JobRunner(llmRouter as any, db as any, executeTool);

    await runner.execute(makeJob());

    // Job was skipped — status never updated to running
    expect(db.updateScheduledJobStatus).not.toHaveBeenCalled();
    // A message was saved explaining the skip
    expect(db.saveMessage).toHaveBeenCalledTimes(1);
    const savedContent = db.saveMessage.mock.calls[0][0].content as string;
    expect(savedContent).toContain('credit balance');
    // LLM was not called
    expect(llmRouter.complete).not.toHaveBeenCalled();
  });

  it('also skips when creditBalanceUsd is just below the threshold (0.0009)', async () => {
    const db = makeDb({
      getUser: vi.fn().mockResolvedValue({ id: 'user-1', creditBalanceUsd: 0.0009 }),
    });
    const llmRouter = makeLLMRouter();
    const runner = new JobRunner(llmRouter as any, db as any, vi.fn());

    await runner.execute(makeJob());

    expect(db.updateScheduledJobStatus).not.toHaveBeenCalled();
    expect(db.saveMessage).toHaveBeenCalledTimes(1);
  });

  it('runs job when creditBalanceUsd >= 0.001 and no BYOK', async () => {
    const db = makeDb({
      getUser: vi.fn().mockResolvedValue({ id: 'user-1', creditBalanceUsd: 5.0 }),
    });
    const llmRouter = makeLLMRouter();
    const runner = new JobRunner(llmRouter as any, db as any, vi.fn());

    await runner.execute(makeJob({ scheduleType: 'once' }));

    // Status should go running → completed
    expect(db.updateScheduledJobStatus).toHaveBeenCalledWith('job-1', expect.objectContaining({ status: 'running' }));
    expect(db.updateScheduledJobStatus).toHaveBeenCalledWith('job-1', expect.objectContaining({ status: 'completed' }));
    expect(llmRouter.complete).toHaveBeenCalled();
  });

  it('runs job when BYOK is configured even if creditBalanceUsd is 0', async () => {
    const db = makeDb({
      getUser: vi.fn().mockResolvedValue({ id: 'user-1', creditBalanceUsd: 0.0 }),
    });
    const byokRouter = makeLLMRouter();
    mockGetByokRouter.mockResolvedValue(byokRouter);

    const systemRouter = makeLLMRouter();
    const runner = new JobRunner(systemRouter as any, db as any, vi.fn());

    await runner.execute(makeJob());

    // Job should run despite zero balance because BYOK exempts credit check
    expect(db.updateScheduledJobStatus).toHaveBeenCalledWith('job-1', expect.objectContaining({ status: 'running' }));
    // BYOK router was used, not system router
    expect(byokRouter.complete).toHaveBeenCalled();
    expect(systemRouter.complete).not.toHaveBeenCalled();
  });

  it('uses BYOK router when getByokRouter returns one', async () => {
    const db = makeDb();
    const byokRouter = makeLLMRouter();
    mockGetByokRouter.mockResolvedValue(byokRouter);

    const systemRouter = makeLLMRouter();
    const runner = new JobRunner(systemRouter as any, db as any, vi.fn());

    await runner.execute(makeJob());

    expect(byokRouter.complete).toHaveBeenCalled();
    expect(systemRouter.complete).not.toHaveBeenCalled();
  });

  it('uses system llmRouter when getByokRouter returns null', async () => {
    const db = makeDb();
    mockGetByokRouter.mockResolvedValue(null);

    const systemRouter = makeLLMRouter();
    const runner = new JobRunner(systemRouter as any, db as any, vi.fn());

    await runner.execute(makeJob());

    expect(systemRouter.complete).toHaveBeenCalled();
  });

  it('marks job as running then completed on success (once job)', async () => {
    const db = makeDb();
    const systemRouter = makeLLMRouter();
    const runner = new JobRunner(systemRouter as any, db as any, vi.fn());
    const job = makeJob({ scheduleType: 'once', runCount: 3 });

    await runner.execute(job);

    const calls = db.updateScheduledJobStatus.mock.calls;
    expect(calls[0]).toEqual(['job-1', expect.objectContaining({ status: 'running', holdUntil: null })]);
    expect(calls[1]).toEqual(['job-1', expect.objectContaining({ status: 'completed', runCount: 4 })]);
  });

  it('marks recurring job back to pending (not completed) on success', async () => {
    const db = makeDb();
    const systemRouter = makeLLMRouter();
    const runner = new JobRunner(systemRouter as any, db as any, vi.fn());
    const job = makeJob({ scheduleType: 'recurring', runCount: 1 });

    await runner.execute(job);

    const finalCall = db.updateScheduledJobStatus.mock.calls.at(-1);
    expect(finalCall[1]).toMatchObject({ status: 'pending' });
  });

  it('marks job as failed and saves error message when run() throws', async () => {
    const db = makeDb();
    const erroringRouter = makeLLMRouter({
      complete: vi.fn().mockRejectedValue(new Error('LLM timeout')),
    });
    const runner = new JobRunner(erroringRouter as any, db as any, vi.fn());

    await runner.execute(makeJob());

    const calls = db.updateScheduledJobStatus.mock.calls;
    expect(calls[0]).toEqual(['job-1', expect.objectContaining({ status: 'running' })]);
    expect(calls[1]).toEqual(['job-1', expect.objectContaining({ status: 'failed', lastError: 'LLM timeout' })]);

    // Error message saved to chat history
    const errorMsgCall = db.saveMessage.mock.calls.find(
      (c: any) => (c[0].content as string).includes('Error running scheduled task'),
    );
    expect(errorMsgCall).toBeDefined();
    expect(errorMsgCall[0].content).toContain('LLM timeout');
  });

  it('calls getByokRouter with the job userId', async () => {
    const db = makeDb();
    const runner = new JobRunner(makeLLMRouter() as any, db as any, vi.fn());
    const job = makeJob({ userId: 'user-xyz' });

    await runner.execute(job);

    expect(mockGetByokRouter).toHaveBeenCalledWith('user-xyz');
  });

  it('does not skip job when getUser returns null (treat balance as 0) but BYOK is present', async () => {
    const db = makeDb({
      getUser: vi.fn().mockResolvedValue(null),
    });
    const byokRouter = makeLLMRouter();
    mockGetByokRouter.mockResolvedValue(byokRouter);

    const runner = new JobRunner(makeLLMRouter() as any, db as any, vi.fn());

    await runner.execute(makeJob());

    // BYOK exempts even when user not found
    expect(db.updateScheduledJobStatus).toHaveBeenCalledWith('job-1', expect.objectContaining({ status: 'running' }));
    expect(byokRouter.complete).toHaveBeenCalled();
  });

  it('skips job and saves message when getUser returns null and no BYOK', async () => {
    const db = makeDb({
      getUser: vi.fn().mockResolvedValue(null),
    });
    mockGetByokRouter.mockResolvedValue(null);

    const systemRouter = makeLLMRouter();
    const runner = new JobRunner(systemRouter as any, db as any, vi.fn());

    await runner.execute(makeJob());

    expect(db.updateScheduledJobStatus).not.toHaveBeenCalled();
    expect(db.saveMessage).toHaveBeenCalledTimes(1);
    expect(systemRouter.complete).not.toHaveBeenCalled();
  });
});
