// SPDX-License-Identifier: AGPL-3.0-only

import type { ChatsuneMessage } from './types.js';

export interface DroppedCounts {
  images: number;
  toolCalls: number;
  attachments: number;
  artefacts: number;
  knowledgeLookups: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** A stable de-dup key for a dropped item: a present id field, else its JSON
 *  shape. Lets the same item counted once when it appears in both the legacy
 *  top-level field and the new `events` timeline. */
function itemKey(item: unknown, idKeys: readonly string[]): string {
  if (isRecord(item)) {
    for (const k of idKeys) {
      const v = item[k];
      if (typeof v === 'string' && v.length > 0) return `${k}=${v}`;
    }
  }
  return JSON.stringify(item) ?? 'null';
}

/** The item objects carried by one timeline event entry: images/attachments
 *  use `refs[]`, knowledge uses `items[]`, artefact uses a single `ref{}`,
 *  and a tool_call entry is itself the item. */
function eventEntryItems(entry: Record<string, unknown>): unknown[] {
  if (Array.isArray(entry.refs)) return entry.refs;
  if (Array.isArray(entry.items)) return entry.items;
  if (isRecord(entry.ref)) return [entry.ref];
  return [entry];
}

/** Unique count of one dropped category across the legacy top-level field and
 *  the new `events` timeline, de-duplicated by id — mirrors chatsune's own
 *  reader, which unions both sources because newer docs may write either or
 *  both (`chat/__init__.py` image/tool-call collection). */
function countCategory(
  m: ChatsuneMessage,
  topLevel: unknown,
  eventKind: string,
  idKeys: readonly string[],
): number {
  const seen = new Set<string>();
  for (const item of asArray(topLevel)) seen.add(itemKey(item, idKeys));
  for (const entry of asArray(m.events)) {
    if (!isRecord(entry) || entry.kind !== eventKind) continue;
    for (const item of eventEntryItems(entry)) seen.add(itemKey(item, idKeys));
  }
  return seen.size;
}

/** Count the Tier-A-dropped content on a chatsune message (both the legacy
 *  top-level fields and the new `events` timeline). */
export function countDropped(m: ChatsuneMessage): DroppedCounts {
  return {
    images: countCategory(m, m.image_refs, 'image', ['id']),
    toolCalls: countCategory(m, m.tool_calls, 'tool_call', ['tool_call_id', 'id']),
    attachments: countCategory(m, m.attachments, 'attachment', ['file_id', 'id']),
    artefacts: countCategory(m, m.artefact_refs, 'artefact', ['artefact_id', 'id']),
    knowledgeLookups: countCategory(m, m.knowledge_context, 'knowledge_search', [
      'document_id',
      'documentId',
      'id',
    ]),
  };
}

/** British-English singular/plural noun for a dropped category. */
function noun(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * A short, recognisable per-message note for dropped content, or null when the
 * message lost nothing. Example:
 * "[2 images and 1 tool call from the original message were not imported.]"
 */
export function buildDroppedHint(counts: DroppedCounts): string | null {
  const parts: string[] = [];
  if (counts.images) parts.push(noun(counts.images, 'image', 'images'));
  if (counts.toolCalls) parts.push(noun(counts.toolCalls, 'tool call', 'tool calls'));
  if (counts.attachments) parts.push(noun(counts.attachments, 'attachment', 'attachments'));
  if (counts.artefacts) parts.push(noun(counts.artefacts, 'artefact', 'artefacts'));
  if (counts.knowledgeLookups)
    parts.push(noun(counts.knowledgeLookups, 'knowledge lookup', 'knowledge lookups'));
  if (parts.length === 0) return null;
  const total =
    counts.images +
    counts.toolCalls +
    counts.attachments +
    counts.artefacts +
    counts.knowledgeLookups;
  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  const verb = total === 1 ? 'was' : 'were';
  return `[${list} from the original message ${verb} not imported.]`;
}
