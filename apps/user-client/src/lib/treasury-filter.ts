// SPDX-License-Identifier: AGPL-3.0-only
import type { ArtefactRow } from '../boot/client-data-db.js';

/** The Treasury "type" axis — derived from `format`, never stored. */
export type TreasuryType = 'all' | 'app' | 'doc' | 'code' | 'image';

/** Derive the Treasury type bucket from an artefact's storage format. */
export function formatToType(format: ArtefactRow['format']): Exclude<TreasuryType, 'all'> {
  switch (format) {
    case 'html':
      return 'app';
    case 'markdown':
      return 'doc';
    case 'code':
      return 'code';
    default:
      // svg | mermaid | image — all render as visuals.
      return 'image';
  }
}

/** Normalise a single phrase: trim + lowercase + collapse all whitespace runs
 *  (incl. newlines) to one space. The whitespace-collapse is what `normaliseTags`
 *  lacks — a user typing "roter  drache" must match "roter drache". */
export function normalisePhraseText(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Normalise a phrase list via `normalisePhraseText`: drop empties, dedupe
 *  (order-preserving). Used by the lore editor and the matcher. */
export function normalisePhrases(phrases: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of phrases) {
    const p = normalisePhraseText(raw);
    if (p !== '' && !seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

/** Normalise a tag list: trim + lowercase, drop empties, dedupe (order-preserving). */
export function normaliseTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw.trim().toLowerCase();
    if (t !== '' && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/**
 * Byte size of an artefact: UTF-8 byte length of text content.
 * Note: ArtefactRow is text-only today; `blob` lives on AttachmentRow, not here.
 */
export function artefactSize(row: ArtefactRow): number {
  return new TextEncoder().encode(row.content ?? '').length;
}

/** Human-readable byte size, e.g. "0 B", "1 KB", "14 KB", "2 MB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`;
}

/** Sorted, unique union of all tags across the given rows — the autocomplete source. */
export function collectTags(rows: ArtefactRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) for (const t of r.tags) set.add(t);
  return [...set].sort();
}

export interface TreasuryFilters {
  type: TreasuryType;
  personaId: string | null;
  tags: string[];
  favourite: boolean;
  query: string;
}

/** Apply all Treasury filter axes (AND), newest-first with an id tiebreaker. */
export function applyTreasuryFilters(rows: ArtefactRow[], f: TreasuryFilters): ArtefactRow[] {
  const q = f.query.trim().toLowerCase();
  return rows
    .filter((r) => f.type === 'all' || formatToType(r.format) === f.type)
    .filter((r) => f.personaId === null || r.personaId === f.personaId)
    .filter((r) => !f.favourite || r.favourite)
    .filter((r) => f.tags.every((t) => r.tags.includes(t)))
    .filter(
      (r) => q === '' || r.title.toLowerCase().includes(q) || r.fileName.toLowerCase().includes(q),
    )
    .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}
