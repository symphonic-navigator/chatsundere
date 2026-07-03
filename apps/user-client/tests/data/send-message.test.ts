// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { MessageRow, PillRow } from '../../src/boot/client-data-db.js';
import { injectedDocIdsFromPills, lastCompanionText } from '../../src/data/send-message.js';

function msg(p: Partial<MessageRow>): MessageRow {
  return {
    id: 'm',
    chatId: 'c',
    role: 'persona',
    contentBlocks: [{ type: 'text', text: 'hi' }],
    createdAt: 1,
    updatedAt: 1,
    bookmarked: false,
    streamingState: 'complete',
    ...p,
  };
}

function pill(p: Partial<PillRow>): PillRow {
  return {
    id: 'p',
    messageId: 'm',
    kind: 'kb-injection',
    positionHint: 'above-text',
    status: 'completed',
    payload: { entries: [] },
    createdAt: 1,
    ...p,
  };
}

describe('injectedDocIdsFromPills', () => {
  it('collects documentIds from kb-injection pill entries', () => {
    const pills = [
      pill({ id: 'a', payload: { entries: [{ documentId: 'd1' }, { documentId: 'd2' }] } }),
      pill({ id: 'b', payload: { entries: [{ documentId: 'd3' }] } }),
    ];
    expect(injectedDocIdsFromPills(pills)).toEqual(new Set(['d1', 'd2', 'd3']));
  });
  it('ignores non-kb-injection pills and entries without a documentId', () => {
    const pills = [
      pill({ id: 'a', kind: 'tool-call', payload: { entries: [{ documentId: 'nope' }] } }),
      pill({ id: 'b', payload: { entries: [{ documentId: 'd1' }, {}] } }),
    ];
    expect(injectedDocIdsFromPills(pills)).toEqual(new Set(['d1']));
  });
  it('returns an empty set for no pills', () => {
    expect(injectedDocIdsFromPills([])).toEqual(new Set());
  });
  it('deduplicates a documentId that appears in multiple pills', () => {
    const pills = [
      pill({ id: 'a', payload: { entries: [{ documentId: 'd1' }] } }),
      pill({ id: 'b', payload: { entries: [{ documentId: 'd1' }] } }),
    ];
    expect(injectedDocIdsFromPills(pills)).toEqual(new Set(['d1']));
  });
});

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
  it('skips opener messages', () => {
    const msgs = [
      msg({ role: 'persona', contentBlocks: [{ type: 'text', text: 'real reply' }] }),
      msg({
        role: 'persona',
        kind: 'opener',
        contentBlocks: [{ type: 'text', text: 'greeting text' }],
      }),
    ];
    expect(lastCompanionText(msgs)).toBe('real reply');
  });
  it('returns null when the only persona message is an opener', () => {
    const msgs = [
      msg({
        role: 'persona',
        kind: 'opener',
        contentBlocks: [{ type: 'text', text: 'greeting text' }],
      }),
    ];
    expect(lastCompanionText(msgs)).toBeNull();
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
