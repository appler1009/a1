import { describe, it, expect } from 'vitest';
import { estimateCostUsd } from '../ai/cost.js';
import type { TokenUsageRecord } from '../storage/main-db-interface.js';

function makeRecord(overrides: Partial<TokenUsageRecord> = {}): TokenUsageRecord {
  return {
    id: 'test-id',
    userId: 'user-1',
    model: 'claude-sonnet-4-6',
    provider: 'anthropic',
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    cacheCreationTokens: 0,
    source: 'chat',
    createdAt: new Date(),
    ...overrides,
  };
}

describe('estimateCostUsd', () => {
  it('returns 0 for empty records', () => {
    expect(estimateCostUsd([])).toBe(0);
  });

  it('returns 0 for zero-token record', () => {
    expect(estimateCostUsd([makeRecord()])).toBe(0);
  });

  it('calculates cost for known model (claude-sonnet-4-6)', () => {
    // $3/M input, $15/M output
    const cost = estimateCostUsd([makeRecord({
      model: 'claude-sonnet-4-6',
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
    })]);
    expect(cost).toBeCloseTo(18, 5); // $3 + $15
  });

  it('calculates cost for known model (gpt-4o-mini)', () => {
    // $0.15/M input, $0.60/M output
    const cost = estimateCostUsd([makeRecord({
      model: 'gpt-4o-mini',
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
    })]);
    expect(cost).toBeCloseTo(0.75, 5); // $0.15 + $0.60
  });

  it('applies 10% rate for cached input tokens', () => {
    // claude-sonnet-4-6: $3/M input. 1M cached = $0.30
    const cost = estimateCostUsd([makeRecord({
      model: 'claude-sonnet-4-6',
      promptTokens: 1_000_000,
      completionTokens: 0,
      cachedInputTokens: 1_000_000,
    })]);
    expect(cost).toBeCloseTo(0.30, 5);
  });

  it('applies 125% rate for cache creation tokens', () => {
    // claude-sonnet-4-6: $3/M input. 1M cache creation = $3.75
    const cost = estimateCostUsd([makeRecord({
      model: 'claude-sonnet-4-6',
      promptTokens: 1_000_000,
      completionTokens: 0,
      cacheCreationTokens: 1_000_000,
    })]);
    expect(cost).toBeCloseTo(3.75, 5);
  });

  it('uses prefix matching for versioned model names', () => {
    // 'claude-sonnet-4-6-20250601' should match 'claude-sonnet-4-6'
    const cost = estimateCostUsd([makeRecord({
      model: 'claude-sonnet-4-6-20250601',
      promptTokens: 1_000_000,
      completionTokens: 0,
    })]);
    expect(cost).toBeCloseTo(3, 5);
  });

  it('falls back to default pricing for unknown model', () => {
    // Default: $5/M input, $15/M output
    const cost = estimateCostUsd([makeRecord({
      model: 'totally-unknown-model-v9',
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
    })]);
    expect(cost).toBeCloseTo(20, 5); // $5 + $15
  });

  it('sums cost across multiple records', () => {
    const records = [
      makeRecord({ model: 'claude-sonnet-4-6', promptTokens: 1_000_000, completionTokens: 0 }),
      makeRecord({ model: 'gpt-4o-mini', promptTokens: 1_000_000, completionTokens: 0 }),
    ];
    const cost = estimateCostUsd(records);
    expect(cost).toBeCloseTo(3.15, 5); // $3 + $0.15
  });

  it('does not go negative when cached tokens exceed prompt tokens (clamped to 0)', () => {
    const cost = estimateCostUsd([makeRecord({
      model: 'claude-sonnet-4-6',
      promptTokens: 100,
      completionTokens: 0,
      cachedInputTokens: 200, // more than promptTokens — regularInput clamped to 0
    })]);
    expect(cost).toBeGreaterThanOrEqual(0);
  });
});
