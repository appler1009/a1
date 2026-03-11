import { getMainDatabase } from '../storage/index.js';
import { createLLMRouter } from '../ai/router.js';

/**
 * Returns a per-user LLM router using the user's BYOK credentials if configured and active,
 * or null if no active BYOK config exists (caller should fall back to the global llmRouter).
 */
export async function getByokRouter(userId: string): Promise<ReturnType<typeof createLLMRouter> | null> {
  const mainDb = await getMainDatabase();
  const entries = await mainDb.listServiceCredentials(userId, 'byok');
  const active = entries.find(e => e.credentials.enabled === true);
  if (!active) return null;

  const providerMap: Record<string, 'grok' | 'openai' | 'anthropic'> = {
    xai: 'grok',
    openai: 'openai',
    anthropic: 'anthropic',
  };
  const provider = providerMap[active.accountEmail];
  if (!provider) return null;

  const apiKey = active.credentials.apiKey as string;
  const model = active.credentials.model as string;

  return createLLMRouter({
    provider,
    grokKey: provider === 'grok' ? apiKey : undefined,
    openaiKey: provider === 'openai' ? apiKey : undefined,
    anthropicKey: provider === 'anthropic' ? apiKey : undefined,
    defaultModel: model,
    onTokensUsed: (event) => {
      if (!event.userId) return;
      mainDb.recordTokenUsage({
        userId: event.userId,
        model: event.model,
        // Prefix with 'byok:' so usage can be split from app-default in reports
        provider: `byok:${active.accountEmail}`,
        promptTokens: event.promptTokens,
        completionTokens: event.completionTokens,
        totalTokens: event.totalTokens,
        cachedInputTokens: event.cachedInputTokens,
        cacheCreationTokens: event.cacheCreationTokens,
        source: event.source,
      }).catch(err => console.error('[BYOK TokenUsage] Failed:', err));
    },
  });
}
