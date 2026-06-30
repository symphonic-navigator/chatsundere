// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { getIntegration } from '../registry.js';
import { type EmojiShowerEffect, emojiShowerIntegration } from './emoji-shower.js';

describe('emojiShowerIntegration', () => {
  it('wraps display in shower-heads and rains only the chosen emoji', () => {
    const r = emojiShowerIntegration.handle('emoji-shower', '🔥🦊💖');
    expect(r?.display).toBe('🚿🔥🦊💖🚿');
    expect(r?.effect as EmojiShowerEffect).toEqual({
      kind: 'emoji-shower',
      emoji: ['🔥', '🦊', '💖'],
    });
  });

  it('keeps ZWJ / skin-tone emoji as single graphemes', () => {
    const r = emojiShowerIntegration.handle('emoji-shower', '👍🏽👩‍🚀');
    expect(r?.effect as EmojiShowerEffect).toEqual({
      kind: 'emoji-shower',
      emoji: ['👍🏽', '👩‍🚀'],
    });
  });

  it('caps at five emoji', () => {
    const r = emojiShowerIntegration.handle('emoji-shower', '🔥🦊💖✨🎉🌟💫');
    expect((r?.effect as EmojiShowerEffect).emoji).toHaveLength(5);
  });

  it('returns null when there are no emoji (tag stays literal)', () => {
    expect(emojiShowerIntegration.handle('emoji-shower', 'hello world')).toBeNull();
  });

  it('returns null for an unknown command', () => {
    expect(emojiShowerIntegration.handle('confetti', '🎉')).toBeNull();
  });
});

describe('registry', () => {
  it('resolves the sfx prefix to the screen-effects integration', () => {
    expect(getIntegration('sfx')).toBe(emojiShowerIntegration);
    expect(getIntegration('nope')).toBeNull();
  });
});
