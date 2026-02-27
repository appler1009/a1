import type { LLMRouter } from '../ai/router.js';
import type { MainDatabase, ScheduledJob } from '../storage/main-db.js';
import { evaluateRecurringJobs } from './evaluator.js';
import type { JobRunner } from './job-runner.js';

export class Scheduler {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private isPolling = false;
  private static readonly POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    private readonly db: MainDatabase,
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

  private async poll(): Promise<void> {
    console.log('[Scheduler] Polling...');

    // Step 1: Once jobs — pure time comparison
    const dueOnce = this.db.getDueOnceJobs();
    if (dueOnce.length > 0) {
      console.log(`[Scheduler] Found ${dueOnce.length} due once-job(s)`);
    }
    for (const job of dueOnce) {
      await this.runJob(job);
    }

    // Step 2: Recurring jobs — AI evaluates which to run
    const recurring = this.db.getPendingRecurringJobs();
    if (recurring.length > 0) {
      console.log(`[Scheduler] Evaluating ${recurring.length} recurring job(s)`);
      const toRun = await evaluateRecurringJobs(recurring, this.llmRouter);
      for (const id of toRun) {
        const job = recurring.find(j => j.id === id);
        if (job) await this.runJob(job);
      }
    }
  }

  private async runJob(job: ScheduledJob): Promise<void> {
    console.log(`[Scheduler] Running job ${job.id}: ${job.description.slice(0, 60)}`);
    this.db.updateScheduledJobStatus(job.id, { status: 'running' });
    try {
      await this.jobRunner.run(job);
      const status = job.scheduleType === 'once' ? 'completed' : 'pending';
      this.db.updateScheduledJobStatus(job.id, {
        status,
        lastRunAt: new Date(),
        runCount: job.runCount + 1,
      });
      console.log(`[Scheduler] Job ${job.id} completed, status → ${status}`);
    } catch (err) {
      this.db.updateScheduledJobStatus(job.id, {
        status: 'failed',
        lastError: String(err),
        lastRunAt: new Date(),
        runCount: job.runCount + 1,
      });
      console.error(`[Scheduler] Job ${job.id} failed:`, err);
    }
  }
}
