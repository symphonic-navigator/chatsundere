// SPDX-License-Identifier: LGPL-3.0-only

/**
 * TEAL v2 — Transformative Expression and Anthropomorphisation Layer.
 *
 * The canonical voice expression language: a closed, versioned vocabulary
 * (v1 = xAI voice-tag snapshot, 2026-06-11; v2 adds moods and sounds) that
 * every consumer translates from — the chat display renders it as friendly formatting, and future TTS
 * translators map it onto each backend's capabilities. Extension is
 * deliberate curation (a new version), never heuristics. See the design spec
 * `superpowers/specs/2026-06-11-teal-voice-expression-language-design.md`.
 */

/** The TEAL vocabulary version. */
export const TEAL_VERSION = 2;

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
  'clear-throat',
  'gulp',
  'yawn',
  'sniffle',
  'groan',
  'scoff',
] as const;
export type TealInlineTag = (typeof TEAL_INLINE_TAGS)[number];

/** Mood tags — inline tone-setting tags, written `[mood]`; level 2. */
export const TEAL_MOOD_TAGS = [
  'excited',
  'playful',
  'amazed',
  'proud',
  'startled',
  'annoyed',
  'angry',
  'sarcastic',
  'bitter',
  'nervous',
  'anxious',
  'scared',
  'hesitant',
  'confused',
  'tired',
  'bored',
  'sad',
  'let-down',
  'curious',
  'thoughtful',
  'content',
  'peaceful',
  'mischievous',
  'affectionate',
  'teasing',
  'flirtatious',
  'seductive',
  'shy',
  'pouting',
] as const;
export type TealMoodTag = (typeof TEAL_MOOD_TAGS)[number];

/** Expression level: 0 = none, 1 = v1 vocabulary, 2 = v2 vocabulary. */
export type TealLevel = 0 | 1 | 2;

/** A resolved bracket: a sound or a mood, with the level it belongs to. */
export interface TealInlineMatch {
  kind: 'sound' | 'mood';
  tag: TealInlineTag | TealMoodTag;
  level: 1 | 2;
}

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
const MOOD_SET: ReadonlySet<string> = new Set(TEAL_MOOD_TAGS);
const V2_SOUNDS: ReadonlySet<string> = new Set([
  'clear-throat',
  'gulp',
  'yawn',
  'sniffle',
  'groan',
  'scoff',
]);
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
  'clear-throat': 'a throat clear',
  gulp: 'a nervous gulp',
  yawn: 'a yawn',
  sniffle: 'a sniffle',
  groan: 'a groan',
  scoff: 'a scoff',
};

const MOOD_DESCRIPTIONS: Record<TealMoodTag, string> = {
  excited: 'high energy, eager',
  playful: 'light and cheeky',
  amazed: 'awed, impressed',
  proud: 'proud, pleased with oneself',
  startled: 'caught off guard',
  annoyed: 'irritated',
  angry: 'openly angry',
  sarcastic: 'ironic, meaning the opposite',
  bitter: 'resentful',
  nervous: 'jittery, uneasy',
  anxious: 'worried, tense',
  scared: 'frightened',
  hesitant: 'unsure, holding back',
  confused: 'puzzled',
  tired: 'weary, low on energy',
  bored: 'flat, uninterested',
  sad: 'sorrowful',
  'let-down': 'disappointed',
  curious: 'interested, inquisitive',
  thoughtful: 'reflective, considered',
  content: 'quietly satisfied',
  peaceful: 'calm, serene',
  mischievous: 'up to something',
  affectionate: 'warm and tender',
  teasing: 'gently teasing',
  flirtatious: 'flirty',
  seductive: 'low, alluring',
  shy: 'bashful',
  pouting: 'sulky, mock-offended',
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

function normBracket(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, ' ');
}

function soundMatch(tag: TealInlineTag): TealInlineMatch {
  return { kind: 'sound', tag, level: V2_SOUNDS.has(tag) ? 2 : 1 };
}

/**
 * Resolve bracket content to a sound or mood (spec §4.3): exact match, then
 * the first sound core word (a sound beats a mood), then a mood only when the
 * bracket has at most two tokens ending in the mood word. Null stays literal.
 */
export function resolveTealBracket(content: string): TealInlineMatch | null {
  const norm = normBracket(content);
  if (norm.length === 0) return null;
  if (INLINE_SET.has(norm)) return soundMatch(norm as TealInlineTag);
  if (MOOD_SET.has(norm)) return { kind: 'mood', tag: norm as TealMoodTag, level: 2 };
  const tokens = norm.split(' ');
  for (const token of tokens) {
    if (INLINE_SET.has(token)) return soundMatch(token as TealInlineTag);
  }
  const last = tokens[tokens.length - 1];
  if (tokens.length <= 2 && last !== undefined && MOOD_SET.has(last)) {
    return { kind: 'mood', tag: last as TealMoodTag, level: 2 };
  }
  return null;
}

