import type { LLMRouter } from '../ai/router.js';
import type { ScheduledJob } from '../storage/main-db.js';

export async function evaluateRecurringJobs(
  jobs: ScheduledJob[],
  llmRouter: LLMRouter,
): Promise<string[]> {
  if (jobs.length === 0) return [];

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

Evaluate which of these recurring scheduled jobs should run right now. The scheduler checks every 5 minutes. Consider:
- Does the job description indicate it should run at approximately this time?
- When did it last run? Avoid re-triggering a job within its expected interval (e.g. an hourly job that ran 3 minutes ago should NOT run again).

Jobs to evaluate:
${jobLines}

Reply with ONLY a valid JSON array of job IDs to trigger now. If none, reply [].
Example: ["id1","id2"]`;

  try {
    console.log(`[Evaluator] Prompt:\n${prompt}\n`);

    const response = await llmRouter.complete({
      messages: [{ role: 'user', content: prompt }],
    });

    console.log(`[Evaluator] AI response (${response.model}):`, response.content);

    const text = response.content?.trim() || '[]';
    const match = text.match(/\[.*\]/s);
    if (!match) {
      console.log('[Evaluator] No JSON array found in response, assuming no jobs to run');
      return [];
    }
    const jobIds = JSON.parse(match[0]) as string[];
    console.log(`[Evaluator] Parsed job IDs to run:`, jobIds);
    return jobIds;
  } catch (err) {
    console.error('[Evaluator] Failed to evaluate recurring jobs:', err);
    return [];
  }
}
