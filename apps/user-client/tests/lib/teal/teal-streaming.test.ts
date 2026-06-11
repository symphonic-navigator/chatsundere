// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { transformTealStream } from '../../../src/lib/teal/teal-streaming.js';

const flat = (chunks: string[]) =>
  transformTealStream(chunks).map((spans) =>
    spans.map((s) => `${s.text}|${s.classNames.join('+')}`),
  );

describe('transformTealStream', () => {
  it('replaces complete inline tags inside a chunk', () => {
    expect(flat(['Hello [laugh] there'])).toEqual([['Hello 😄 there|']]);
  });

  it('handles a tag split across chunk boundaries', () => {
    expect(flat(['Hi [lau', 'gh] yes'])).toEqual([['Hi |'], ['😄 yes|']]);
  });

  it('suppresses a half-typed tag at the stream tip', () => {
    expect(flat(['Hello [lau'])).toEqual([['Hello |']]);
    expect(flat(['Hello <whis'])).toEqual([['Hello |']]);
  });

  it('flushes bracket content that can no longer be a tag', () => {
    expect(flat(['see [1] ok'])).toEqual([['see [1] ok|']]);
    expect(
      flat(['a [this bracketed aside is far too long to ever be an expression tag] b']),
    ).toEqual([['a [this bracketed aside is far too long to ever be an expression tag] b|']]);
  });

  it('applies wrap classes from the opening tag onwards', () => {
    expect(flat(['a <whisper>b', 'c</whisper> d'])).toEqual([
      ['a |', 'b|teal-whisper'],
      ['c|teal-whisper', ' d|'],
    ]);
  });

  it('keeps unknown tags literal and removes silent ones', () => {
    expect(flat(['x <snort>y</snort> [tongue-click] z'])).toEqual([['x <snort>y</snort>  z|']]);
  });

  it('keeps a Markdown link with a tag-word label literal within a chunk', () => {
    expect(flat(['see [laugh](https://x) ok'])).toEqual([['see [laugh](https://x) ok|']]);
  });

  it('passes fenced code through untransformed', () => {
    expect(flat(['```\n[laugh]\n``` [laugh]'])).toEqual([['```\n[laugh]\n``` 😄|']]);
  });

  it('passes inline code through untransformed', () => {
    expect(flat(['use `[pause]` now [pause]'])).toEqual([['use `[pause]` now  … |']]);
  });

  it('is stable across appends (earlier chunks render identically)', () => {
    const first = flat(['Hi [lau']);
    const second = flat(['Hi [lau', 'gh]']);
    expect(second[0]).toEqual(first[0]);
  });

  // Documents the known carry/fence edge: when a fence opens at the first byte
  // of a chunk that follows a carried tag candidate, atLineStart can be stale,
  // so the fence may not be detected. In this case the fence was opened in the
  // first chunk and inFence is correctly set, so subsequent chunks stay in
  // fence-passthrough mode — transforms are suppressed as expected.
  it('keeps suppressing transforms after an unclosed fence (transient view)', () => {
    expect(flat(['```\n[laugh]', ' [laugh]'])).toEqual([['```\n[laugh]|'], [' [laugh]|']]);
  });
});
