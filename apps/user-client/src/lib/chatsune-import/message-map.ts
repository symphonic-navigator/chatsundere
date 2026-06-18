// SPDX-License-Identifier: AGPL-3.0-only

import type { ContentBlock } from '../../boot/client-data-db.js';
import { buildDroppedHint, countDropped } from './dropped-hint.js';
import type { ChatsuneMessage } from './types.js';

export interface MappedMessage {
  role: 'user' | 'persona';
  contentBlocks: ContentBlock[];
  createdAt: number;
}

/**
 * Map a chatsune message to a Chatsundere message (Tier A): user/persona text +
 * CoT reasoning + a per-message hint for dropped content. Returns null for
 * tool-role messages, which have no Chatsundere equivalent and are skipped.
 */
export function mapChatsuneMessage(
  m: ChatsuneMessage,
  fallbackCreatedAt: number,
): MappedMessage | null {
  if (m.role === 'tool') return null;

  const blocks: ContentBlock[] = [];
  const primary = m.content?.trim()
    ? m.content
    : m.status === 'refused' && m.refusal_text
      ? m.refusal_text
      : '';
  if (primary) blocks.push({ type: 'text', text: primary });
  if (m.thinking?.trim()) blocks.push({ type: 'reasoning', text: m.thinking });

  const hint = buildDroppedHint(countDropped(m));
  if (hint) blocks.push({ type: 'text', text: hint });

  if (blocks.length === 0) return null;

  const parsed = m.created_at ? Date.parse(m.created_at) : Number.NaN;
  const createdAt = Number.isFinite(parsed) ? parsed : fallbackCreatedAt;

  return { role: m.role === 'assistant' ? 'persona' : 'user', contentBlocks: blocks, createdAt };
}
