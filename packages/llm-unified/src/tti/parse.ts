// SPDX-License-Identifier: LGPL-3.0-only
import type { TtiGroupId } from './config.js';

/** One pre-fetch item from a generations response. */
export type RawImageItem =
  | { kind: 'b64'; b64: string; mime: string | null }
  | { kind: 'url'; url: string }
  | { kind: 'moderated'; reason: string | null };

interface ResponseEntry {
  b64_json?: unknown;
  url?: unknown;
  mime_type?: unknown;
  respect_moderation?: unknown;
  reason?: unknown;
}

/**
 * Parse a `/images/generations` JSON payload into raw items. xAI marks
 * moderated entries per-item (`respect_moderation: false` + `reason`);
 * nano-gpt has no per-item moderation (a refused prompt fails the whole POST
 * with 4xx upstream of this function). Unknown entry shapes are dropped.
 */
export function parseImagesResponse(groupId: TtiGroupId, payload: unknown): RawImageItem[] {
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  const items: RawImageItem[] = [];
  for (const raw of data as ResponseEntry[]) {
    if (groupId === 'xai-imagine' && raw.respect_moderation === false) {
      items.push({ kind: 'moderated', reason: typeof raw.reason === 'string' ? raw.reason : null });
      continue;
    }
    if (typeof raw.b64_json === 'string') {
      items.push({
        kind: 'b64',
        b64: raw.b64_json,
        mime: typeof raw.mime_type === 'string' ? raw.mime_type : null,
      });
      continue;
    }
    if (typeof raw.url === 'string') items.push({ kind: 'url', url: raw.url });
  }
  return items;
}
