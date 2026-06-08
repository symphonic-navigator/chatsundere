// SPDX-License-Identifier: AGPL-3.0-only
import { normalisePhraseText } from '../lib/treasury-filter.js';

/** A knowledge document as the lore matcher needs it. */
export interface LoreDocument {
  id: string;
  libraryId: string;
  title: string;
  content: string;
  triggerPhrases: string[];
  triggerOnCompanion: boolean;
  createdAt: number;
}

/** A library reference carrying name + (implicit) order. */
export interface LoreLibraryMeta {
  id: string;
  name: string;
}

export interface LoreOptions {
  maxEntries: number;
  maxTotalChars: number;
}

/** One injected entry (post-budget, post-truncation). */
export interface LoreEntry {
  libraryName: string;
  documentTitle: string;
  injectedText: string;
}

export interface LoreResult {
  entries: LoreEntry[];
  omittedCount: number;
  truncatedCount: number;
}

/** Device-tunable lore budget (mirrors KNOWLEDGE_RETRIEVAL_OPTS). */
export const KNOWLEDGE_LORE_OPTS: LoreOptions = { maxEntries: 8, maxTotalChars: 8000 };

/** Escape regex metacharacters in a literal phrase. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether a normalised phrase occurs in normalised text bounded by Unicode word
 * boundaries. NOT ASCII `\b` (that treats ö/ä/ü as non-word characters and
 * mis-bounds German words). Letters/digits on either side block a match, so
 * `blume` does not fire on `blumen`.
 */
export function phraseMatches(normalisedText: string, normalisedPhrase: string): boolean {
  if (normalisedPhrase === '') return false;
  const re = new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(normalisedPhrase)}(?![\\p{L}\\p{N}])`,
    'u',
  );
  return re.test(normalisedText);
}

/**
 * Select the lore to inject this turn. Each document is scanned against the
 * normalised user message; a document also sees the normalised preceding
 * companion message when its `triggerOnCompanion` is set. Matches are ordered by
 * library order then `createdAt`, then capped by the budget: whole entries until
 * the cap; the overflowing entry is truncated with an ellipsis; the rest omitted.
 */
export function selectLore(
  documents: readonly LoreDocument[],
  libraries: readonly LoreLibraryMeta[],
  userText: string,
  precedingCompanionText: string | null,
  opts: LoreOptions,
): LoreResult {
  const order = new Map(libraries.map((l, i) => [l.id, i] as const));
  const nameOf = new Map(libraries.map((l) => [l.id, l.name] as const));
  const userNorm = normalisePhraseText(userText);
  const companionNorm = precedingCompanionText ? normalisePhraseText(precedingCompanionText) : '';

  const matched = documents
    .filter((d) => order.has(d.libraryId) && d.triggerPhrases.length > 0)
    .filter((d) => {
      // Scan the two texts independently so a phrase can never match across the
      // user/companion boundary (e.g. user ends "…roter", companion starts "drache…").
      const scanCompanion = d.triggerOnCompanion && companionNorm !== '';
      return d.triggerPhrases.some((raw) => {
        const p = normalisePhraseText(raw);
        return phraseMatches(userNorm, p) || (scanCompanion && phraseMatches(companionNorm, p));
      });
    })
    .sort(
      (a, b) =>
        (order.get(a.libraryId) ?? 0) - (order.get(b.libraryId) ?? 0) || a.createdAt - b.createdAt,
    );

  const entries: LoreEntry[] = [];
  let omittedCount = 0;
  let truncatedCount = 0;
  let totalChars = 0;

  for (const d of matched) {
    if (entries.length >= opts.maxEntries) {
      omittedCount++;
      continue;
    }
    const remaining = opts.maxTotalChars - totalChars;
    if (remaining <= 0) {
      omittedCount++;
      continue;
    }
    const libraryName = nameOf.get(d.libraryId) ?? '';
    if (d.content.length <= remaining) {
      entries.push({ libraryName, documentTitle: d.title, injectedText: d.content });
      totalChars += d.content.length;
    } else {
      entries.push({
        libraryName,
        documentTitle: d.title,
        injectedText: `${d.content.slice(0, remaining)}…`,
      });
      totalChars = opts.maxTotalChars;
      truncatedCount++;
    }
  }

  return { entries, omittedCount, truncatedCount };
}

/** Render the lore-injection segment (for Band-2), or '' when nothing fired. */
export function formatLore(entries: readonly LoreEntry[]): string {
  if (entries.length === 0) return '';
  const blocks = entries.map((e) => `[${e.libraryName} › ${e.documentTitle}]\n${e.injectedText}`);
  return ["Relevant background from the user's knowledge:", ...blocks].join('\n\n');
}
