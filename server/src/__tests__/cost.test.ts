import { describe, it, expect } from 'vitest';
import { estimateCostUsd } from '../ai/cost.js';
import type { TokenUsageRecord } from '../storage/main-db-interface.js';

function makeRecord(overrides: Partial<TokenUsageRecord> = {}): TokenUsageRecord {
  return {
    id: 'test-id',
    userId: 'user-1',
    model: 'claude-haiku-4-5',
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

  it('returns 0 for unknown model (no pricing available)', () => {
    expect(estimateCostUsd([makeRecord({ model: 'totally-unknown-model-v9', promptTokens: 1_000_000 })])).toBe(0);
  });

  describe('Anthropic (claude-haiku-4-5) — $1.00/M input, $5.00/M output', () => {
    it('calculates plain input cost', () => {
      // 1M prompt tokens at $1.00/M = $1.00
      const cost = estimateCostUsd([makeRecord({ promptTokens: 1_000_000 })]);
      expect(cost).toBeCloseTo(1.0, 6);
    });

    it('calculates plain output cost', () => {
      // 1M completion tokens at $5.00/M = $5.00
      const cost = estimateCostUsd([makeRecord({ completionTokens: 1_000_000 })]);
      expect(cost).toBeCloseTo(5.0, 6);
    });

    it('does NOT subtract cachedInputTokens from promptTokens (Anthropic semantics)', () => {
      // promptTokens is already non-cached for Anthropic
      // 1M prompt + 1M cached read — cost = $1.00 + $0.10 = $1.10
      const cost = estimateCostUsd([makeRecord({
        promptTokens: 1_000_000,
        cachedInputTokens: 1_000_000,
      })]);
      expect(cost).toBeCloseTo(1.10, 6);
    });

    it('applies cache creation cost', () => {
      // 1M cache creation tokens at $1.25/M = $1.25
      const cost = estimateCostUsd([makeRecord({ cacheCreationTokens: 1_000_000 })]);
      expect(cost).toBeCloseTo(1.25, 6);
    });

    it('calculates combined input + output + cache', () => {
      // 500k prompt ($0.50) + 500k output ($2.50) + 200k cached ($0.02) + 100k creation ($0.125) = $3.145
      const cost = estimateCostUsd([makeRecord({
        promptTokens: 500_000,
        completionTokens: 500_000,
        cachedInputTokens: 200_000,
        cacheCreationTokens: 100_000,
      })]);
      expect(cost).toBeCloseTo(3.145, 6);
    });
  });

  describe('Grok (grok-4-1-fast-non-reasoning) — $0.20/M input, $0.50/M output', () => {
    it('calculates plain output cost', () => {
      // 1M completion at $0.50/M = $0.50
      const cost = estimateCostUsd([makeRecord({
        model: 'grok-4-1-fast-non-reasoning',
        completionTokens: 1_000_000,
      })]);
      expect(cost).toBeCloseTo(0.50, 6);
    });

    it('subtracts cachedInputTokens from promptTokens (Grok semantics)', () => {
      // promptTokens=1M includes 400k cached. non-cached=600k at $0.20/M = $0.12
      // cached 400k at $0.05/M = $0.02. total = $0.14
      const cost = estimateCostUsd([makeRecord({
        model: 'grok-4-1-fast-non-reasoning',
        promptTokens: 1_000_000,
        cachedInputTokens: 400_000,
      })]);
      expect(cost).toBeCloseTo(0.14, 6);
    });
  });

  describe('prefix matching', () => {
    it('matches versioned claude model name', () => {
      // claude-haiku-4-5-20251001 should match claude-haiku-4-5
      const cost = estimateCostUsd([makeRecord({
        model: 'claude-haiku-4-5-20251001',
        promptTokens: 1_000_000,
      })]);
      expect(cost).toBeCloseTo(1.0, 6);
    });
  });

  describe('multi-record summation', () => {
    it('sums cost across multiple records', () => {
      // claude-haiku: 1M prompt = $1.00
      // grok: 1M output = $0.50
      const cost = estimateCostUsd([
        makeRecord({ model: 'claude-haiku-4-5', promptTokens: 1_000_000 }),
        makeRecord({ model: 'grok-4-1-fast-non-reasoning', completionTokens: 1_000_000 }),
      ]);
      expect(cost).toBeCloseTo(1.50, 6);
    });

    it('skips unknown models without affecting total', () => {
      const cost = estimateCostUsd([
        makeRecord({ model: 'claude-haiku-4-5', promptTokens: 1_000_000 }),
        makeRecord({ model: 'unknown-model', promptTokens: 999_000_000 }),
      ]);
      expect(cost).toBeCloseTo(1.0, 6);
    });
  });
});
