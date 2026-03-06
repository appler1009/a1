import { describe, it, expect } from 'vitest';
import { getPricing, calculateCost } from '../../lib/token-pricing';

describe('getPricing', () => {
  it('returns pricing for exact model name', () => {
    const p = getPricing('grok-4-1-fast-non-reasoning');
    expect(p).not.toBeNull();
    expect(p!.input).toBeCloseTo(0.20 / 1e6);
    expect(p!.cachedInput).toBeCloseTo(0.05 / 1e6);
    expect(p!.output).toBeCloseTo(0.50 / 1e6);
    expect(p!.isAnthropic).toBe(false);
  });

  it('returns pricing for claude-haiku-4-5 exact match', () => {
    const p = getPricing('claude-haiku-4-5');
    expect(p).not.toBeNull();
    expect(p!.input).toBeCloseTo(1.00 / 1e6);
    expect(p!.cachedInput).toBeCloseTo(0.10 / 1e6);
    expect(p!.cacheCreation).toBeCloseTo(1.25 / 1e6);
    expect(p!.output).toBeCloseTo(5.00 / 1e6);
    expect(p!.isAnthropic).toBe(true);
  });

  it('matches versioned claude model via prefix', () => {
    const p = getPricing('claude-haiku-4-5-20251001');
    expect(p).not.toBeNull();
    expect(p!.isAnthropic).toBe(true);
    expect(p!.output).toBeCloseTo(5.00 / 1e6);
  });

  it('returns null for unknown model', () => {
    expect(getPricing('unknown-model-xyz')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(getPricing('')).toBeNull();
  });
});

describe('calculateCost', () => {
  const grokTokens = {
    promptTokens: 1000,
    completionTokens: 500,
    cachedInputTokens: 200,
    cacheCreationTokens: 0,
  };

  const claudeTokens = {
    promptTokens: 800,
    completionTokens: 300,
    cachedInputTokens: 400,
    cacheCreationTokens: 100,
  };

  it('returns null for unknown model', () => {
    expect(calculateCost('unknown-model', grokTokens)).toBeNull();
  });

  it('calculates grok cost (non-Anthropic semantics: promptTokens includes cached)', () => {
    // nonCached = 1000 - 200 = 800
    // cost = 800 * (0.20/1e6) + 200 * (0.05/1e6) + 500 * (0.50/1e6)
    const expected = 800 * (0.20 / 1e6) + 200 * (0.05 / 1e6) + 500 * (0.50 / 1e6);
    const cost = calculateCost('grok-4-1-fast-non-reasoning', grokTokens);
    expect(cost).not.toBeNull();
    expect(cost!).toBeCloseTo(expected, 10);
  });

  it('calculates claude cost (Anthropic semantics: promptTokens is already non-cached)', () => {
    // cost = 800 * (1.00/1e6) + 400 * (0.10/1e6) + 100 * (1.25/1e6) + 300 * (5.00/1e6)
    const expected =
      800 * (1.00 / 1e6) +
      400 * (0.10 / 1e6) +
      100 * (1.25 / 1e6) +
      300 * (5.00 / 1e6);
    const cost = calculateCost('claude-haiku-4-5', claudeTokens);
    expect(cost).not.toBeNull();
    expect(cost!).toBeCloseTo(expected, 10);
  });

  it('clamps non-cached grok tokens to 0 when cachedInputTokens > promptTokens', () => {
    const tokens = { promptTokens: 100, completionTokens: 50, cachedInputTokens: 200, cacheCreationTokens: 0 };
    const cost = calculateCost('grok-4-1-fast-non-reasoning', tokens);
    // nonCached = max(0, 100 - 200) = 0
    const expected = 0 + 200 * (0.05 / 1e6) + 50 * (0.50 / 1e6);
    expect(cost!).toBeCloseTo(expected, 10);
  });

  it('works with versioned model name via prefix matching', () => {
    const cost = calculateCost('claude-haiku-4-5-20251001', claudeTokens);
    const direct = calculateCost('claude-haiku-4-5', claudeTokens);
    expect(cost).toBeCloseTo(direct!, 10);
  });

  it('returns 0 cost for all-zero token counts', () => {
    const zeros = { promptTokens: 0, completionTokens: 0, cachedInputTokens: 0, cacheCreationTokens: 0 };
    expect(calculateCost('claude-haiku-4-5', zeros)).toBe(0);
    expect(calculateCost('grok-4-1-fast-non-reasoning', zeros)).toBe(0);
  });
});
