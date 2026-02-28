import type { LLMRouter } from '../ai/router.js';
import type { ScheduledJob } from '../storage/main-db.js';

export interface EvaluatorResult {
  run: string[];
  hold: Array<{ id: string; until: string }>;
}

export async function evaluateRecurringJobs(
  jobs: ScheduledJob[],
  llmRouter: LLMRouter,
): Promise<EvaluatorResult> {
  if (jobs.length === 0) return { run: [], hold: [] };

  const now = new Date();
  const timeStr = now.toLocaleString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  }) + ' UTC';

  const jobLines = jobs.map(j => {
    const lastRun = j.lastRunAt ? j.lastRunAt.toISOString() : 'never';
    return `- ID: ${j.id} | Last run: ${lastRun} | "${j.description}"`;
  }).join('\n');

  const prompt = `You are a job scheduler evaluator. Current time: ${timeStr}

Evaluate each recurring scheduled job below. For each job decide:
- RUN: the job description indicates it should execute now, and enough time has passed since last run
- HOLD: too early to run (e.g. a daily job that ran this morning), set holdUntil to when it should next be checked (ISO 8601)
- SKIP: cannot determine schedule or no action needed — omit from response

The scheduler re-checks every 5 minutes, but a HOLD skips a job entirely until its holdUntil time, saving unnecessary AI evaluation.

Jobs to evaluate:
${jobLines}

Reply with ONLY a valid JSON object like:
{
  "run": ["id-of-job-to-run"],
  "hold": [{"id": "id-of-job-to-hold", "until": "2026-02-27T09:00:00Z"}]
}
Both arrays may be empty. Do not include any other text.`;

  try {
    console.log(`[Evaluator] Prompt:\n${prompt}\n`);

    const response = await llmRouter.complete({
      messages: [{ role: 'user', content: prompt }],
    });

    console.log(`[Evaluator] AI response (${response.model}):`, response.content);

    const text = response.content?.trim() || '{}';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      console.log('[Evaluator] No JSON object found in response, skipping all jobs');
      return { run: [], hold: [] };
    }

    const parsed = JSON.parse(match[0]) as { run?: string[]; hold?: Array<{ id: string; until: string }> };
    const result: EvaluatorResult = {
      run: Array.isArray(parsed.run) ? parsed.run : [],
      hold: Array.isArray(parsed.hold) ? parsed.hold : [],
    };

    console.log(`[Evaluator] Jobs to run:`, result.run);
    console.log(`[Evaluator] Jobs to hold:`, result.hold);
    return result;
  } catch (err) {
    console.error('[Evaluator] Failed to evaluate recurring jobs:', err);
    return { run: [], hold: [] };
  }
}
