// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { ContentBlock } from '../../src/boot/client-data-db.js';
import {
  coalesceAdjacent,
  flattenAnswerText,
  groupAdjacent,
} from '../../src/lib/content-blocks.js';

describe('flattenAnswerText', () => {
  it('joins adjacent text blocks', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'hello ' },
      { type: 'text', text: 'world' },
    ];
    expect(flattenAnswerText(blocks)).toBe('hello world');
  });

  it('filters out reasoning blocks entirely', () => {
    const blocks: ContentBlock[] = [
      { type: 'reasoning', text: 'thinking …' },
      { type: 'text', text: 'answer' },
    ];
    expect(flattenAnswerText(blocks)).toBe('answer');
  });

  it('ignores pill blocks (no plaintext)', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'before ' },
      { type: 'pill', pillId: 'p-1' },
      { type: 'text', text: 'after' },
    ];
    expect(flattenAnswerText(blocks)).toBe('before after');
  });

  it('handles empty array', () => {
    expect(flattenAnswerText([])).toBe('');
  });
});

describe('coalesceAdjacent', () => {
  it('merges adjacent text blocks', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
      { type: 'text', text: 'c' },
    ];
    expect(coalesceAdjacent(blocks)).toEqual([{ type: 'text', text: 'abc' }]);
  });

  it('merges adjacent reasoning blocks', () => {
    const blocks: ContentBlock[] = [
      { type: 'reasoning', text: 'one ' },
      { type: 'reasoning', text: 'two' },
    ];
    expect(coalesceAdjacent(blocks)).toEqual([{ type: 'reasoning', text: 'one two' }]);
  });

  it('never merges pill blocks (preserves identity)', () => {
    const blocks: ContentBlock[] = [
      { type: 'pill', pillId: 'p-1' },
      { type: 'pill', pillId: 'p-2' },
    ];
    expect(coalesceAdjacent(blocks)).toEqual(blocks);
  });

  it('preserves boundaries between different types', () => {
    const blocks: ContentBlock[] = [
      { type: 'reasoning', text: 'think ' },
      { type: 'reasoning', text: 'more' },
      { type: 'text', text: 'answer ' },
      { type: 'text', text: 'here' },
      { type: 'reasoning', text: 'second-pass' },
    ];
    expect(coalesceAdjacent(blocks)).toEqual([
      { type: 'reasoning', text: 'think more' },
      { type: 'text', text: 'answer here' },
      { type: 'reasoning', text: 'second-pass' },
    ]);
  });
});

describe('groupAdjacent', () => {
  it('groups adjacent same-type blocks into ordered groups', () => {
    const blocks: ContentBlock[] = [
      { type: 'reasoning', text: 'a' },
      { type: 'reasoning', text: 'b' },
      { type: 'text', text: 'hello' },
      { type: 'pill', pillId: 'p-1' },
      { type: 'text', text: 'world' },
    ];
    const groups = groupAdjacent(blocks);
    expect(groups).toEqual([
      {
        type: 'reasoning',
        blocks: [
          { type: 'reasoning', text: 'a' },
          { type: 'reasoning', text: 'b' },
        ],
      },
      { type: 'text', blocks: [{ type: 'text', text: 'hello' }] },
      { type: 'pill', blocks: [{ type: 'pill', pillId: 'p-1' }] },
      { type: 'text', blocks: [{ type: 'text', text: 'world' }] },
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(groupAdjacent([])).toEqual([]);
  });

  it('keeps adjacent pill blocks as separate groups (pillId identity is load-bearing)', () => {
    // A parallel tool-call turn produces several pill blocks with no text in
    // between; the renderer draws group.blocks[0] only, so grouping them would
    // swallow every pill after the first (the Fable parallel-tools bug).
    const blocks: ContentBlock[] = [
      { type: 'pill', pillId: 'p-1' },
      { type: 'pill', pillId: 'p-2' },
      { type: 'pill', pillId: 'p-3' },
    ];
    expect(groupAdjacent(blocks)).toEqual([
      { type: 'pill', blocks: [{ type: 'pill', pillId: 'p-1' }] },
      { type: 'pill', blocks: [{ type: 'pill', pillId: 'p-2' }] },
      { type: 'pill', blocks: [{ type: 'pill', pillId: 'p-3' }] },
    ]);
  });
});
