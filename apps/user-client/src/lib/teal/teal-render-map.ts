// SPDX-License-Identifier: AGPL-3.0-only
import {
  type TealInlineTag,
  type TealWrappingTag,
  isTealWrapping,
  matchTealInline,
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
  | { kind: 'emoji'; value: string }
  | { kind: 'text'; value: string }
  | { kind: 'wrap'; className: string }
  | { kind: 'silent' };

const BREATH = { kind: 'emoji', value: '😮‍💨' } as const;

/** Combination rows — matched before the core word (longest match, D3). */
const INLINE_COMBINATIONS: Readonly<Record<string, TealRenderAction>> = {
  'soft laugh': { kind: 'emoji', value: '🤭' },
};

const INLINE_RENDER: Readonly<Record<TealInlineTag, TealRenderAction>> = {
  pause: { kind: 'text', value: ' … ' },
  'long-pause': { kind: 'text', value: ' …… ' },
  'hum-tune': { kind: 'emoji', value: '🎶' },
  laugh: { kind: 'emoji', value: '😄' },
  chuckle: { kind: 'emoji', value: '😁' },
  giggle: { kind: 'emoji', value: '🤭' },
  cry: { kind: 'emoji', value: '😢' },
  whoop: { kind: 'emoji', value: '🥳' },
  tsk: { kind: 'emoji', value: '😒' },
  'tongue-click': { kind: 'silent' },
  'lip-smack': { kind: 'silent' },
  breath: BREATH,
  inhale: BREATH,
  exhale: BREATH,
  sigh: BREATH,
  gasp: { kind: 'emoji', value: '😲' },
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

/** Resolve inline bracket content: combination row first, then core word. */
export function resolveTealInline(content: string): TealRenderAction | null {
  const norm = content.trim().toLowerCase().replace(/\s+/g, ' ');
  const combo = INLINE_COMBINATIONS[norm];
  if (combo) return combo;
  const core = matchTealInline(norm);
  return core === null ? null : INLINE_RENDER[core];
}

/** Resolve a wrapping tag name; null for unknown tags. */
export function resolveTealWrap(name: string): TealRenderAction | null {
  const norm = name.toLowerCase();
  return isTealWrapping(norm) ? WRAP_RENDER[norm] : null;
}
