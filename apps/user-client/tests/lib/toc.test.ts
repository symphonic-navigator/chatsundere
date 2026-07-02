import { describe, expect, it } from 'vitest';
import type { MessageRow } from '../../src/boot/client-data-db.js';
import { buildToc, labelFor, snippet } from '../../src/lib/toc.js';

function msg(p: Partial<MessageRow> & { id: string }): MessageRow {
  return {
    chatId: 'c1',
    role: 'user',
    contentBlocks: [{ type: 'text', text: 'hello world' }],
    createdAt: 0,
    updatedAt: 0,
    bookmarked: false,
    streamingState: 'complete',
    ...p,
  };
}

describe('snippet', () => {
  it('returns the full first line when short', () => {
    expect(snippet(msg({ id: 'a', contentBlocks: [{ type: 'text', text: 'short one' }] }))).toBe(
      'short one',
    );
  });
  it('trims on a word boundary with an ellipsis when long', () => {
    const long = 'the quick brown fox jumps over the lazy dog and keeps running forever';
    const out = snippet(msg({ id: 'a', contentBlocks: [{ type: 'text', text: long }] }));
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(41);
    expect(out).not.toMatch(/\s…$/);
  });
  it('uses only the first line', () => {
    expect(
      snippet(msg({ id: 'a', contentBlocks: [{ type: 'text', text: 'first\nsecond' }] })),
    ).toBe('first');
  });
});

describe('labelFor', () => {
  it('prefers a non-empty custom label', () => {
    expect(labelFor(msg({ id: 'a', bookmarkLabel: 'My note' }))).toBe('My note');
  });
  it('falls back to the snippet when label is null/empty/whitespace', () => {
    expect(labelFor(msg({ id: 'a', bookmarkLabel: null }))).toBe('hello world');
    expect(labelFor(msg({ id: 'a', bookmarkLabel: '   ' }))).toBe('hello world');
  });
});

describe('buildToc', () => {
  const messages: MessageRow[] = [
    msg({ id: 'u1', role: 'user', createdAt: 1, contentBlocks: [{ type: 'text', text: 'u-one' }] }),
    msg({
      id: 'p1',
      role: 'persona',
      createdAt: 2,
      bookmarked: true,
      contentBlocks: [{ type: 'text', text: 'p-one' }],
    }),
    msg({
      id: 'u2',
      role: 'user',
      createdAt: 3,
      bookmarked: true,
      bookmarkLabel: 'Named',
      contentBlocks: [{ type: 'text', text: 'u-two' }],
    }),
  ];

  it('timeline lists only user messages, in createdAt order', () => {
    const toc = buildToc(messages);
    expect(toc.timeline.map((e) => e.messageId)).toEqual(['u1', 'u2']);
  });
  it('pinned lists all starred messages (user + persona), in order', () => {
    const toc = buildToc(messages);
    expect(toc.pinned.map((e) => e.messageId)).toEqual(['p1', 'u2']);
  });
  it('marks isDefaultLabel correctly and carries the resolved label', () => {
    const toc = buildToc(messages);
    const u2Timeline = toc.timeline.find((e) => e.messageId === 'u2');
    expect(u2Timeline?.label).toBe('Named');
    expect(u2Timeline?.isDefaultLabel).toBe(false);
    const u1Timeline = toc.timeline.find((e) => e.messageId === 'u1');
    expect(u1Timeline?.label).toBe('u-one');
    expect(u1Timeline?.isDefaultLabel).toBe(true);
    expect(u1Timeline?.starred).toBe(false);
  });
});
