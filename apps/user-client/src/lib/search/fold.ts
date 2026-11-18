// SPDX-License-Identifier: AGPL-3.0-only

const MARKS_RX = /\p{M}/gu;
const FINAL_SIGMA_RX = /ς/g;

/**
 * Fold a string for case- and accent-insensitive matching: NFD, combining
 * marks dropped, lower-cased.
 */
export function fold(s: string): string {
  // Whole-string toLowerCase is context-sensitive for Σ (word-final ς); folding
  // ς to σ keeps this path identical to the per-code-point one in foldWithMap.
  return s.normalize('NFD').replace(MARKS_RX, '').toLowerCase().replace(FINAL_SIGMA_RX, 'σ');
}

/**
 * Fold a string as `fold` does and keep, for every folded UTF-16 unit, the
 * index in `s` of the code point it came from. `map` carries one extra
 * sentinel entry equal to `s.length`, so an exclusive folded end maps too.
 */
export function foldWithMap(s: string): { folded: string; map: number[] } {
  let folded = '';
  const map: number[] = [];
  let i = 0;
  while (i < s.length) {
    const cp = s.codePointAt(i) ?? 0;
    const ch = String.fromCodePoint(cp);
    const f = fold(ch);
    for (let k = 0; k < f.length; k++) map.push(i);
    folded += f;
    i += ch.length;
  }
  map.push(s.length);
  return { folded, map };
}

/** Split a query into its distinct folded words. */
export function queryWords(q: string): string[] {
  const words = fold(q)
    .split(/\s+/)
    .filter((w) => w !== '');
  return [...new Set(words)];
}
