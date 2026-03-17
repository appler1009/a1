import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

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

interface UserByokConfig {
  provider: 'anthropic' | 'openai' | 'grok';
  apiKey: string;
  model: string;
}

interface UserMeta {
  overSpendLimit: boolean;
  byokConfig?: UserByokConfig;
}

interface PendingJobsResponse {
  onceJobs: ScheduledJob[];
  recurringJobs: ScheduledJob[];
  userMeta: Record<string, UserMeta>;
}

interface DispatchRequest {
  run: string[];
  hold: Array<{ id: string; until: string }>;
}

interface EvaluatorResult {
  run: string[];
  hold: Array<{ id: string; until: string }>;
  reasoning: Record<string, string>;
}

interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
}

interface LLMResult {
  text: string;
  usage: TokenUsage;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BACKEND_URL = process.env.BACKEND_URL!;       // e.g. http://internal-alb/
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY!;

// LLM_PROVIDER: 'anthropic' | 'openai' | 'grok'  (default: anthropic)
const LLM_PROVIDER = (process.env.LLM_PROVIDER || 'anthropic') as 'anthropic' | 'openai' | 'grok';

const PROVIDER_DEFAULTS: Record<typeof LLM_PROVIDER, string> = {
  anthropic: 'claude-haiku-4-5',
  openai: 'gpt-5-mini',
  grok: 'grok-4-1-fast-non-reasoning',
};

const EVALUATOR_MODEL = process.env.EVALUATOR_MODEL || PROVIDER_DEFAULTS[LLM_PROVIDER];

const TABLE_PREFIX = (process.env.DYNAMODB_TABLE_PREFIX ?? '').trim();
const TOKEN_USAGE_TABLE = `${TABLE_PREFIX}token_usage`;
const USERS_TABLE = `${TABLE_PREFIX}users`;

// ---------------------------------------------------------------------------
// DynamoDB client (lazy-initialised)
// ---------------------------------------------------------------------------

let dynamoClient: DynamoDBDocumentClient | null = null;

function getDynamoClient(): DynamoDBDocumentClient {
  if (!dynamoClient) {
    const raw = new DynamoDBClient({});
    dynamoClient = DynamoDBDocumentClient.from(raw, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return dynamoClient;
}

async function recordTokenUsage(userId: string, usage: TokenUsage, byok?: UserByokConfig): Promise<void> {
  try {
    const id = randomUUID();
    const now = new Date().toISOString();
    await getDynamoClient().send(new PutCommand({
      TableName: TOKEN_USAGE_TABLE,
      Item: {
        userId,
        sk: `${now}#${id}`,
        id,
        model: byok?.model ?? EVALUATOR_MODEL,
        provider: byok ? `byok:${byok.provider}` : LLM_PROVIDER,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        cachedInputTokens: usage.cachedInputTokens,
        cacheCreationTokens: usage.cacheCreationTokens,
        source: 'scheduler',
        createdAt: now,
      },
    }));
  } catch (err) {
    console.error('[TokenUsage] Failed to record token usage for user', userId, err);
  }
}

async function fetchUserCreditBalance(userId: string): Promise<number | undefined> {
  try {
    const result = await getDynamoClient().send(new GetCommand({
      TableName: USERS_TABLE,
      Key: { userId },
      ProjectionExpression: 'creditBalanceUsd',
    }));
    if (!result.Item) return undefined;
    return typeof result.Item.creditBalanceUsd === 'number' ? result.Item.creditBalanceUsd : 0;
  } catch (err) {
    console.error('[SpendLimit] Failed to fetch credit balance for user', userId, err);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// LLM provider abstraction
// The evaluator only needs a single text completion — no tools, no streaming.
// ---------------------------------------------------------------------------

async function llmComplete(prompt: string, byok?: UserByokConfig): Promise<LLMResult> {
  const provider = byok?.provider ?? LLM_PROVIDER;
  const model = byok?.model ?? EVALUATOR_MODEL;

  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey: byok?.apiKey ?? process.env.ANTHROPIC_API_KEY! });
    const res = await client.messages.create({
      model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = res.content[0].type === 'text' ? res.content[0].text : '';
    return {
      text,
      usage: {
        promptTokens: res.usage.input_tokens,
        completionTokens: res.usage.output_tokens,
        totalTokens: res.usage.input_tokens + res.usage.output_tokens,
        cachedInputTokens: (res.usage as any).cache_read_input_tokens ?? 0,
        cacheCreationTokens: (res.usage as any).cache_creation_input_tokens ?? 0,
      },
    };
  }

  if (provider === 'grok') {
    const client = new OpenAI({
      apiKey: byok?.apiKey ?? process.env.GROK_API_KEY!,
      baseURL: 'https://api.x.ai/v1',
    });
    const res = await client.chat.completions.create({
      model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });
    const promptTokens = res.usage?.prompt_tokens ?? 0;
    const completionTokens = res.usage?.completion_tokens ?? 0;
    return {
      text: res.choices[0]?.message?.content ?? '',
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        cachedInputTokens: (res.usage as any)?.prompt_tokens_details?.cached_tokens ?? 0,
        cacheCreationTokens: 0,
      },
    };
  }

  if (provider === 'openai') {
    const client = new OpenAI({ apiKey: byok?.apiKey ?? process.env.OPENAI_API_KEY! });
    const res = await client.chat.completions.create({
      model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });
    const promptTokens = res.usage?.prompt_tokens ?? 0;
    const completionTokens = res.usage?.completion_tokens ?? 0;
    return {
      text: res.choices[0]?.message?.content ?? '',
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        cachedInputTokens: (res.usage as any)?.prompt_tokens_details?.cached_tokens ?? 0,
        cacheCreationTokens: 0,
      },
    };
  }

  throw new Error(`Unknown provider: ${provider}`);
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
// LLM evaluation — one LLM call per user so token usage is attributed correctly
// ---------------------------------------------------------------------------

export function buildEvaluatorPrompt(jobs: ScheduledJob[]): string {
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

  return `You are a job scheduler evaluator. Current time: ${timeStr}

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
  "hold": [{"id": "id-of-job-to-hold", "until": "2026-02-27T09:00:00Z"}],
  "reasoning": {"id-of-job": "Brief explanation of why this job was run/held/skipped"}
}
Both arrays may be empty. Jobs in "run" should also appear in "hold" with their next scheduled run time. Include a reasoning entry for every evaluated job. Do not include any other text.`;
}

export function parseEvaluatorResponse(text: string): EvaluatorResult {
  const match = text.trim().match(/\{[\s\S]*\}/);
  if (!match) return { run: [], hold: [], reasoning: {} };

  const parsed = JSON.parse(match[0]) as {
    run?: string[];
    hold?: Array<{ id: string; until: string }>;
    reasoning?: Record<string, string>;
  };

  return {
    run: Array.isArray(parsed.run) ? parsed.run : [],
    hold: Array.isArray(parsed.hold) ? parsed.hold : [],
    reasoning: parsed.reasoning && typeof parsed.reasoning === 'object' ? parsed.reasoning : {},
  };
}

async function evaluateRecurringJobsForUser(
  userId: string,
  jobs: ScheduledJob[],
  byok?: UserByokConfig,
): Promise<EvaluatorResult> {
  const prompt = buildEvaluatorPrompt(jobs);
  const effectiveProvider = byok?.provider ?? LLM_PROVIDER;
  const effectiveModel = byok?.model ?? EVALUATOR_MODEL;

  console.log(
    `[Evaluator] Evaluating ${jobs.length} job(s) for user ${userId} | provider=${effectiveProvider} model=${effectiveModel}${byok ? ' (BYOK)' : ''}`,
  );
  console.log(`[Evaluator] Jobs to evaluate for user ${userId}:`);
  for (const job of jobs) {
    console.log(
      `[Evaluator]   id=${job.id} type=${job.scheduleType} lastRunAt=${job.lastRunAt ?? 'never'} description="${job.description}"`,
    );
  }
  console.log(`[Evaluator] Prompt for user ${userId}:\n${prompt}`);

  const { text, usage } = await llmComplete(prompt, byok);

  console.log(`[Evaluator] Raw response for user ${userId}:\n${text}`);

  // Record token usage attributed to this user
  await recordTokenUsage(userId, usage, byok);
  console.log(
    `[TokenUsage] user=${userId} prompt=${usage.promptTokens} completion=${usage.completionTokens} cached=${usage.cachedInputTokens} cacheCreation=${usage.cacheCreationTokens} total=${usage.totalTokens}`,
  );

  const result = parseEvaluatorResponse(text);
  if (result.run.length === 0 && result.hold.length === 0 && !text.trim().match(/\{[\s\S]*\}/)) {
    console.warn(`[Evaluator] No JSON found in response for user ${userId}, skipping`);
  }

  console.log(`[Evaluator] user=${userId} → run: [${result.run.join(', ')}]`);
  console.log(
    `[Evaluator] user=${userId} → hold: [${result.hold.map(h => `${h.id} until ${h.until}`).join(', ')}]`,
  );
  if (Object.keys(result.reasoning).length > 0) {
    console.log(`[Evaluator] Reasoning for user ${userId}:`);
    for (const [jobId, reason] of Object.entries(result.reasoning)) {
      const job = jobs.find(j => j.id === jobId);
      const desc = job ? `"${job.description}"` : jobId;
      console.log(`[Evaluator]   ${desc}: ${reason}`);
    }
  }

  return result;
}

async function evaluateRecurringJobs(jobs: ScheduledJob[], userMeta: Record<string, UserMeta> = {}): Promise<EvaluatorResult> {
  if (jobs.length === 0) return { run: [], hold: [], reasoning: {} };

  // Group by userId so token usage can be recorded per user
  const jobsByUser = new Map<string, ScheduledJob[]>();
  for (const job of jobs) {
    if (userMeta[job.userId]?.overSpendLimit) {
      console.log(`[Evaluator] Skipping job ${job.id} for user ${job.userId} — spend limit reached`);
      continue;
    }
    const list = jobsByUser.get(job.userId) ?? [];
    list.push(job);
    jobsByUser.set(job.userId, list);
  }

  const run: string[] = [];
  const hold: Array<{ id: string; until: string }> = [];
  const reasoning: Record<string, string> = {};

  for (const [userId, userJobs] of jobsByUser) {
    const result = await evaluateRecurringJobsForUser(userId, userJobs, userMeta[userId]?.byokConfig);
    run.push(...result.run);
    hold.push(...result.hold);
    Object.assign(reasoning, result.reasoning);
  }

  return { run, hold, reasoning };
}

// ---------------------------------------------------------------------------
// Lambda handler
// ---------------------------------------------------------------------------

export const handler = async (): Promise<void> => {
  console.log('[SchedulerLambda] Invoked');

  // 1. Fetch jobs that are ready to be considered
  const { onceJobs, recurringJobs, userMeta = {} } = await fetchPendingJobs();
  console.log(
    `[SchedulerLambda] ${onceJobs.length} once-job(s), ${recurringJobs.length} recurring job(s)`,
  );

  if (onceJobs.length === 0 && recurringJobs.length === 0) {
    console.log('[SchedulerLambda] Nothing to do');
    return;
  }

  // 1b. Re-resolve overSpendLimit using creditBalanceUsd from DynamoDB (authoritative source)
  const allUserIds = [...new Set([...onceJobs, ...recurringJobs].map(j => j.userId))];
  await Promise.all(allUserIds.map(async (userId) => {
    const meta = userMeta[userId];
    if (!meta) return;
    const creditBalance = await fetchUserCreditBalance(userId);
    if (creditBalance === undefined) return;
    const wasOver = meta.overSpendLimit;
    meta.overSpendLimit = creditBalance < 0.001;
    if (wasOver !== meta.overSpendLimit) {
      console.log(
        `[SpendLimit] user=${userId} re-evaluated from DynamoDB: creditBalance=$${creditBalance.toFixed(4)}, overLimit=${meta.overSpendLimit}`,
      );
    }
  }));

  const run: string[] = [];
  const hold: Array<{ id: string; until: string }> = [];

  // 2. Once-jobs: due time already checked by the backend — run them all (skip over-limit users)
  for (const job of onceJobs) {
    if (userMeta[job.userId]?.overSpendLimit) {
      console.log(`[SchedulerLambda] Skipping once-job ${job.id} for user ${job.userId} — spend limit reached`);
      continue;
    }
    run.push(job.id);
  }

  // 3. Recurring jobs: ask the LLM (one call per user for per-user token accounting)
  if (recurringJobs.length > 0) {
    const result = await evaluateRecurringJobs(recurringJobs, userMeta);
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
