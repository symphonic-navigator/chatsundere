// SPDX-License-Identifier: AGPL-3.0-only

import { isRecord } from './types.js';

/** ChatGPT exports stamp unix seconds (float) — convert to epoch ms, or null. */
export function chatGptSecondsToMs(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1000) : null;
}

/**
 * Grok timestamps appear as epoch ms, ISO-8601 strings, numeric strings, or
 * MongoDB `$date` notation (spec §6). Returns epoch ms, or null.
 */
export function parseGrokTimestamp(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  if (typeof v === 'string') {
    const iso = Date.parse(v);
    if (Number.isFinite(iso)) return iso;
    const n = Number(v);
    return v.trim() !== '' && Number.isFinite(n) ? Math.round(n) : null;
  }
  if (isRecord(v) && '$date' in v) {
    const inner = v.$date;
    if (typeof inner === 'string') return parseGrokTimestamp(inner);
    if (isRecord(inner) && '$numberLong' in inner) {
      const raw = inner.$numberLong;
      if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
      if (typeof raw === 'string') {
        const n = Number(raw);
        return Number.isFinite(n) ? Math.round(n) : null;
      }
    }
  }
  return null;
}
