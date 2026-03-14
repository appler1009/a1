import { calculateCost } from '@local-agent/shared';
import type { TokenUsageRecord } from '../storage/main-db-interface.js';

export { getPricing, calculateCost } from '@local-agent/shared';
export type { ModelPricing, TokenCounts } from '@local-agent/shared';

export const DEFAULT_MONTHLY_SPEND_LIMIT_USD = Number(process.env.DEFAULT_MONTHLY_SPEND_LIMIT_USD ?? 1.0);
export const PRICING_MARGIN = Number(process.env.PRICING_MARGIN ?? 1.1);

/**
 * Estimates total cost in USD from a list of token usage records.
 * Applies PRICING_MARGIN multiplier. Skips records with unknown models (no pricing available).
 */
export function estimateCostUsd(records: TokenUsageRecord[]): number {
  let total = 0;
  for (const record of records) {
    const cost = calculateCost(record.model, record);
    if (cost !== null) total += cost;
  }
  return total * PRICING_MARGIN;
}
