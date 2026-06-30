// SPDX-License-Identifier: LGPL-3.0-only
import type { EffectTrigger, Integration, IntegrationResult } from '../types.js';
import { SCREEN_EFFECTS_PROMPT } from './prompt.js';

/** Overlay payload for the emoji shower. */
export interface EmojiShowerEffect extends EffectTrigger {
  kind: 'emoji-shower';
  emoji: string[];
}

/** Largest number of emoji a single shower will rain. */
export const MAX_SHOWER_EMOJI = 5;

const EMOJI_RX = /\p{Extended_Pictographic}/u;
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Split into emoji graphemes, dropping whitespace and non-emoji, capped at MAX_SHOWER_EMOJI. */
function extractEmoji(rawArgs: string): string[] {
  const out: string[] = [];
  for (const { segment } of segmenter.segment(rawArgs)) {
    if (EMOJI_RX.test(segment)) out.push(segment);
    if (out.length === MAX_SHOWER_EMOJI) break;
  }
  return out;
}

/** Screen-effects integration (prefix `sfx`). First inhabitant of the Integrations subsystem. */
export const emojiShowerIntegration: Integration = {
  prefix: 'sfx',
  systemPrompt: SCREEN_EFFECTS_PROMPT,
  handle(command: string, rawArgs: string): IntegrationResult | null {
    if (command !== 'emoji-shower') return null;
    const emoji = extractEmoji(rawArgs);
    if (emoji.length === 0) return null;
    const effect: EmojiShowerEffect = { kind: 'emoji-shower', emoji };
    return { display: `🚿${emoji.join('')}🚿`, effect };
  },
};
