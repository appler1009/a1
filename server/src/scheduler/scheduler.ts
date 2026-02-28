import { v4 as uuidv4 } from 'uuid';
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
      const { run, hold } = await evaluateRecurringJobs(recurring, this.llmRouter);

      // Apply hold decisions first
      for (const { id, until } of hold) {
        const holdUntil = new Date(until);
        if (!isNaN(holdUntil.getTime())) {
          this.db.updateScheduledJobStatus(id, { holdUntil });
          console.log(`[Scheduler] Job ${id} held until ${holdUntil.toISOString()}`);
        } else {
          console.warn(`[Scheduler] Job ${id} hold has invalid date: ${until}`);
        }
      }

      // Run triggered jobs
      for (const id of run) {
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
        holdUntil: null,  // clear any hold — evaluator will re-set it next poll if needed
      });
      console.log(`[Scheduler] Job ${job.id} completed, status → ${status}`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.db.updateScheduledJobStatus(job.id, {
        status: 'failed',
        lastError: errorMsg,
        lastRunAt: new Date(),
        runCount: job.runCount + 1,
      });
      console.error(`[Scheduler] Job ${job.id} failed:`, err);

      // Save error to role's chat so the user sees it without opening the dialog
      const shortDesc = job.description.length > 60
        ? job.description.slice(0, 60) + '…'
        : job.description;
      const now = new Date().toISOString();
      this.db.saveMessage({
        id: uuidv4(),
        userId: job.userId,
        roleId: job.roleId,
        groupId: null,
        role: 'system',
        content: `*Scheduled job failed: ${shortDesc}*`,
        createdAt: now,
      });
      this.db.saveMessage({
        id: uuidv4(),
        userId: job.userId,
        roleId: job.roleId,
        groupId: null,
        role: 'assistant',
        content: `**Error running scheduled task:**\n\`\`\`\n${errorMsg}\n\`\`\``,
        createdAt: new Date().toISOString(),
      });
    }
  }
}
