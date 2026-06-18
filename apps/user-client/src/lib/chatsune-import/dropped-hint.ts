// SPDX-License-Identifier: AGPL-3.0-only

import type { ChatsuneMessage } from './types.js';

export interface DroppedCounts {
  images: number;
  toolCalls: number;
  attachments: number;
  artefacts: number;
  knowledgeLookups: number;
}

function len(arr: unknown[] | null | undefined): number {
  return Array.isArray(arr) ? arr.length : 0;
}

/** Count the Tier-A-dropped content on a chatsune message. */
export function countDropped(m: ChatsuneMessage): DroppedCounts {
  return {
    images: len(m.image_refs),
    toolCalls: len(m.tool_calls),
    attachments: len(m.attachments),
    artefacts: len(m.artefact_refs),
    knowledgeLookups: len(m.knowledge_context),
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
