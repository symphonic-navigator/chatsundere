// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  TEAL_MARK_END,
  TEAL_MARK_START,
  preprocessTeal,
} from '../../../src/lib/teal/preprocess-teal.js';

describe('preprocessTeal — inline tags', () => {
  it('replaces known inline tags per the render map', () => {
    expect(preprocessTeal('Hello [laugh] there')).toBe('Hello 😄 there');
    expect(preprocessTeal('Wait[pause]now')).toBe('Wait … now');
    expect(preprocessTeal('a [soft laugh] b')).toBe('a 🤭 b');
  });

  it('removes silent inline tags', () => {
    expect(preprocessTeal('a [tongue-click] b')).toBe('a  b');
  });

  it('leaves unknown brackets literal', () => {
    expect(preprocessTeal('see [1], [sic], [snort]')).toBe('see [1], [sic], [snort]');
    expect(preprocessTeal('[checklist item](https://x)')).toBe('[checklist item](https://x)');
  });
});

describe('preprocessTeal — wrapping tags', () => {
  it('converts known wraps to sentinel markers', () => {
    expect(preprocessTeal('<whisper>hi</whisper>')).toBe(
      `${TEAL_MARK_START}whisper${TEAL_MARK_END}hi${TEAL_MARK_START}/whisper${TEAL_MARK_END}`,
    );
  });

  it('drops silent wraps but keeps the text', () => {
    expect(preprocessTeal('<fast>quick</fast>')).toBe('quick');
  });

  it('leaves unknown angle tags untouched (default pipeline strips them)', () => {
    expect(preprocessTeal('<snort>text</snort>')).toBe('<snort>text</snort>');
  });
});

describe('preprocessTeal — code immunity', () => {
  it('never rewrites inside fenced code blocks', () => {
    const src = 'before\n```\n[laugh] <whisper>x</whisper>\n```\nafter [laugh]';
    expect(preprocessTeal(src)).toBe('before\n```\n[laugh] <whisper>x</whisper>\n```\nafter 😄');
  });

  it('never rewrites inside an unclosed (streaming) fenced code block', () => {
    const src = '```\n[laugh]';
    expect(preprocessTeal(src)).toBe(src);
  });

  it('never rewrites inside inline code', () => {
    expect(preprocessTeal('use `[pause]` here [pause]')).toBe('use `[pause]` here  … ');
  });
});
