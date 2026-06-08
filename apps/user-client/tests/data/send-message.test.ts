// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { MessageRow } from '../../src/boot/client-data-db.js';
import { lastCompanionText } from '../../src/data/send-message.js';

function msg(p: Partial<MessageRow>): MessageRow {
  return {
    id: 'm',
    chatId: 'c',
    role: 'persona',
    contentBlocks: [{ type: 'text', text: 'hi' }],
    createdAt: 1,
    bookmarked: false,
    streamingState: 'complete',
    ...p,
  };
}

describe('lastCompanionText', () => {
  it('returns the most recent complete persona message text', () => {
    const msgs = [
      msg({
        id: 'a',
        role: 'persona',
        contentBlocks: [{ type: 'text', text: 'first' }],
        createdAt: 1,
      }),
      msg({ id: 'b', role: 'user', contentBlocks: [{ type: 'text', text: 'u' }], createdAt: 2 }),
      msg({
        id: 'c',
        role: 'persona',
        contentBlocks: [{ type: 'text', text: 'second' }],
        createdAt: 3,
      }),
    ];
    expect(lastCompanionText(msgs)).toBe('second');
  });
  it('returns null when there is no complete persona message', () => {
    expect(lastCompanionText([msg({ role: 'user' })])).toBeNull();
    expect(lastCompanionText([msg({ streamingState: 'incomplete' })])).toBeNull();
  });
  it('skips a most-recent incomplete persona message and falls back to the earlier complete one', () => {
    const msgs = [
      msg({
        id: 'a',
        role: 'persona',
        contentBlocks: [{ type: 'text', text: 'earlier complete' }],
        createdAt: 1,
        streamingState: 'complete',
      }),
      msg({ id: 'b', role: 'user', contentBlocks: [{ type: 'text', text: 'u' }], createdAt: 2 }),
      msg({
        id: 'c',
        role: 'persona',
        contentBlocks: [{ type: 'text', text: 'latest but crashed' }],
        createdAt: 3,
        streamingState: 'incomplete',
      }),
    ];
    expect(lastCompanionText(msgs)).toBe('earlier complete');
  });
});
