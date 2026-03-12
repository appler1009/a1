import type { TokenUsageRecord } from '../storage/main-db-interface.js';

export const DEFAULT_MONTHLY_SPEND_LIMIT_USD = Number(process.env.DEFAULT_MONTHLY_SPEND_LIMIT_USD ?? 1.0);

interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

// Prices in USD per 1 million tokens
const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic Claude 4
  'claude-opus-4-6': { inputPerMillion: 15, outputPerMillion: 75 },
  'claude-opus-4': { inputPerMillion: 15, outputPerMillion: 75 },
  'claude-sonnet-4-6': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-sonnet-4': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-haiku-4-5': { inputPerMillion: 0.8, outputPerMillion: 4 },
  'claude-haiku-4': { inputPerMillion: 0.8, outputPerMillion: 4 },
  // Anthropic Claude 3.x
  'claude-3-5-sonnet': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-3-7-sonnet': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-3-5-haiku': { inputPerMillion: 0.8, outputPerMillion: 4 },
  'claude-3-opus': { inputPerMillion: 15, outputPerMillion: 75 },
  'claude-3-haiku': { inputPerMillion: 0.25, outputPerMillion: 1.25 },
  // OpenAI
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10 },
  'gpt-4-turbo': { inputPerMillion: 10, outputPerMillion: 30 },
  'gpt-4': { inputPerMillion: 30, outputPerMillion: 60 },
  'gpt-3.5-turbo': { inputPerMillion: 0.5, outputPerMillion: 1.5 },
  // xAI Grok
  'grok-4': { inputPerMillion: 5, outputPerMillion: 25 },
  'grok-2': { inputPerMillion: 2, outputPerMillion: 10 },
  'grok-beta': { inputPerMillion: 5, outputPerMillion: 15 },
};

const DEFAULT_PRICING: ModelPricing = { inputPerMillion: 5, outputPerMillion: 15 };

function getPricing(model: string): ModelPricing {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  // Prefix match — e.g. 'claude-sonnet-4-6-20250101' matches 'claude-sonnet-4-6'
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key)) return pricing;
  }
  return DEFAULT_PRICING;
}

/**
 * Estimates total cost in USD from a list of token usage records.
 * Cached input tokens are billed at 10% of the regular input price.
 * Cache creation tokens are billed at 125% of the regular input price.
 */
export function estimateCostUsd(records: TokenUsageRecord[]): number {
  let total = 0;
  for (const record of records) {
    const pricing = getPricing(record.model);
    const cached = record.cachedInputTokens ?? 0;
    const cacheCreation = record.cacheCreationTokens ?? 0;
    const regularInput = record.promptTokens - cached - cacheCreation;

    total += (Math.max(0, regularInput) / 1_000_000) * pricing.inputPerMillion;
    total += (cached / 1_000_000) * pricing.inputPerMillion * 0.1;
    total += (cacheCreation / 1_000_000) * pricing.inputPerMillion * 1.25;
    total += (record.completionTokens / 1_000_000) * pricing.outputPerMillion;
  }
  return total;
}
