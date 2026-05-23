// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Derive a two-character monogram from a persona / user name.
 * - Two-word names: first letter of each of the first two words, both upper-cased.
 * - Single word: first two characters, both upper-cased.
 * - Single character: just that character, upper-cased.
 * - Empty or whitespace-only input: '??'.
 */
export function monogramFor(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return '??';
  const words = trimmed.split(/\s+/);
  if (words.length >= 2) {
    return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase();
  }
  const w = words[0] ?? '';
  if (w.length === 1) return w.toUpperCase();
  return w.slice(0, 2).toUpperCase();
}
