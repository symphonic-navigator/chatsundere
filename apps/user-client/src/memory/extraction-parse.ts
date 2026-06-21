// SPDX-License-Identifier: AGPL-3.0-only
import type { MemoryCategory } from '../boot/client-data-db.js';

/** One extracted fact, normalised from tolerant LLM JSON. */
export interface ExtractedEntry {
  content: string;
  category: MemoryCategory | null;
  isCorrection: boolean;
}

const FENCE_RE = /```(?:json)?\s*\n?([\s\S]*?)```/;
const TRAILING_COMMA_RE = /,(\s*[}\]])/g;
const OBJECT_RE = /\{[^{}]*\}/g;
const CATEGORIES: readonly string[] = ['preference', 'fact', 'correction', 'goal', 'context'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function normalise(entry: Record<string, unknown>): ExtractedEntry {
  const rawCat = entry.category;
  const category =
    typeof rawCat === 'string' && CATEGORIES.includes(rawCat) ? (rawCat as MemoryCategory) : null;
  const correction = entry.is_correction ?? entry.isCorrection ?? false;
  return {
    content: String(entry.content ?? '').trim(),
    category,
    isCorrection: Boolean(correction),
  };
}

/**
 * Parse tolerant LLM extraction output into normalised entries. Handles
 * markdown fences, trailing commas, and broken arrays (object-scan fallback).
 * Returns [] on unparseable input; drops blank-content entries.
 */
export function parseExtractionOutput(raw: string | null | undefined): ExtractedEntry[] {
  if (!raw || !raw.trim()) return [];
  let text = raw.trim();

  const fence = FENCE_RE.exec(text);
  if (fence?.[1]) text = fence[1].trim();

  const cleaned = text.replace(TRAILING_COMMA_RE, '$1');
  const collected: ExtractedEntry[] = [];
  try {
    const parsed: unknown = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      for (const e of parsed) if (isRecord(e) && 'content' in e) collected.push(normalise(e));
      return collected.filter((e) => e.content !== '');
    }
    if (isRecord(parsed) && 'content' in parsed) {
      const e = normalise(parsed);
      return e.content !== '' ? [e] : [];
    }
  } catch {
    // fall through to object-scan
  }

  for (const m of text.matchAll(OBJECT_RE)) {
    const fragment = m[0].replace(TRAILING_COMMA_RE, '$1');
    try {
      const obj: unknown = JSON.parse(fragment);
      if (isRecord(obj) && 'content' in obj) collected.push(normalise(obj));
    } catch {
      // skip malformed fragment
    }
  }
  return collected.filter((e) => e.content !== '');
}
