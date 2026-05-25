// SPDX-License-Identifier: AGPL-3.0-only
import type { ContentBlock } from '../boot/client-data-db.js';

export interface BlockGroup {
  type: ContentBlock['type'];
  blocks: ContentBlock[];
}

/**
 * Reduce a ContentBlock array to the plaintext answer the user actually
 * wrote / saw. Reasoning is filtered, pills carry no plaintext, and text
 * blocks are joined verbatim. Single source of truth for copy, replay,
 * and token estimation.
 */
export function flattenAnswerText(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/**
 * Merge consecutive blocks of the same kind into one. Pill blocks are
 * never merged — they carry a `pillId` identity that must be preserved.
 */
export function coalesceAdjacent(blocks: ContentBlock[]): ContentBlock[] {
  const out: ContentBlock[] = [];
  for (const b of blocks) {
    const last = out[out.length - 1];
    if (!last || last.type !== b.type || b.type === 'pill') {
      out.push(b);
      continue;
    }
    if (b.type === 'text' && last.type === 'text') {
      out[out.length - 1] = { type: 'text', text: last.text + b.text };
    } else if (b.type === 'reasoning' && last.type === 'reasoning') {
      out[out.length - 1] = { type: 'reasoning', text: last.text + b.text };
    } else {
      out.push(b);
    }
  }
  return out;
}

/**
 * Walk the block array once and partition into ordered runs of same-type
 * blocks. The renderer dispatches one component per group: a
 * `<span class="msg-text">` for `'text'`, a `<ReasoningPill>` for
 * `'reasoning'`, a `<Pill>` for `'pill'`.
 */
export function groupAdjacent(blocks: ContentBlock[]): BlockGroup[] {
  const out: BlockGroup[] = [];
  for (const b of blocks) {
    const last = out[out.length - 1];
    if (last && last.type === b.type) {
      last.blocks.push(b);
    } else {
      out.push({ type: b.type, blocks: [b] });
    }
  }
  return out;
}
