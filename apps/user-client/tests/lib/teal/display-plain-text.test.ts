// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { displayPlainText } from '../../../src/lib/teal/display-plain-text.js';

describe('displayPlainText', () => {
  it('turns inline tags into what the chat shows', () => {
    expect(displayPlainText('[sarcastic] Oh [laugh] great [pause] yes')).toBe(
      '🙃 Oh 😄 great … yes',
    );
  });

  it('removes silent tags and tidies the gap', () => {
    expect(displayPlainText('well [clear-throat] hello')).toBe('well hello');
  });

  it('keeps the text of wrapping tags without the tags', () => {
    expect(displayPlainText('<whisper>a secret</whisper>')).toBe('a secret');
  });

  it('keeps tags literally in fenced code and inline code', () => {
    const fenced = 'before\n```\n[sad] <whisper>x</whisper>\n```\nafter [sad]';
    expect(displayPlainText(fenced)).toBe('before\n```\n[sad] <whisper>x</whisper>\n```\nafter 😔');
    expect(displayPlainText('use `[sad]` then [sad]')).toBe('use `[sad]` then 😔');
  });

  it('leaves unknown brackets alone', () => {
    expect(displayPlainText('see [1] and [melancholic]')).toBe('see [1] and [melancholic]');
  });

  it('is stable on repeated calls (shared global regex)', () => {
    expect(displayPlainText('[laugh]')).toBe('😄');
    expect(displayPlainText('[laugh]')).toBe('😄');
  });
});
