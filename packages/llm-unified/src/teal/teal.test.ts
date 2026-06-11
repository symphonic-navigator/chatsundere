// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import {
  TEAL_EXPRESSION_PROMPT,
  TEAL_INLINE_TAGS,
  TEAL_WRAPPING_TAGS,
  isTealWrapping,
  matchTealInline,
  stripTeal,
} from './teal.js';

describe('TEAL vocabulary', () => {
  it('carries the v1 snapshot sizes', () => {
    expect(TEAL_INLINE_TAGS.length).toBe(16);
    expect(TEAL_WRAPPING_TAGS.length).toBe(13);
  });

  it('matches exact inline tags', () => {
    expect(matchTealInline('laugh')).toBe('laugh');
    expect(matchTealInline('long-pause')).toBe('long-pause');
  });

  it('matches qualified inline tags on the core word', () => {
    expect(matchTealInline('soft laugh')).toBe('laugh');
    expect(matchTealInline('exhale sharply')).toBe('exhale');
    expect(matchTealInline('Soft  Laugh')).toBe('laugh'); // normalises case + whitespace
  });

  it('returns null for unknown content', () => {
    expect(matchTealInline('snort')).toBeNull();
    expect(matchTealInline('1')).toBeNull();
    expect(matchTealInline('sic')).toBeNull();
    expect(matchTealInline('')).toBeNull();
  });

  it('isTealWrapping accepts known tags case-insensitively', () => {
    expect(isTealWrapping('whisper')).toBe(true);
    expect(isTealWrapping('Whisper')).toBe(true);
    expect(isTealWrapping('snort')).toBe(false);
  });

  it('returns null for a lone wrapping tag name in brackets', () => {
    expect(matchTealInline('soft')).toBeNull();
    expect(matchTealInline('whisper')).toBeNull();
  });
});

describe('stripTeal', () => {
  it('removes known inline tags and wrapping tags, keeps text', () => {
    expect(stripTeal('Hello [laugh] there')).toBe('Hello there');
    expect(stripTeal('<whisper>a secret</whisper>')).toBe('a secret');
    expect(stripTeal('[soft laugh] <loud>hey</loud>')).toBe('hey');
  });

  it('leaves unknown brackets and tags literal', () => {
    expect(stripTeal('see [1] and [sic]')).toBe('see [1] and [sic]');
    expect(stripTeal('<snort>text</snort>')).toBe('<snort>text</snort>');
  });
});

describe('TEAL_EXPRESSION_PROMPT', () => {
  it('lists both syntaxes and every tag', () => {
    for (const tag of TEAL_INLINE_TAGS) expect(TEAL_EXPRESSION_PROMPT).toContain(`[${tag}]`);
    for (const tag of TEAL_WRAPPING_TAGS) expect(TEAL_EXPRESSION_PROMPT).toContain(`<${tag}>`);
  });

  it('carries dosage and the anti-double-marking rule (structural markers)', () => {
    expect(TEAL_EXPRESSION_PROMPT).toContain('0–2 markups');
    expect(TEAL_EXPRESSION_PROMPT).toContain('asterisks');
  });
});
