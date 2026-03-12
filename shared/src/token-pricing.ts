/**
 * Single source of truth for token pricing and cost calculation.
 * Used by both the server (spend limit enforcement) and client (usage display).
 *
 * Anthropic token semantics:
 *   promptTokens      = non-cached input only (cached already excluded)
 *   cachedInputTokens = cache reads (cheap)
 *   cacheCreationTokens = cache writes (more expensive)
 *
 * Grok/OpenAI token semantics:
 *   promptTokens      = total input INCLUDING cached tokens
 *   cachedInputTokens = cached portion of prompt
 *   cacheCreationTokens = not applicable (always 0)
 */

export interface ModelPricing {
  input: number;        // $ per token
  cachedInput: number;  // $ per token
  cacheCreation: number;// $ per token
  output: number;       // $ per token
  isAnthropic: boolean;
}

export interface TokenCounts {
  promptTokens: number;
  completionTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
}

const PRICING_TABLE: Record<string, Omit<ModelPricing, 'isAnthropic'>> = {
  'grok-4-1-fast-non-reasoning': {
    input: 0.20 / 1e6,
    cachedInput: 0.05 / 1e6,
    cacheCreation: 0,
    output: 0.50 / 1e6,
  },
  'claude-haiku-4-5': {
    input: 1.00 / 1e6,
    cachedInput: 0.10 / 1e6,
    cacheCreation: 1.25 / 1e6,
    output: 5.00 / 1e6,
  },
};

export function getPricing(model: string): ModelPricing | null {
  if (PRICING_TABLE[model]) {
    return { ...PRICING_TABLE[model], isAnthropic: model.startsWith('claude-') };
  }
  const key = Object.keys(PRICING_TABLE).find(k => model.startsWith(k));
  if (key) {
    return { ...PRICING_TABLE[key], isAnthropic: model.startsWith('claude-') };
  }
  return null;
}

export function calculateCost(model: string, tokens: TokenCounts): number | null {
  const pricing = getPricing(model);
  if (!pricing) return null;

  if (pricing.isAnthropic) {
    return (
      tokens.promptTokens * pricing.input +
      tokens.cachedInputTokens * pricing.cachedInput +
      tokens.cacheCreationTokens * pricing.cacheCreation +
      tokens.completionTokens * pricing.output
    );
  } else {
    const nonCached = Math.max(0, tokens.promptTokens - tokens.cachedInputTokens);
    return (
      nonCached * pricing.input +
      tokens.cachedInputTokens * pricing.cachedInput +
      tokens.completionTokens * pricing.output
    );
  }
}
