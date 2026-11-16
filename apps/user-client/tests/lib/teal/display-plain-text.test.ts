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

  it('keeps list indentation when a tag is removed or replaced', () => {
    expect(displayPlainText('- a\n  - [clear-throat] foo\n    1. [laugh] x')).toBe(
      '- a\n  - foo\n    1. 😄 x',
    );
  });

  it('keeps a trailing hard break and continuation indentation', () => {
    expect(displayPlainText('line [clear-throat] one  \n  cont [laugh]')).toBe(
      'line one  \n  cont 😄',
    );
  });

  it('leaves indented code blocks literal but translates list continuations', () => {
    expect(displayPlainText('para [sad]\n\n    [sad] code\n\tmore [sad]\n\nafter [sad]')).toBe(
      'para 😔\n\n    [sad] code\n\tmore [sad]\n\nafter 😔',
    );
    expect(displayPlainText('- item\n\n    [sad] in list')).toBe('- item\n\n    😔 in list');
  });

  it('keeps double-backtick spans with an inner backtick literal', () => {
    expect(displayPlainText('``a `[sad]` b`` and [sad]')).toBe('``a `[sad]` b`` and 😔');
  });

  it('keeps ~~~ fences, paragraph breaks and headings', () => {
    expect(displayPlainText('~~~\n[sad]\n~~~\n\n# Title [laugh]\n\nnext')).toBe(
      '~~~\n[sad]\n~~~\n\n# Title 😄\n\nnext',
    );
  });

  it('opens a fence after an indented code block and a blank line', () => {
    expect(displayPlainText('para\n\n    code [sad]\n\n```\n[sad]\n```\nafter [sad]')).toBe(
      'para\n\n    code [sad]\n\n```\n[sad]\n```\nafter 😔',
    );
  });

  it('leaves a Markdown link whose text looks like a tag untouched', () => {
    expect(displayPlainText('[content](https://example.org)')).toBe(
      '[content](https://example.org)',
    );
    expect(displayPlainText('[laugh](https://example.org) [laugh]')).toBe(
      '[laugh](https://example.org) 😄',
    );
  });

  it('shows an integration tag as the chat displays it', () => {
    expect(displayPlainText('yay [sfx:emoji-shower 🔥🦊💖] ok')).toBe('yay 🚿🔥🦊💖🚿 ok');
    expect(displayPlainText('`[sfx:emoji-shower 🔥]`')).toBe('`[sfx:emoji-shower 🔥]`');
    expect(displayPlainText('[sfx:confetti 🎉]')).toBe('[sfx:confetti 🎉]');
  });
});
