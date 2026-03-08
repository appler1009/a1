import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScheduledJob {
  id: string;
  userId: string;
  roleId: string;
  description: string;
  scheduleType: 'once' | 'recurring';
  lastRunAt: string | null; // ISO 8601
}

interface PendingJobsResponse {
  onceJobs: ScheduledJob[];
  recurringJobs: ScheduledJob[];
}

interface DispatchRequest {
  run: string[];
  hold: Array<{ id: string; until: string }>;
}

interface EvaluatorResult {
  run: string[];
  hold: Array<{ id: string; until: string }>;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BACKEND_URL = process.env.BACKEND_URL!;       // e.g. http://internal-alb/
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY!;

// LLM_PROVIDER: 'anthropic' | 'openai' | 'grok'  (default: anthropic)
const LLM_PROVIDER = (process.env.LLM_PROVIDER || 'anthropic') as 'anthropic' | 'openai' | 'grok';

const PROVIDER_DEFAULTS: Record<typeof LLM_PROVIDER, string> = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4o-mini',
  grok: 'grok-3-mini-fast',
};

const EVALUATOR_MODEL = process.env.EVALUATOR_MODEL || PROVIDER_DEFAULTS[LLM_PROVIDER];

// ---------------------------------------------------------------------------
// LLM provider abstraction
// The evaluator only needs a single text completion — no tools, no streaming.
// ---------------------------------------------------------------------------

async function llmComplete(prompt: string): Promise<string> {
  if (LLM_PROVIDER === 'anthropic') {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    const res = await client.messages.create({
      model: EVALUATOR_MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });
    return res.content[0].type === 'text' ? res.content[0].text : '';
  }

  if (LLM_PROVIDER === 'grok') {
    const client = new OpenAI({
      apiKey: process.env.GROK_API_KEY!,
      baseURL: 'https://api.x.ai/v1',
    });
    const res = await client.chat.completions.create({
      model: EVALUATOR_MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });
    return res.choices[0]?.message?.content ?? '';
  }

  if (LLM_PROVIDER === 'openai') {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
    const res = await client.chat.completions.create({
      model: EVALUATOR_MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });
    return res.choices[0]?.message?.content ?? '';
  }

  throw new Error(`Unknown LLM_PROVIDER: ${LLM_PROVIDER}`);
}

// ---------------------------------------------------------------------------
// Backend API client
// ---------------------------------------------------------------------------

async function fetchPendingJobs(): Promise<PendingJobsResponse> {
  const url = `${BACKEND_URL}/internal/scheduler/pending`;
  const res = await fetch(url, {
    headers: { 'x-internal-api-key': INTERNAL_API_KEY },
  });
  if (!res.ok) {
    throw new Error(`GET ${url} → ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<PendingJobsResponse>;
}

async function dispatchDecisions(payload: DispatchRequest): Promise<void> {
  const url = `${BACKEND_URL}/internal/scheduler/dispatch`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-api-key': INTERNAL_API_KEY,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`POST ${url} → ${res.status} ${await res.text()}`);
  }
}

// ---------------------------------------------------------------------------
// LLM evaluation (same prompt as the backend evaluator)
// ---------------------------------------------------------------------------

async function evaluateRecurringJobs(jobs: ScheduledJob[]): Promise<EvaluatorResult> {
  if (jobs.length === 0) return { run: [], hold: [] };

  const now = new Date();
  const timeStr =
    now.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    }) + ' UTC';

  const jobLines = jobs
    .map(j => {
      const lastRun = j.lastRunAt ? new Date(j.lastRunAt).toISOString() : 'never';
      return `- ID: ${j.id} | Last run: ${lastRun} | "${j.description}"`;
    })
    .join('\n');

  const prompt = `You are a job scheduler evaluator. Current time: ${timeStr}

Evaluate each recurring scheduled job below. For each job decide:
- RUN: the job description indicates it should execute now, and enough time has passed since last run
- HOLD: too early to run (e.g. a daily job that ran this morning), set holdUntil to when it should next be checked (ISO 8601)
- SKIP: cannot determine schedule or no action needed — omit from response

The scheduler re-checks every 5 minutes, but a HOLD skips a job entirely until its holdUntil time, saving unnecessary AI evaluation.

IMPORTANT: For every job you decide to RUN, also include it in the "hold" array with the next time it should be re-evaluated (i.e. the next scheduled run time). This prevents the scheduler from re-evaluating the job immediately after it runs.

Jobs to evaluate:
${jobLines}

Reply with ONLY a valid JSON object like:
{
  "run": ["id-of-job-to-run"],
  "hold": [{"id": "id-of-job-to-hold", "until": "2026-02-27T09:00:00Z"}]
}
Both arrays may be empty. Jobs in "run" should also appear in "hold" with their next scheduled run time. Do not include any other text.`;

  console.log(`[Evaluator] Evaluating ${jobs.length} job(s) with ${LLM_PROVIDER}/${EVALUATOR_MODEL}`);

  const text = (await llmComplete(prompt)).trim();

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    console.warn('[Evaluator] No JSON object found in response, skipping all jobs');
    return { run: [], hold: [] };
  }

  const parsed = JSON.parse(match[0]) as {
    run?: string[];
    hold?: Array<{ id: string; until: string }>;
  };

  const result: EvaluatorResult = {
    run: Array.isArray(parsed.run) ? parsed.run : [],
    hold: Array.isArray(parsed.hold) ? parsed.hold : [],
  };

  console.log(`[Evaluator] Decision → run: [${result.run.join(', ')}]`);
  console.log(
    `[Evaluator] Decision → hold: [${result.hold.map(h => `${h.id} until ${h.until}`).join(', ')}]`,
  );

  return result;
}

// ---------------------------------------------------------------------------
// Lambda handler
// ---------------------------------------------------------------------------

export const handler = async (): Promise<void> => {
  console.log('[SchedulerLambda] Invoked');

  // 1. Fetch jobs that are ready to be considered
  const { onceJobs, recurringJobs } = await fetchPendingJobs();
  console.log(
    `[SchedulerLambda] ${onceJobs.length} once-job(s), ${recurringJobs.length} recurring job(s)`,
  );

  if (onceJobs.length === 0 && recurringJobs.length === 0) {
    console.log('[SchedulerLambda] Nothing to do');
    return;
  }

  const run: string[] = [];
  const hold: Array<{ id: string; until: string }> = [];

  // 2. Once-jobs: due time already checked by the backend — run them all
  for (const job of onceJobs) {
    run.push(job.id);
  }

  // 3. Recurring jobs: ask the LLM
  if (recurringJobs.length > 0) {
    const result = await evaluateRecurringJobs(recurringJobs);
    run.push(...result.run);
    hold.push(...result.hold);
  }

  // 4. Send decisions back to the backend
  if (run.length > 0 || hold.length > 0) {
    await dispatchDecisions({ run, hold });
    console.log(`[SchedulerLambda] Dispatched: ${run.length} to run, ${hold.length} to hold`);
  } else {
    console.log('[SchedulerLambda] No actions to dispatch');
  }
};
