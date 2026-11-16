// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import {
  TEAL_EXPRESSION_PROMPT,
  TEAL_INLINE_TAGS,
  TEAL_MOOD_TAGS,
  TEAL_VERSION,
  TEAL_WRAPPING_TAGS,
  isTealWrapping,
  matchTealInline,
  resolveTealBracket,
  stripTeal,
} from './teal.js';

describe('TEAL vocabulary', () => {
  it('carries the v1 sizes plus the six v2 sounds', () => {
    expect(TEAL_INLINE_TAGS.length).toBe(22);
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

  it('carries the strict closed-vocabulary rules for weaker models (structural markers)', () => {
    expect(TEAL_EXPRESSION_PROMPT).toContain('COMPLETE vocabulary');
    expect(TEAL_EXPRESSION_PROMPT).toContain('Never invent a tag');
    expect(TEAL_EXPRESSION_PROMPT).toContain("wrapping tag's name in square brackets");
    expect(TEAL_EXPRESSION_PROMPT).toContain('always English');
    expect(TEAL_EXPRESSION_PROMPT).toContain('Wrong:');
    expect(TEAL_EXPRESSION_PROMPT).toContain('Right:');
  });
});

describe('TEAL v2 vocabulary', () => {
  it('is version 2 with the B sounds and 29 moods', () => {
    expect(TEAL_VERSION).toBe(2);
    for (const t of ['clear-throat', 'gulp', 'yawn', 'sniffle', 'groan', 'scoff']) {
      expect((TEAL_INLINE_TAGS as readonly string[]).includes(t)).toBe(true);
    }
    expect(TEAL_MOOD_TAGS.length).toBe(29);
    for (const m of ['sarcastic', 'let-down', 'seductive', 'pouting']) {
      expect((TEAL_MOOD_TAGS as readonly string[]).includes(m)).toBe(true);
    }
    for (const m of TEAL_MOOD_TAGS) {
      expect((TEAL_INLINE_TAGS as readonly string[]).includes(m)).toBe(false);
    }
  });
});

describe('resolveTealBracket', () => {
  it('resolves moods and sounds with levels', () => {
    expect(resolveTealBracket('sarcastic')).toEqual({ kind: 'mood', tag: 'sarcastic', level: 2 });
    expect(resolveTealBracket('slightly nervous')).toEqual({
      kind: 'mood',
      tag: 'nervous',
      level: 2,
    });
    expect(resolveTealBracket('playful giggle')).toEqual({
      kind: 'sound',
      tag: 'giggle',
      level: 1,
    });
    expect(resolveTealBracket('yawn')).toEqual({ kind: 'sound', tag: 'yawn', level: 2 });
    expect(resolveTealBracket('soft laugh')).toEqual({ kind: 'sound', tag: 'laugh', level: 1 });
    expect(resolveTealBracket('shy')).toEqual({ kind: 'mood', tag: 'shy', level: 2 });
  });

  it('keeps ordinary prose brackets literal', () => {
    for (const c of [
      'content removed',
      'tired of this',
      'sad but true',
      'melancholic',
      'very very sad',
      'sad today',
      '',
    ]) {
      expect(resolveTealBracket(c)).toBeNull();
    }
  });
});

describe('stripTeal by level', () => {
  const input = '[sarcastic] Oh [laugh] great <whisper>yes</whisper>';
  it('strips by level', () => {
    expect(stripTeal(input, 0)).toBe('Oh great yes');
    expect(stripTeal(input, 1)).toBe('Oh [laugh] great <whisper>yes</whisper>');
    expect(stripTeal(input, 2)).toBe(input);
    expect(stripTeal('[yawn] tired', 1)).toBe('tired');
    expect(stripTeal('[content removed]')).toBe('[content removed]');
  });
});

describe('TEAL mood prompt', () => {
  it('has a Mood section naming every mood', () => {
    expect(TEAL_EXPRESSION_PROMPT).toContain('### Mood');
    expect(TEAL_EXPRESSION_PROMPT).toContain('[sarcastic]');
    for (const m of TEAL_MOOD_TAGS) expect(TEAL_EXPRESSION_PROMPT).toContain(`[${m}]`);
  });
});
