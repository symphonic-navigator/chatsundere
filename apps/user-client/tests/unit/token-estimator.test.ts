import { describe, expect, it } from 'vitest';
import { contextUtilisation, estimateTokens } from '../../src/lib/token-estimator';

describe('estimateTokens', () => {
  it('returns 0 for empty', () => expect(estimateTokens('')).toBe(0));
  it('4 chars per token, ceiled', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
  it('multi-string sums', () => {
    expect(estimateTokens(['abcd', 'efgh'])).toBe(2);
  });
});

describe('contextUtilisation', () => {
  it('returns the percentage rounded down', () => {
    expect(contextUtilisation(50, 100)).toBe(50);
    expect(contextUtilisation(199, 200)).toBe(99);
  });
  it('caps at 100', () => {
    expect(contextUtilisation(500, 100)).toBe(100);
  });
  it('zero capacity → 0', () => {
    expect(contextUtilisation(50, 0)).toBe(0);
  });
});
