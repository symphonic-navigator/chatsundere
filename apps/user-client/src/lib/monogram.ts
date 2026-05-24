// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Generate a two-letter monogram for a name, preferring a kollision-free
 * pair from a known-occupied set. Port of
 * chatsune/backend/modules/persona/_monogram.py.
 *
 * Strategy:
 *  1. Multi-part name → first + last initial. Use if free.
 *  2. Single name → iterate every i<j letter pair (uppercase) until one is free.
 *  3. Single name → doubled first letter if every pair is taken.
 *  4. No usable letters → iterate AA … ZZ until one is free.
 *  5. Total saturation → return '??'.
 */
export function generateMonogram(name: string, existing: Set<string>): string {
  const letters = name.replace(/[^a-zA-Z]/g, '');
  const parts = name.split(/\s+/).filter((p) => p.length > 0);

  if (parts.length >= 2) {
    const firstInitial = firstLetter(parts[0]);
    const lastInitial = firstLetter(parts[parts.length - 1] ?? '');
    if (firstInitial && lastInitial) {
      const candidate = (firstInitial + lastInitial).toUpperCase();
      if (!existing.has(candidate)) return candidate;
    }
  }

  if (letters.length > 0) {
    const upper = letters.toUpperCase();
    for (let i = 0; i < upper.length; i++) {
      for (let j = i + 1; j < upper.length; j++) {
        const candidate = (upper[i] ?? '') + (upper[j] ?? '');
        if (candidate.length === 2 && !existing.has(candidate)) return candidate;
      }
    }
    const doubled = (upper[0] ?? '') + (upper[0] ?? '');
    if (doubled.length === 2 && !existing.has(doubled)) return doubled;
  }

  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const candidate = String.fromCharCode(a) + String.fromCharCode(b);
      if (!existing.has(candidate)) return candidate;
    }
  }

  return '??';
}

function firstLetter(part: string | undefined): string | null {
  if (!part) return null;
  for (const ch of part) {
    if (/[a-zA-Z]/.test(ch)) return ch;
  }
  return null;
}

/**
 * Convenience wrapper for callers that don't track kollisions (e.g. preview
 * fields, throwaway renders). Always returns *some* two-letter result.
 */
export function monogramFor(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return '??';
  const result = generateMonogram(trimmed, new Set());
  // If the result is a single character (e.g. single-letter name), pad to two.
  if (result.length === 1) return result + result;
  return result;
}
