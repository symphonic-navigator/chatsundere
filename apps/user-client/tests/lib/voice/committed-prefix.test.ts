// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { ContentBlock } from '../../../src/boot/client-data-db.js';
import {
  coalesceBlocks,
  committedSegments,
  committedTextLength,
  splitStreamingContent,
} from '../../../src/lib/voice/committed-prefix.js';
import { segmentMessage } from '../../../src/lib/voice/segmentation.js';

const OPTS = { mode: 'paragraph' as const, roleplay: false };
const text = (t: string): ContentBlock => ({ type: 'text', text: t });

describe('coalesceBlocks', () => {
  it('merges adjacent text chunks into one block (matches engine finalisation)', () => {
    expect(coalesceBlocks([text('Hel'), text('lo'), text(' world')])).toEqual([
      text('Hello world'),
    ]);
  });
  it('keeps pills as boundaries between text runs', () => {
    const blocks: ContentBlock[] = [
      text('a'),
      text('b'),
      { type: 'pill', pillId: 'p1' },
      text('c'),
    ];
    expect(coalesceBlocks(blocks)).toEqual([text('ab'), { type: 'pill', pillId: 'p1' }, text('c')]);
  });
});

describe('committedTextLength (stream running)', () => {
  it('commits nothing while the first paragraph is still open', () => {
    expect(committedTextLength('The fog rolled in', false)).toBe(0);
  });
  it('commits a paragraph once a blank line closes it', () => {
    const t = 'Para one is done.\n\nPara two stil';
    const len = committedTextLength(t, false);
    expect(t.slice(0, len)).toContain('Para one is done.');
    expect(t.slice(0, len)).not.toContain('Para two');
  });
  it('commits everything when streamDone', () => {
    const t = 'Only one open paragraph';
    expect(committedTextLength(t, true)).toBe(t.length);
  });
  it('commits nothing inside an unterminated code fence', () => {
    const t = 'Intro line.\n\n```ts\nconst x = 1';
    const len = committedTextLength(t, false);
    expect(t.slice(0, len)).toContain('Intro line.');
    expect(t.slice(0, len)).not.toContain('const x');
  });
  it('does not commit an open paragraph that merely ends with a newline', () => {
    expect(committedTextLength('First line.\nSecond line still in same paragraph.\n', false)).toBe(
      0,
    );
  });
  it('includes the full blank-line separator in the committed prefix', () => {
    const t = 'Done para.\n\nOpen';
    expect('Done para.\n\n'.length).toBe(committedTextLength(t, false));
  });
  it('still commits a paragraph terminated by a blank line at end of text', () => {
    const t = 'Para.\n\n';
    expect(committedTextLength(t, false)).toBe(t.length);
  });
});

describe('splitStreamingContent', () => {
  it('withholds the open trailing paragraph as tailText', () => {
    const r = splitStreamingContent([text('Closed para.\n\nOpen tai')], false);
    expect(r.tailText).toBe('Open tai');
    expect(r.committedBlocks).toEqual([text('Closed para.\n\n')]);
  });
  it('has no tail when the last block is a pill', () => {
    const blocks: ContentBlock[] = [text('done'), { type: 'pill', pillId: 'p1' }];
    const r = splitStreamingContent(blocks, false);
    expect(r.tailText).toBe('');
  });
});

describe('committedSegments', () => {
  it('returns no segments before the first blank line', () => {
    expect(committedSegments([text('still typing the first line')], false, OPTS)).toEqual([]);
  });
  it('segment ids stay stable as the tail grows', () => {
    const a = committedSegments([text('First done.\n\nSecond gro')], false, OPTS);
    const b = committedSegments(
      [text('First done.\n\nSecond growing more.\n\nThird')],
      false,
      OPTS,
    );
    expect(a.map((s) => s.segmentId)).toEqual(['0:0']);
    expect(b.slice(0, a.length).map((s) => s.segmentId)).toEqual(a.map((s) => s.segmentId));
  });
  it('equals segmentMessage on the finalised (coalesced) message when streamDone', () => {
    const streamed: ContentBlock[] = [text('One.\n\n'), text('Two.\n\n'), text('Three.')];
    const finalised = coalesceBlocks(streamed);
    expect(committedSegments(streamed, true, OPTS)).toEqual(segmentMessage(finalised, OPTS));
  });
});