/**
 * Resolve bracket content to a known inline sound. Exact match first;
 * otherwise the first token that is a known core word. Moods are not sounds
 * and return null here; use `resolveTealBracket` for those.
 */
export function matchTealInline(content: string): TealInlineTag | null {
  const norm = normBracket(content);
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

/** The `[...]` bracket candidate TEAL recognises; content is group 1. Global flag. */
export const TEAL_BRACKET_RX = /\[([A-Za-z][A-Za-z\- ]{0,38})\]/g;

/**
 * Remove known TEAL markup above `maxLevel` from text (0 removes all, 1 keeps
 * the v1 vocabulary, 2 keeps everything). Unknown brackets/tags stay untouched.
 */
export function stripTeal(text: string, maxLevel: TealLevel = 0): string {
  return text
    .replace(TEAL_BRACKET_RX, (m, content: string) => {
      const r = resolveTealBracket(content);
      return r === null || r.level <= maxLevel ? m : '';
    })
    .replace(/<(\/?)([a-z-]+)>/g, (m, _slash: string, name: string) =>
      isTealWrapping(name) && maxLevel < 1 ? '' : m,
    )
    .replace(/ {2,}/g, ' ')
    .replace(/^ +| +$/gm, '');
}

function tagLines(): { inline: string; wrapping: string; mood: string } {
  const inline = TEAL_INLINE_TAGS.map((t) => `- \`[${t}]\` — ${INLINE_DESCRIPTIONS[t]}`).join('\n');
  const wrapping = TEAL_WRAPPING_TAGS.map(
    (t) => `- \`<${t}>…</${t}>\` — ${WRAPPING_DESCRIPTIONS[t]}`,
  ).join('\n');
  const mood = TEAL_MOOD_TAGS.map((t) => `- \`[${t}]\` — ${MOOD_DESCRIPTIONS[t]}`).join('\n');
  return { inline, wrapping, mood };
}

/** Band-1 TEAL segment — always on for chat and greeting (spec D1/D8). */
export const TEAL_EXPRESSION_PROMPT = (() => {
  const { inline, wrapping, mood } = tagLines();
  return `## Expressive delivery

The assistant's replies carry vocal expression. Three kinds of markup are understood: in text they render as friendly formatting; when the assistant speaks aloud they shape the voice itself.

### Syntax

- Inline tags in square brackets trigger a discrete sound or pause: \`[laugh]\`, \`[breath]\`, \`[pause]\`.
- Inline tags may carry a short qualifier word in the same brackets: \`[soft laugh]\`, \`[exhale sharply]\`.
- Wrapping tags in angle brackets modulate delivery across the text they enclose: \`<whisper>a secret</whisper>\`. Wrapping tags may nest.
- Mood tags in square brackets set the tone of the text that follows: \`[sarcastic]\`. See the Mood section.

### Strict rules

The lists below are the COMPLETE vocabulary. These rules are absolute:

1. Use ONLY tags from the lists. Never invent a tag — not in any language. If no listed tag fits, write plain text instead.
2. Tag names are always English, even when the conversation is in another language.
3. Inline tags use square brackets and stand alone: \`[laugh]\`. Wrapping tags use angle brackets and MUST enclose text with a matching closing tag: \`<laugh-speak>like this</laugh-speak>\`. Never write a wrapping tag's name in square brackets, and never emit a closing tag without its opener.
4. Never wrap a tag in other markup — \`*[pause]*\` is wrong; \`[pause]\` stands alone.

Wrong: \`Suddenly! [laugh-speak] There you stand *[pause]* with a leaf in your hair. [giggles]\`
Right: \`<loud>Suddenly!</loud> [chuckle] There you stand [pause] with a leaf in your hair.\`

### Inline tags

${inline}

### Mood

A mood tag in square brackets sets the tone of the text that follows, until the next mood tag or the end of the paragraph. A new paragraph starts neutral. A mood tag stands alone in its brackets (a qualifier word such as \`[slightly nervous]\` is fine) and is never combined with a sound in one bracket.

${mood}

Most paragraphs carry no mood at all: tone usually follows from the words. In a typical message use one mood or none. Reach for one only where the words alone would be misread (irony, sarcasm, tenderness on neutral wording) or where the mood shifts. Behave naturally and never dramatise.

A mood is never a substitute for a sound or a wrapping tag. A mood colours the tone; a wrapping tag changes the delivery itself. When something is whispered, said louder, sung or stressed, still wrap it in \`<whisper>\`, \`<loud>\`, \`<singing>\` or \`<emphasis>\` — with or without a mood. A laugh is still \`[laugh]\`.

### Wrapping tags

${wrapping}

### Dosage

Typically 0–2 markups per message, not every sentence; this budget covers sounds and wrapping tags only. Mood tags do NOT count toward it; they are governed by the dosage in the Mood section. Use a wrapping tag for genuine emphasis, a pause to let a punchline land, a breath where one would naturally fall. Expression reads as natural when markup is rare.
When narrating an action between asterisks, do not additionally tag the same sound — \`*giggles softly*\` already carries the giggle.`;
})();
