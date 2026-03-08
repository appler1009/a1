import type { MCPToolInfo } from '@local-agent/shared';
import type { InProcessMCPModule } from '../adapters/InProcessAdapter.js';
import type { IMainDatabase } from '../../storage/main-db.js';

export class SchedulerInProcess implements InProcessMCPModule {
  [key: string]: unknown;

  constructor(
    private readonly db: IMainDatabase,
    private readonly userId: string,
    private readonly roleId: string,
  ) {}

  getSystemPromptSummary(): string {
    return 'Scheduler — schedule one-time or recurring tasks for future autonomous execution.';
  }

  getSystemPrompt(): string {
    return `## SCHEDULED TASKS
When the user asks to schedule, automate, or run something in the future (e.g. "every morning", "remind me", "check this daily", "run this at 9am"), you MUST use \`search_tool\` to find the scheduler tools:
- search_tool("schedule a task") → finds \`schedule_task\` and \`list_scheduled_jobs\`

**Rules:**
- ALWAYS use \`schedule_task\` when the user wants something done automatically in the future — never just describe how to do it
- For recurring jobs, embed the full schedule in the description (e.g. "Every weekday at 8am, fetch AAPL stock price and save to memory")
- For one-time jobs, extract the exact datetime from the user's intent and pass it as ISO 8601 in \`runAt\`
- Use \`list_scheduled_jobs\` when the user asks what tasks are scheduled`;
  }

  async getTools(): Promise<MCPToolInfo[]> {
    return [
      {
        name: 'schedule_task',
        description: `Schedule a task for future autonomous execution.
For 'once' jobs: extract the specific datetime from user intent and provide it as ISO 8601 in the runAt field.
For 'recurring' jobs: include the intended schedule inside the description itself (e.g. "Every morning at 9am, fetch AAPL stock price"). Omit runAt for recurring jobs.
The description must be self-contained and detailed enough for autonomous execution without user interaction.`,
        inputSchema: {
          type: 'object',
          properties: {
            description: {
              type: 'string',
              description: 'Self-contained task description. For recurring jobs, include the schedule (e.g. "Every morning at 9am, fetch AAPL stock price"). Must be detailed enough for autonomous execution.',
            },
            scheduleType: {
              type: 'string',
              enum: ['once', 'recurring'],
              description: "Type of schedule: 'once' for a specific datetime, 'recurring' for a natural-language recurring schedule",
            },
            runAt: {
              type: 'string',
              description: "ISO 8601 datetime — required when scheduleType is 'once', omit for 'recurring'",
            },
          },
          required: ['description', 'scheduleType'],
        },
      },
      {
        name: 'list_scheduled_jobs',
        description: 'List scheduled tasks for the current user.',
        inputSchema: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
              description: 'Optional filter by status',
            },
          },
        },
      },
    ];
  }

  async schedule_task(args: {
    description: string;
    scheduleType: 'once' | 'recurring';
    runAt?: string;
  }): Promise<unknown> {
    const { description, scheduleType, runAt } = args;

    if (!description?.trim()) {
      return { error: 'description is required' };
    }

    if (scheduleType === 'once') {
      if (!runAt) {
        return { error: "runAt is required for 'once' jobs" };
      }
      const runAtDate = new Date(runAt);
      if (isNaN(runAtDate.getTime())) {
        return { error: `Invalid runAt date: ${runAt}` };
      }
      if (runAtDate <= new Date()) {
        return { error: `runAt must be in the future (got ${runAt})` };
      }

      const job = await this.db.createScheduledJob({
        userId: this.userId,
        roleId: this.roleId,
        description,
        scheduleType: 'once',
        runAt: runAtDate,
      });

      return {
        success: true,
        jobId: job.id,
        message: `Scheduled one-time task for ${runAtDate.toISOString()}`,
        job: { id: job.id, description, scheduleType: 'once', runAt: runAtDate.toISOString() },
      };
    } else {
      const job = await this.db.createScheduledJob({
        userId: this.userId,
        roleId: this.roleId,
        description,
        scheduleType: 'recurring',
        runAt: undefined,
      });

      return {
        success: true,
        jobId: job.id,
        message: `Scheduled recurring task. The scheduler will evaluate every 5 minutes whether to run it based on the description.`,
        job: { id: job.id, description, scheduleType: 'recurring' },
      };
    }
  }

  async list_scheduled_jobs(args: { status?: string }): Promise<unknown> {
    const jobs = await this.db.listScheduledJobs(this.userId, args?.status ? { status: args.status } : undefined);

    if (jobs.length === 0) {
      return { jobs: [], message: 'No scheduled jobs found.' };
    }

    const formatted = jobs.map(j => ({
      id: j.id,
      description: j.description,
      scheduleType: j.scheduleType,
      status: j.status,
      runAt: j.runAt?.toISOString() ?? null,
      lastRunAt: j.lastRunAt?.toISOString() ?? null,
      runCount: j.runCount,
      lastError: j.lastError,
      createdAt: j.createdAt.toISOString(),
    }));

    return { jobs: formatted, total: jobs.length };
  }
}
