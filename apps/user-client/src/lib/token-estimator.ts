// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Estimate tokens via the 4-chars-per-token heuristic. Cheap, fast, and
 * good enough for the Context-Gauge until a per-model tokeniser arrives.
 */
export function estimateTokens(input: string | string[]): number {
  if (Array.isArray(input)) return input.reduce((s, p) => s + estimateTokens(p), 0);
  return Math.ceil(input.length / 4);
}

/**
 * Percentage of the model's context window used, capped at 100, zero when
 * capacity is zero or negative.
 */
export function contextUtilisation(used: number, capacity: number): number {
  if (capacity <= 0) return 0;
  return Math.min(100, Math.floor((used / capacity) * 100));
}
