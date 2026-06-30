// SPDX-License-Identifier: AGPL-3.0-only
import { uuidv7 } from 'uuidv7';
import type { MessageRow, SeedTemplateRow } from '../boot/client-data-db.js';

/**
 * Turn a template into the ordered `kind:'seed'` MessageRows that prime a chat.
 * A non-empty greeting becomes a leading `seedRole:'greeting'` persona message
 * (wire-excluded, echoed to the system prompt); each body turn becomes a
 * `seedRole:'body'` message that goes on the wire. `createdAt` is strictly
 * ascending so the rows order stably; ids are freshly minted.
 */
export function materialiseSeed(t: SeedTemplateRow, chatId: string): MessageRow[] {
  const base = Date.now();
  const rows: MessageRow[] = [];
  let i = 0;

  const greeting = (t.greeting ?? '').trim();
  if (greeting.length > 0) {
    rows.push({
      id: uuidv7(),
      chatId,
      role: 'persona',
      contentBlocks: [{ type: 'text', text: t.greeting ?? '' }],
      createdAt: base + i,
      bookmarked: false,
      kind: 'seed',
      seedRole: 'greeting',
      streamingState: 'complete',
    });
    i++;
  }

  for (const turn of t.body) {
    rows.push({
      id: uuidv7(),
      chatId,
      role: turn.role,
      contentBlocks: [{ type: 'text', text: turn.text }],
      createdAt: base + i,
      bookmarked: false,
      kind: 'seed',
      seedRole: 'body',
      streamingState: 'complete',
    });
    i++;
  }

  return rows;
}
