// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { MessageRow } from '../../src/boot/client-data-db.js';
import {
  canReplaceInPlace,
  lastRealUserMessage,
  messageText,
} from '../../src/data/message-edit.js';

function u(id: string, createdAt: number, extra: Partial<MessageRow> = {}): MessageRow {
  return {
    id,
    chatId: 'c1',
    role: 'user',
    contentBlocks: [{ type: 'text', text: id }],
    createdAt,
    updatedAt: createdAt,
    bookmarked: false,
    streamingState: 'complete',
    ...extra,
  };
}
function persona(id: string, createdAt: number): MessageRow {
  return { ...u(id, createdAt), role: 'persona' };
}

describe('message-edit helpers', () => {
  it('lastRealUserMessage ignores persona and seed rows', () => {
    const msgs = [u('u1', 1), persona('p1', 2), u('u2', 3), u('seed', 4, { seedRole: 'body' })];
    expect(lastRealUserMessage(msgs)?.id).toBe('u2');
  });

  it('canReplaceInPlace is true only for the last user message', () => {
    const msgs = [u('u1', 1), persona('p1', 2), u('u2', 3), persona('p2', 4)];
    expect(canReplaceInPlace(msgs, 'u2')).toBe(true);
    expect(canReplaceInPlace(msgs, 'u1')).toBe(false);
  });

  it('canReplaceInPlace is false once a newer user message exists (cross-device continuation)', () => {
    const msgs = [u('u1', 1), persona('p1', 2), u('u2', 3)];
    expect(canReplaceInPlace(msgs, 'u1')).toBe(false);
  });

  it('messageText concatenates only text blocks', () => {
    const m = u('u1', 1, {
      contentBlocks: [
        { type: 'text', text: 'hello ' },
        { type: 'pill', pillId: 'x' },
        { type: 'text', text: 'world' },
      ],
    });
    expect(messageText(m)).toBe('hello world');
  });
});
