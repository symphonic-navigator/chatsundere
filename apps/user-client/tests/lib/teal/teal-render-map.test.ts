import { TEAL_INLINE_TAGS, TEAL_MOOD_TAGS } from '@chatsundere/llm-unified';
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { resolveTealInline, resolveTealWrap } from '../../../src/lib/teal/teal-render-map.js';

describe('resolveTealInline', () => {
  it('renders core tags', () => {
    expect(resolveTealInline('laugh')).toEqual({ kind: 'emoji', value: '😄', label: 'laugh' });
    expect(resolveTealInline('giggle')).toEqual({ kind: 'emoji', value: '🤭', label: 'giggle' });
    expect(resolveTealInline('pause')).toEqual({ kind: 'text', value: ' … ' });
    expect(resolveTealInline('long-pause')).toEqual({ kind: 'text', value: ' …… ' });
    expect(resolveTealInline('gasp')).toEqual({ kind: 'emoji', value: '😲', label: 'gasp' });
  });

  it('prefers combination rows over the core word (longest match)', () => {
    expect(resolveTealInline('soft laugh')).toEqual({
      kind: 'emoji',
      value: '🤭',
      label: 'soft laugh',
    });
    expect(resolveTealInline('SOFT  laugh')).toEqual({
      kind: 'emoji',
      value: '🤭',
      label: 'soft laugh',
    });
  });

  it('falls back to the core word for unknown qualifiers', () => {
    expect(resolveTealInline('exhale sharply')).toEqual({
      kind: 'emoji',
      value: '😮‍💨',
      label: 'exhale',
    });
    expect(resolveTealInline('quick breath')).toEqual({
      kind: 'emoji',
      value: '😮‍💨',
      label: 'breath',
    });
  });

  it('maps the breath family onto one emoji and silences mouth sounds', () => {
    for (const t of ['sigh', 'breath', 'inhale', 'exhale']) {
      expect(resolveTealInline(t)).toEqual({ kind: 'emoji', value: '😮‍💨', label: t });
    }
    expect(resolveTealInline('tongue-click')).toEqual({ kind: 'silent' });
    expect(resolveTealInline('lip-smack')).toEqual({ kind: 'silent' });
  });

  it('returns null for unknown content (stays literal)', () => {
    expect(resolveTealInline('snort')).toBeNull();
    expect(resolveTealInline('1')).toBeNull();
    expect(resolveTealInline('citation needed')).toBeNull();
  });
});

describe('TEAL v2 render rows', () => {
  const emojiOf = (tag: string) => {
    const a = resolveTealInline(tag);
    return a !== null && a.kind === 'emoji' ? a.value : null;
  };

  it.each([
    ['sarcastic', '🙃'],
    ['pouting', '😗'],
    ['tired', '😪'],
    ['bitter', '😣'],
    ['proud', '😎'],
    ['hesitant', '🫤'],
    ['gulp', '😅'],
    ['sniffle', '🤧'],
    ['yawn', '🥱'],
    ['groan', '😩'],
    ['scoff', '🙄'],
  ])('renders %s as %s with its own label', (tag, value) => {
    expect(resolveTealInline(tag)).toEqual({ kind: 'emoji', value, label: tag });
  });

  it('keeps clear-throat silent', () => {
    expect(resolveTealInline('clear-throat')).toEqual({ kind: 'silent' });
  });

  it('gives every mood an emoji labelled with its own word', () => {
    for (const mood of TEAL_MOOD_TAGS) {
      const a = resolveTealInline(mood);
      expect(a?.kind).toBe('emoji');
      if (a?.kind === 'emoji') expect(a.label).toBe(mood);
    }
  });

  it('resolves a mood through a qualifier', () => {
    expect(emojiOf('very sad')).toBe('😔');
  });

  it('shares no emoji between a mood row and a sound row', () => {
    const moods = new Set(TEAL_MOOD_TAGS.map(emojiOf).filter((e) => e !== null));
    const shared = TEAL_INLINE_TAGS.map(emojiOf).filter((e) => e !== null && moods.has(e));
    expect(shared).toEqual([]);
  });
});

describe('resolveTealWrap', () => {
  it('maps wrapping tags to presentation classes', () => {
    expect(resolveTealWrap('whisper')).toEqual({ kind: 'wrap', className: 'teal-whisper' });
    expect(resolveTealWrap('soft')).toEqual({ kind: 'wrap', className: 'teal-italic' });
    expect(resolveTealWrap('loud')).toEqual({ kind: 'wrap', className: 'teal-bold' });
    expect(resolveTealWrap('emphasis')).toEqual({ kind: 'wrap', className: 'teal-bold' });
    expect(resolveTealWrap('laugh-speak')).toEqual({ kind: 'wrap', className: 'teal-bold' });
    expect(resolveTealWrap('slow')).toEqual({ kind: 'wrap', className: 'teal-slow' });
    expect(resolveTealWrap('singing')).toEqual({ kind: 'wrap', className: 'teal-singing' });
    expect(resolveTealWrap('sing-song')).toEqual({ kind: 'wrap', className: 'teal-singing' });
    expect(resolveTealWrap('WHISPER')).toEqual({ kind: 'wrap', className: 'teal-whisper' });
  });

  it('silences voice-only modulation and rejects unknown tags', () => {
    for (const t of [
      'higher-pitch',
      'lower-pitch',
      'fast',
      'build-intensity',
      'decrease-intensity',
    ]) {
      expect(resolveTealWrap(t)).toEqual({ kind: 'silent' });
    }
    expect(resolveTealWrap('snort')).toBeNull();
  });
});
