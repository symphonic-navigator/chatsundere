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
 * nothing has been used or capacity is non-positive. Reports `1` as the
 * smallest non-zero value — modern context windows (200k+) would otherwise
 * floor every real conversation to 0 until you hit several thousand tokens,
 * which gives the user no signal that the gauge is alive.
 */
export function contextUtilisation(used: number, capacity: number): number {
  if (capacity <= 0 || used <= 0) return 0;
  const exact = (used / capacity) * 100;
  return exact < 1 ? 1 : Math.min(100, Math.floor(exact));
}
