import { v4 as uuidv4 } from 'uuid';
import type { LLMRouter } from '../ai/router.js';
import type { IMainDatabase, ScheduledJob } from '../storage/main-db.js';
import { evaluateRecurringJobs } from './evaluator.js';
import type { JobRunner } from './job-runner.js';

export class Scheduler {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private isPolling = false;
  private static readonly POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    private readonly db: IMainDatabase,
    private readonly jobRunner: JobRunner,
    private readonly llmRouter: LLMRouter,
  ) {}

  start(): void {
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(() => this.safePoll(), Scheduler.POLL_INTERVAL_MS);
    console.log('[Scheduler] Started — polling every 5 minutes');
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      console.log('[Scheduler] Stopped');
    }
  }

  private async safePoll(): Promise<void> {
    if (this.isPolling) return;
    this.isPolling = true;
    try {
      await this.poll();
    } catch (err) {
      console.error('[Scheduler] Poll error:', err);
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Apply pre-computed run/hold decisions from the Lambda evaluator.
   * Called by the /internal/scheduler/dispatch endpoint.
   */
  async dispatch(decisions: { run: string[]; hold: Array<{ id: string; until: string }> }): Promise<void> {
    const { run, hold } = decisions;
    console.log(`[Scheduler] dispatch() — run: ${run.length}, hold: ${hold.length}`);

    // Fetch all affected jobs in one pass
    const allIds = new Set([...run, ...hold.map(h => h.id)]);
    const allJobs = await Promise.all([...allIds].map(id => this.db.getScheduledJob(id)));
    const jobMap = new Map(allJobs.filter(Boolean).map(j => [j!.id, j!]));

    // Run first, then apply hold (mirrors the poll() ordering so run-jobs get
    // their holdUntil set after execution)
    for (const id of run) {
      const job = jobMap.get(id);
      if (job) await this.runJob(job, true);
    }

    for (const { id, until } of hold) {
      const holdUntil = new Date(until);
      if (!isNaN(holdUntil.getTime())) {
        try {
          await this.db.updateScheduledJobStatus(id, { holdUntil });
          console.log(`[Scheduler] Job ${id} held until ${holdUntil.toISOString()}`);
        } catch (err) {
          console.error(`[Scheduler] Failed to hold job ${id}:`, err);
        }
      } else {
        console.warn(`[Scheduler] Job ${id} hold has invalid date: ${until}`);
      }
    }
  }

  private async poll(): Promise<void> {
    console.log('[Scheduler] Polling...');

    // Step 1: Once jobs — pure time comparison
    const dueOnce = await this.db.getDueOnceJobs();
    if (dueOnce.length > 0) {
      console.log(`[Scheduler] Found ${dueOnce.length} due once-job(s)`);
    }
    for (const job of dueOnce) {
      // One-time jobs always save to chat since they were explicitly scheduled to run
      await this.runJob(job, true);
    }

    // Step 2: Recurring jobs — AI evaluates which to run
    const recurring = await this.db.getPendingRecurringJobs();
    if (recurring.length > 0) {
      console.log(`[Scheduler] Evaluating ${recurring.length} recurring job(s)`);
      const { run, hold } = await evaluateRecurringJobs(recurring, this.llmRouter);

      // Build a map of hold decisions for quick lookup after running
      const holdMap = new Map(hold.map(h => [h.id, h.until]));

      // Run triggered jobs — only jobs in 'run' list should execute and save messages
      for (const id of run) {
        const job = recurring.find(j => j.id === id);
        if (job) {
          await this.runJob(job, true);
        }
      }

      // Apply hold decisions after running (covers both non-run jobs and next-run times for run jobs)
      for (const { id, until } of hold) {
        const holdUntil = new Date(until);
        if (!isNaN(holdUntil.getTime())) {
          try {
            await this.db.updateScheduledJobStatus(id, { holdUntil });
            console.log(`[Scheduler] Job ${id} held until ${holdUntil.toISOString()}`);
          } catch (err) {
            console.error(`[Scheduler] Failed to hold job ${id}:`, err);
          }
        } else {
          console.warn(`[Scheduler] Job ${id} hold has invalid date: ${until}`);
        }
      }
    }
  }

  private async runJob(job: ScheduledJob, saveToChat: boolean = false): Promise<void> {
    console.log(`[Scheduler] Running job ${job.id}: ${job.description.slice(0, 60)}`);
    await this.db.updateScheduledJobStatus(job.id, { status: 'running', holdUntil: null });
    try {
      await this.jobRunner.run(job, saveToChat);
      const status = job.scheduleType === 'once' ? 'completed' : 'pending';
      await this.db.updateScheduledJobStatus(job.id, {
        status,
        lastRunAt: new Date(),
        runCount: job.runCount + 1,
        // holdUntil is set by the scheduler after runJob using the evaluator's decision
      });
      console.log(`[Scheduler] Job ${job.id} completed, status → ${status}`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await this.db.updateScheduledJobStatus(job.id, {
        status: 'failed',
        lastError: errorMsg,
        lastRunAt: new Date(),
        runCount: job.runCount + 1,
        holdUntil: null,
      });
      console.error(`[Scheduler] Job ${job.id} failed:`, err);

      // Save error to role's chat so the user sees it without opening the dialog
      const shortDesc = job.description.length > 60
        ? job.description.slice(0, 60) + '…'
        : job.description;
      const now = new Date().toISOString();
      await this.db.saveMessage({
        id: uuidv4(),
        userId: job.userId,
        roleId: job.roleId,
        groupId: null,
        from: 'system' as const,
        content: `*Scheduled job failed: ${shortDesc}*`,
        createdAt: now,
      });
      await this.db.saveMessage({
        id: uuidv4(),
        userId: job.userId,
        roleId: job.roleId,
        groupId: null,
        from: 'system' as const,
        content: `**Error running scheduled task:**\n\`\`\`\n${errorMsg}\n\`\`\``,
        createdAt: new Date().toISOString(),
      });
    }
  }
}
