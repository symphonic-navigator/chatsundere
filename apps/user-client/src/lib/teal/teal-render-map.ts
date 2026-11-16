// SPDX-License-Identifier: AGPL-3.0-only
import {
  type TealInlineTag,
  type TealMoodTag,
  type TealWrappingTag,
  isTealWrapping,
  resolveTealBracket,
} from '@chatsundere/llm-unified';

/**
 * TEAL display render map — the data file Chris curates. The display is one
 * translation target of the canonical language (the prettiest one): every
 * row says how a tag looks in chat text. Three output classes: emoji,
 * typography (text replacement or a styled span), or silent (audible later,
 * not visible). Editing a row is the whole change — the plugins are generic.
 * Spec: superpowers/specs/2026-06-11-teal-voice-expression-language-design.md §4.3.
 */
export type TealRenderAction =
  | { kind: 'emoji'; value: string; label: string }
  | { kind: 'text'; value: string }
  | { kind: 'wrap'; className: string }
  | { kind: 'silent' };

/** An emoji row; `label` is the core word a screen reader announces instead of the emoji's name. */
function emoji(value: string, label: string): TealRenderAction {
  return { kind: 'emoji', value, label };
}

/** Combination rows — matched before the core word (longest match, D3). */
const INLINE_COMBINATIONS: Readonly<Record<string, TealRenderAction>> = {
  'soft laugh': emoji('🤭', 'laugh'),
};

const INLINE_RENDER: Readonly<Record<TealInlineTag, TealRenderAction>> = {
  pause: { kind: 'text', value: ' … ' },
  'long-pause': { kind: 'text', value: ' …… ' },
  'hum-tune': emoji('🎶', 'hum-tune'),
  laugh: emoji('😄', 'laugh'),
  chuckle: emoji('😁', 'chuckle'),
  giggle: emoji('🤭', 'giggle'),
  cry: emoji('😢', 'cry'),
  whoop: emoji('🥳', 'whoop'),
  tsk: emoji('😒', 'tsk'),
  'tongue-click': { kind: 'silent' },
  'lip-smack': { kind: 'silent' },
  breath: emoji('😮‍💨', 'breath'),
  inhale: emoji('😮‍💨', 'inhale'),
  exhale: emoji('😮‍💨', 'exhale'),
  sigh: emoji('😮‍💨', 'sigh'),
  gasp: emoji('😲', 'gasp'),
  'clear-throat': { kind: 'silent' },
  gulp: emoji('😅', 'gulp'),
  yawn: emoji('🥱', 'yawn'),
  sniffle: emoji('🤧', 'sniffle'),
  groan: emoji('😩', 'groan'),
  scoff: emoji('🙄', 'scoff'),
};

/** Mood rows (spec §7.1) — one emoji per mood, shown at the tag's position. */
const MOOD_RENDER: Readonly<Record<TealMoodTag, TealRenderAction>> = {
  excited: emoji('🤩', 'excited'),
  playful: emoji('😜', 'playful'),
  amazed: emoji('😮', 'amazed'),
  proud: emoji('😎', 'proud'),
  startled: emoji('😳', 'startled'),
  annoyed: emoji('😤', 'annoyed'),
  angry: emoji('😠', 'angry'),
  sarcastic: emoji('🙃', 'sarcastic'),
  bitter: emoji('😣', 'bitter'),
  nervous: emoji('😬', 'nervous'),
  anxious: emoji('😰', 'anxious'),
  scared: emoji('😨', 'scared'),
  hesitant: emoji('🫤', 'hesitant'),
  confused: emoji('😕', 'confused'),
  tired: emoji('😪', 'tired'),
  bored: emoji('😑', 'bored'),
  sad: emoji('😔', 'sad'),
  'let-down': emoji('😞', 'let-down'),
  curious: emoji('🤔', 'curious'),
  thoughtful: emoji('💭', 'thoughtful'),
  content: emoji('😌', 'content'),
  peaceful: emoji('🕊️', 'peaceful'),
  mischievous: emoji('😈', 'mischievous'),
  affectionate: emoji('🥰', 'affectionate'),
  teasing: emoji('😏', 'teasing'),
  flirtatious: emoji('😘', 'flirtatious'),
  seductive: emoji('💋', 'seductive'),
  shy: emoji('🙈', 'shy'),
  pouting: emoji('😗', 'pouting'),
};

const WRAP_RENDER: Readonly<Record<TealWrappingTag, TealRenderAction>> = {
  soft: { kind: 'wrap', className: 'teal-italic' },
  whisper: { kind: 'wrap', className: 'teal-whisper' },
  loud: { kind: 'wrap', className: 'teal-bold' },
  emphasis: { kind: 'wrap', className: 'teal-bold' },
  'laugh-speak': { kind: 'wrap', className: 'teal-bold' },
  slow: { kind: 'wrap', className: 'teal-slow' },
  singing: { kind: 'wrap', className: 'teal-singing' },
  'sing-song': { kind: 'wrap', className: 'teal-singing' },
  'build-intensity': { kind: 'silent' },
  'decrease-intensity': { kind: 'silent' },
  'higher-pitch': { kind: 'silent' },
  'lower-pitch': { kind: 'silent' },
  fast: { kind: 'silent' },
};

/** Resolve inline bracket content (sound or mood): combination row first, then core word. */
export function resolveTealInline(content: string): TealRenderAction | null {
  const norm = content.trim().toLowerCase().replace(/\s+/g, ' ');
  const combo = INLINE_COMBINATIONS[norm];
  if (combo) return combo;
  const hit = resolveTealBracket(norm);
  if (hit === null) return null;
  return hit.kind === 'mood'
    ? MOOD_RENDER[hit.tag as TealMoodTag]
    : INLINE_RENDER[hit.tag as TealInlineTag];
}

/** Resolve a wrapping tag name; null for unknown tags. */
export function resolveTealWrap(name: string): TealRenderAction | null {
  const norm = name.toLowerCase();
  return isTealWrapping(norm) ? WRAP_RENDER[norm] : null;
}
