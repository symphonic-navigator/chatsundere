// SPDX-License-Identifier: LGPL-3.0-only

/**
 * TEAL v1 — Transformative Expression and Anthropomorphisation Layer.
 *
 * The canonical voice expression language: a closed, versioned vocabulary
 * (v1 = xAI voice-tag snapshot, 2026-06-11) that every consumer translates
 * from — the chat display renders it as friendly formatting, and future TTS
 * translators map it onto each backend's capabilities. Extension is
 * deliberate curation (a new version), never heuristics. See the design spec
 * `superpowers/specs/2026-06-11-teal-voice-expression-language-design.md`.
 */

export const TEAL_VERSION = 1;

/** Inline tags — discrete one-shot events, written `[tag]`. */
export const TEAL_INLINE_TAGS = [
  'pause',
  'long-pause',
  'hum-tune',
  'laugh',
  'chuckle',
  'giggle',
  'cry',
  'whoop',
  'tsk',
  'tongue-click',
  'lip-smack',
  'breath',
  'inhale',
  'exhale',
  'sigh',
  'gasp',
] as const;
export type TealInlineTag = (typeof TEAL_INLINE_TAGS)[number];

/** Wrapping tags — prosody spans, written `<tag>…</tag>`. May nest. */
export const TEAL_WRAPPING_TAGS = [
  'soft',
  'whisper',
  'loud',
  'build-intensity',
  'decrease-intensity',
  'higher-pitch',
  'lower-pitch',
  'slow',
  'fast',
  'sing-song',
  'singing',
  'laugh-speak',
  'emphasis',
] as const;
export type TealWrappingTag = (typeof TEAL_WRAPPING_TAGS)[number];

const INLINE_SET: ReadonlySet<string> = new Set(TEAL_INLINE_TAGS);
const WRAPPING_SET: ReadonlySet<string> = new Set(TEAL_WRAPPING_TAGS);

const INLINE_DESCRIPTIONS: Record<TealInlineTag, string> = {
  pause: 'a short silence',
  'long-pause': 'a longer deliberate silence',
  'hum-tune': 'a brief hummed tune',
  laugh: 'a full laugh',
  chuckle: 'a quiet chuckle',
  giggle: 'a playful giggle',
  cry: 'a sob or cry',
  whoop: 'a whoop of excitement',
  tsk: 'a disapproving tsk',
  'tongue-click': 'a tongue click',
  'lip-smack': 'a lip smack',
  breath: 'an audible breath',
  inhale: 'an inward breath',
  exhale: 'an outward breath',
  sigh: 'a sigh',
  gasp: 'a sharp gasp',
};

const WRAPPING_DESCRIPTIONS: Record<TealWrappingTag, string> = {
  soft: 'soften the delivery',
  whisper: 'whisper',
  loud: 'raise the volume',
  'build-intensity': 'build intensity across the wrapped text',
  'decrease-intensity': 'fade intensity across the wrapped text',
  'higher-pitch': 'raise the pitch',
  'lower-pitch': 'lower the pitch',
  slow: 'slow the pace',
  fast: 'speed up the pace',
  'sing-song': 'sing-song intonation',
  singing: 'sing the wrapped text',
  'laugh-speak': 'speak through laughter',
  emphasis: 'emphasise the wrapped text',
};

/**
 * Resolve bracket content to a known inline tag. Exact match first; otherwise
 * the first whitespace-separated token that is a known core word (qualifiers
 * like `soft` in `[soft laugh]` never block recognition). Returns null when
 * nothing matches — unknown content stays literal (closed vocabulary, D2).
 */
export function matchTealInline(content: string): TealInlineTag | null {
  const norm = content.trim().toLowerCase().replace(/\s+/g, ' ');
  if (norm.length === 0) return null;
  if (INLINE_SET.has(norm)) return norm as TealInlineTag;
  for (const token of norm.split(' ')) {
    if (INLINE_SET.has(token)) return token as TealInlineTag;
  }
  return null;
}

/** True when `name` is a known wrapping tag. */
export function isTealWrapping(name: string): name is TealWrappingTag {
  return WRAPPING_SET.has(name.toLowerCase());
}

/**
 * Remove all known TEAL markup from text — for plain-text surfaces
 * (previews, notifications). Unknown brackets/tags stay untouched.
 */
export function stripTeal(text: string): string {
  return text
    .replace(/\[([A-Za-z][A-Za-z\- ]{0,38})\]/g, (m, content: string) =>
      matchTealInline(content) === null ? m : '',
    )
    .replace(/<(\/?)([a-z-]+)>/g, (m, _slash: string, name: string) =>
      isTealWrapping(name) ? '' : m,
    )
    .replace(/ {2,}/g, ' ')
    .replace(/^ +| +$/gm, '');
}

function tagLines(): { inline: string; wrapping: string } {
  const inline = TEAL_INLINE_TAGS.map((t) => `- \`[${t}]\` — ${INLINE_DESCRIPTIONS[t]}`).join('\n');
  const wrapping = TEAL_WRAPPING_TAGS.map(
    (t) => `- \`<${t}>…</${t}>\` — ${WRAPPING_DESCRIPTIONS[t]}`,
  ).join('\n');
  return { inline, wrapping };
}

/** Band-1 TEAL segment — always on for chat and greeting (spec D1/D8). */
export const TEAL_EXPRESSION_PROMPT = (() => {
  const { inline, wrapping } = tagLines();
  return `## Expressive delivery

The assistant's replies carry vocal expression. Two kinds of markup are understood: in text they render as friendly formatting; when the assistant speaks aloud they shape the voice itself.

### Syntax

- Inline tags in square brackets trigger a discrete sound or pause: \`[laugh]\`, \`[breath]\`, \`[pause]\`.
- Inline tags may carry a short qualifier word in the same brackets: \`[soft laugh]\`, \`[exhale sharply]\`.
- Wrapping tags in angle brackets modulate delivery across the text they enclose: \`<whisper>a secret</whisper>\`. Wrapping tags may nest.

### Strict rules

The two lists below are the COMPLETE vocabulary. These rules are absolute:

1. Use ONLY tags from the lists. Never invent a tag — not in any language. If no listed tag fits, write plain text instead.
2. Tag names are always English, even when the conversation is in another language.
3. Inline tags use square brackets and stand alone: \`[laugh]\`. Wrapping tags use angle brackets and MUST enclose text with a matching closing tag: \`<laugh-speak>like this</laugh-speak>\`. Never write a wrapping tag's name in square brackets, and never emit a closing tag without its opener.
4. Never wrap a tag in other markup — \`*[pause]*\` is wrong; \`[pause]\` stands alone.

Wrong: \`Suddenly! [laugh-speak] There you stand *[pause]* with a leaf in your hair. [giggles]\`
Right: \`<loud>Suddenly!</loud> [chuckle] There you stand [pause] with a leaf in your hair.\`

### Inline tags

${inline}

### Wrapping tags

${wrapping}

### Dosage

Typically 0–2 markups per message — not every sentence. Use a wrapping tag for genuine emphasis, a pause to let a punchline land, a breath where one would naturally fall. Expression reads as natural when markup is rare.
When narrating an action between asterisks, do not additionally tag the same sound — \`*giggles softly*\` already carries the giggle.`;
})();
