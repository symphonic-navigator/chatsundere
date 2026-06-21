// SPDX-License-Identifier: AGPL-3.0-only
import type { ExtractedEntry } from './extraction-parse.js';

/** Lowercase, collapse whitespace, trim — the dedup comparison key. */
export function normaliseForDedup(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Drop candidates that normalise-equal an existing journal entry, are already
 * contained in the body prose, are blank, or duplicate an earlier candidate.
 * String-level only (no semantics) — the secondary net behind the cursor.
 */
export function dropDuplicates(
  candidates: ExtractedEntry[],
  existingEntryTexts: string[],
  existingBody: string,
): ExtractedEntry[] {
  const seen = new Set(existingEntryTexts.map(normaliseForDedup));
  const bodyNorm = normaliseForDedup(existingBody);
  const out: ExtractedEntry[] = [];
  for (const c of candidates) {
    const n = normaliseForDedup(c.content);
    if (!n) continue;
    if (seen.has(n)) continue;
    if (bodyNorm?.includes(n)) continue;
    seen.add(n);
    out.push(c);
  }
  return out;
}
