// SPDX-License-Identifier: AGPL-3.0-only
import { stripTeal } from '@chatsundere/llm-unified';
import type { ContentBlock } from '../../boot/client-data-db.js';
import { maskCodeRegions } from '../markdown/code-mask.js';

/**
 * Voice segmentation — the single source of truth for splitting an assistant
 * message into speakable {@link SpeechSegment}s, and for the structural
 * algorithms (`paragraphRanges`, `emittedRangesForParagraph`) that the
 * playback-glow plugin reuses to anchor highlights.
 *
 * ## (a) Input is RAW block text — deliberately TEAL-neutral
 *
 * Every function here operates on the *raw* `ContentBlock` text. We apply NO
 * visual preprocessing: not `preprocessTeal`, not `preprocessMath`. The
 * `spokenText` we produce is the canonical speech text — TEAL tags such as
 * `[laugh]` are retained verbatim, because the provider/TTS hook downstream is
 * the layer that decides whether to strip them or pass them through as
 * expression cues.
 *
 * ## (b) The glow plugin shares these algorithms, not offsets
 *
 * Glow anchoring is *structural*, not offset-based. The glow plugin never
 * compares `charRange` offsets against HAST positions (the renderer's
 * preprocessors shift offsets unpredictably). Instead it calls the exported
 * `paragraphRanges` on BOTH the raw and the preprocessed string (mapping each
 * processed paragraph back to its raw paragraph — `preprocessMath` can split one
 * raw paragraph into several processed ones), then re-runs the exported
 * `emittedRangesForParagraph` per processed paragraph to recover the same
 * per-paragraph segment sequence the TTS side emitted. It pairs against the raw
 * paragraph index; `ordinalInParagraph` lets it pair the nth emitted segment of
 * a paragraph with the nth wrapped span of that paragraph.
 *
 * IMPORTANT for glow plugin implementors: `ordinalInParagraph` counts ALL
 * emitted segments in the paragraph across BOTH voices in document order. The
 * glow plugin MUST pair by this combined ordering and MUST NOT filter by voice
 * before pairing — doing so would misalign narrator and dialogue spans.
 *
 * ## (c) Why TEAL-neutrality matters
 *
 * `preprocessTeal` converts `[laugh]` to the emoji `😄`; our emoji-stripper
 * would then delete it. Running the renderer chain before segmentation would
 * therefore silently destroy every speech-expression tag. Keeping the raw text
 * is what preserves TTS expression passthrough.
 *
 * Pure module: no I/O, no DOM.
 */

export interface SpeechSegment {
  /** `${blockIndex}:${ordinal}` — stable addressing, tap-to-replay-ready. */
  segmentId: string;
  spokenText: string;
  blockIndex: number;
  /** Nth blank-line-separated paragraph within the block (skipped/dropped ones still count). */
  paragraphIndex: number;
  /**
   * 0-based position among ALL emitted segments sharing this `paragraphIndex`,
   * counted across BOTH voices in document order. The glow plugin pairs by this
   * combined ordinal and MUST NOT filter by voice before pairing.
   */
  ordinalInParagraph: number;
  /** Range in the RAW block text. */
  charRange: [number, number];
  voice: 'dialogue' | 'narrator';
}

export interface SegmentationOpts {
  mode: 'paragraph' | 'sentence';
  roleplay: boolean;
}

/** Minimum spoken length before any segment has been emitted in the call. */
const MIN_FIRST = 20;
/** Minimum spoken length once at least one segment has been emitted. */
const MIN_REST = 30;

/** PUA sentinels emitted by `preprocessTeal`; stripped defensively. */
const TEAL_PUA = /[\u{E000}\u{E001}]/gu;

/**
 * Blank-line paragraph splitting over a code-masked copy of `source`, so
 * fenced blocks containing blank lines never split. Returns `[start, end)`
 * half-open ranges into the original `source` (trailing whitespace trimmed off
 * each range's end, leading whitespace off its start). Empty input yields `[]`.
 */
export function paragraphRanges(source: string): Array<[number, number]> {
  if (source.length === 0) return [];
  // maskCodeRegions is NOT length-preserving, so we cannot split on the masked
  // copy and map offsets back cheaply. Instead we scan the RAW source
  // line-by-line with our own fence awareness — equivalent to
  // masking-then-splitting, but it keeps raw offsets exact. A blank line
  // outside a fence ends the current paragraph; blank lines inside a fence are
  // not boundaries.
  const ranges: Array<[number, number]> = [];
  let inFence = false;
  let fenceMarker = '';
  let paraStart: number | null = null;
  let lineStart = 0;

  const pushPara = (end: number): void => {
    if (paraStart === null) return;
    const [s, e] = trimRange(source, paraStart, end);
    if (e > s) ranges.push([s, e]);
    paraStart = null;
  };

  for (let i = 0; i <= source.length; i++) {
    const atEnd = i === source.length;
    if (!atEnd && source[i] !== '\n') continue;
    const line = source.slice(lineStart, i);
    const trimmed = line.trim();
    const fenceOpen = /^(```|~~~)/.exec(trimmed);

    if (inFence) {
      // CommonMark §4.5: a closing fence is ONLY the marker, optionally followed
      // by whitespace — a line like "```yaml" inside an open fence is content.
      if (
        fenceOpen &&
        trimmed.startsWith(fenceMarker) &&
        trimmed.slice(fenceMarker.length).trim() === ''
      )
        inFence = false;
      // inside a fence: blank lines are never boundaries
    } else if (fenceOpen) {
      inFence = true;
      fenceMarker = fenceOpen[1] ?? '```';
      if (paraStart === null) paraStart = lineStart;
    } else if (trimmed === '') {
      pushPara(lineStart);
    } else if (paraStart === null) {
      paraStart = lineStart;
    }

    lineStart = i + 1;
  }
  pushPara(source.length);
  return ranges;
}

/** Trim leading/trailing whitespace off a `[start, end)` range. */
function trimRange(source: string, start: number, end: number): [number, number] {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(source[s] ?? '')) s++;
  while (e > s && /\s/.test(source[e - 1] ?? '')) e--;
  return [s, e];
}

/**
 * Intl.Segmenter sentence boundaries over `paragraph`, WITHOUT the merge rule
 * (raw boundaries). Returns `[start, end)` ranges into `paragraph`. Internal to
 * this module — {@link emitSentences} consumes it; the glow side reaches the same
 * spans through {@link emittedRangesForParagraph}, never this directly.
 */
function sentenceRanges(paragraph: string): Array<[number, number]> {
  if (paragraph.length === 0) return [];
  const ranges: Array<[number, number]> = [];
  for (const { segment, index } of SENTENCE_SEGMENTER.segment(paragraph)) {
    if (segment.length === 0) continue;
    ranges.push([index, index + segment.length]);
  }
  return ranges;
}

interface VoiceRange {
  start: number;
  end: number;
  voice: 'dialogue' | 'narrator';
}

/**
 * Module-level sentence segmenter. `Intl.Segmenter` instances are reentrant
 * (they hold no per-call state), so one instance shared across calls is safe
 * and avoids repeated construction overhead.
 */
const SENTENCE_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'sentence' });

/** `(?<!\*)\*(?!\*)…\*(?!\*)` — a single-asterisk span, not bold, not nested. */
const SINGLE_ASTERISK = /(?<!\*)\*(?!\*)([^*\n]+)\*(?!\*)/g;

/**
 * Within a paragraph `[start, end)`, split into ordered narrator/dialogue
 * sub-ranges when `roleplay` is on. Narrator ranges are the inner text of
 * single-asterisk spans; everything else is dialogue. Matches inside masked
 * code regions never fire. Whitespace-only sub-ranges are not emitted. When
 * `roleplay` is off, the whole paragraph is one dialogue range.
 */
function voiceRanges(
  source: string,
  start: number,
  end: number,
  roleplay: boolean,
  isCode: (offset: number) => boolean,
): VoiceRange[] {
  if (!roleplay) return [{ start, end, voice: 'dialogue' }];

  const slice = source.slice(start, end);
  const out: VoiceRange[] = [];
  let cursor = start;

  const pushDialogue = (from: number, to: number): void => {
    if (to <= from) return;
    if (source.slice(from, to).trim() === '') return;
    out.push({ start: from, end: to, voice: 'dialogue' });
  };

  SINGLE_ASTERISK.lastIndex = 0;
  for (let m = SINGLE_ASTERISK.exec(slice); m !== null; m = SINGLE_ASTERISK.exec(slice)) {
    const openAt = start + m.index;
    if (isCode(openAt)) continue;
    const inner = m[1] ?? '';
    const innerStart = openAt + 1;
    const innerEnd = innerStart + inner.length;
    pushDialogue(cursor, openAt);
    if (source.slice(innerStart, innerEnd).trim() !== '') {
      out.push({ start: innerStart, end: innerEnd, voice: 'narrator' });
    }
    cursor = innerEnd + 1; // skip the closing '*'
  }
  pushDialogue(cursor, end);
  return out;
}

interface StripOpts {
  /** Strip single-`*` emphasis pairs. False inside roleplay (the cut consumed them). */
  stripSingleAsteriskEmphasis: boolean;
}

/**
 * Reduce a raw Markdown slice to plain spoken text. Order matters; see inline
 * comments. TEAL bracket tags such as `[laugh]` are deliberately preserved
 * (canonical speech text). Returns the collapsed, trimmed result.
 */
function stripForSpeech(text: string, { stripSingleAsteriskEmphasis }: StripOpts): string {
  let out = text;

  // 1. Remove code regions entirely.
  out = maskCodeRegions(out).masked.replace(/\0CODE\d+\0/g, '');
  // 2. Defensive: drop any TEAL PUA sentinels (raw LLM text should not carry them).
  out = out.replace(TEAL_PUA, '');
  // 3. Images before links (image syntax is a superset of link syntax).
  out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  // 4. Links → label. Bracket spans without a following `(` (e.g. `[laugh]`) stay.
  out = out.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  // 5. Headings: leading `#` run.
  out = out.replace(/^[ \t]*#{1,6}[ \t]+/gm, '');
  // 6. Blockquote markers.
  out = out.replace(/^[ \t]*>[ \t]?/gm, '');
  // 7. List markers.
  out = out.replace(/^[ \t]*(?:[-*+]|\d+\.)[ \t]+/gm, '');
  // 8. Bold / italic. `**`/`__` always; `_`; single `*` only when asked.
  // Known limitation: nested emphasis such as `**bold *inner* bold**` is not
  // unwrapped recursively — the non-recursive strip leaves markers in spokenText
  // for that rare case.
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1');
  out = out.replace(/__([^_]+)__/g, '$1');
  out = out.replace(/(?<![A-Za-z0-9])_([^_\n]+)_(?![A-Za-z0-9])/g, '$1');
  if (stripSingleAsteriskEmphasis) {
    out = out.replace(/(?<!\*)\*(?!\*)([^*\n]+)\*(?!\*)/g, '$1');
  }
  // 9. Bare URLs.
  out = out.replace(/\bhttps?:\/\/\S+/g, '');
  // 10. Emoji: pictographics, ZWJ sequences, variation selectors, skin tones.
  // The modifier is an alternation (not a character class) because the
  // skin-tone modifiers are themselves Extended_Pictographic, which Biome's
  // noMisleadingCharacterClass forbids inside a class.
  const EMOJI_MOD = '(?:\\u{FE0F}|[\\u{1F3FB}-\\u{1F3FF}])?';
  const emoji = new RegExp(
    `\\p{Extended_Pictographic}${EMOJI_MOD}(?:\\u{200D}\\p{Extended_Pictographic}${EMOJI_MOD})*`,
    'gu',
  );
  out = out.replace(emoji, '');
  // 11. Collapse whitespace and trim.
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

/**
 * An emitted segment within one paragraph slice, expressed relative to that
 * slice (offsets into `paragraphSource`). This is the shared primitive that
 * both segmentation and the glow plugin run on: there is exactly one algorithm
 * for "which sub-ranges of a paragraph become spoken segments", so the two
 * sides can never drift on the merge/voice-cut decisions.
 */
export interface EmittedRange {
  /** `[start, end)` offsets into the paragraph slice passed in. */
  range: [number, number];
  /** The canonical spoken text of this segment (already stripped/collapsed). */
  spokenText: string;
  voice: 'dialogue' | 'narrator';
}

/**
 * The single source of truth for splitting ONE paragraph into emitted speech
 * segments. Applies the voice cut (roleplay asterisk spans → narrator), the
 * sentence split, and the min-length merge-forward rule — exactly as
 * {@link segmentBlock} does, because `segmentBlock` is now built on top of this
 * helper. Offsets in the result are relative to `paragraphSource`.
 *
 * `firstInBlock` reproduces `segmentBlock`'s 20-vs-30 minimum: only the very
 * first emitted segment of the whole block uses the shorter `MIN_FIRST`
 * threshold; every subsequent segment uses `MIN_REST`. The glow side, which
 * runs this per processed-paragraph slice, passes `firstInBlock = true` only
 * for paragraph 0 (the same paragraph `segmentBlock` reaches first). Rare TEAL
 * length differences that shift a merge decision change only the COUNT for a
 * paragraph, which the glow plugin handles by degrading that paragraph to
 * paragraph-level highlighting — never by mis-highlighting a different one.
 */
export function emittedRangesForParagraph(
  paragraphSource: string,
  opts: SegmentationOpts,
  firstInBlock: boolean,
): EmittedRange[] {
  const codeSpans = findCodeSpans(paragraphSource);
  const isCode = (offset: number): boolean => codeSpans.some(([s, e]) => offset >= s && offset < e);

  const stripSingle = !opts.roleplay;
  const vRanges = voiceRanges(paragraphSource, 0, paragraphSource.length, opts.roleplay, isCode);

  const out: EmittedRange[] = [];
  const collect = (
    range: [number, number],
    spokenText: string,
    voice: VoiceRange['voice'],
  ): void => {
    // Speakability gate: a segment without a single letter or digit (thematic
    // breaks like `---`, stray emphasis rubble, bare ellipses) must never reach
    // synthesis — providers reject such input (device finding 2026-06-11).
    // Judged on the TEAL-stripped text: a tag-only segment such as `[laugh]`
    // would survive a raw test but reach a strip-hook provider as EMPTY input.
    // (A lone tag is genuinely speakable for a future passthrough provider —
    // revisit at xAI TTS onboarding; logged in follow-ups.) Living here keeps
    // the TTS side and the glow side identical by construction.
    if (!/[\p{L}\p{N}]/u.test(stripTeal(spokenText))) return;
    out.push({ range, spokenText, voice });
  };

  for (const v of vRanges) {
    if (opts.mode === 'paragraph') {
      const spoken = stripForSpeech(paragraphSource.slice(v.start, v.end), {
        stripSingleAsteriskEmphasis: stripSingle,
      });
      collect([v.start, v.end], spoken, v.voice);
      continue;
    }
    // Sentence mode: split this voice range into sentences, with merge-forward.
    emitSentences(paragraphSource, v, stripSingle, firstInBlock && out.length === 0, collect);
  }

  return out;
}

/**
 * Segment one block of raw text into speakable segments. `blockIndex` is the
 * index of this block among the message's content blocks (so `segmentId`s are
 * stable across a message). See the module JSDoc for the TEAL-neutrality and
 * glow-pairing contract.
 *
 * Built on {@link emittedRangesForParagraph} so the per-paragraph emission
 * algorithm has exactly one implementation shared with the glow plugin. This
 * function only stitches paragraph-relative ranges back to block offsets and
 * assigns the stable ids/ordinals.
 */
export function segmentBlock(
  source: string,
  blockIndex: number,
  opts: SegmentationOpts,
): SpeechSegment[] {
  const paragraphs = paragraphRanges(source);
  const segments: SpeechSegment[] = [];
  let emittedOrdinal = 0;
  const ordinalByParagraph = new Map<number, number>();

  const nextOrdinalInParagraph = (paragraphIndex: number): number => {
    const n = ordinalByParagraph.get(paragraphIndex) ?? 0;
    ordinalByParagraph.set(paragraphIndex, n + 1);
    return n;
  };

  paragraphs.forEach(([pStart, pEnd], paragraphIndex) => {
    const slice = source.slice(pStart, pEnd);
    // `firstInBlock` is true until the block has emitted its first segment; this
    // reproduces the previous MIN_FIRST-once-per-block behaviour exactly.
    const emitted = emittedRangesForParagraph(slice, opts, segments.length === 0);
    for (const e of emitted) {
      segments.push({
        segmentId: `${blockIndex}:${emittedOrdinal}`,
        spokenText: e.spokenText,
        blockIndex,
        paragraphIndex,
        ordinalInParagraph: nextOrdinalInParagraph(paragraphIndex),
        // Re-base the paragraph-relative range onto the block.
        charRange: [pStart + e.range[0], pStart + e.range[1]],
        voice: e.voice,
      });
      emittedOrdinal++;
    }
  });

  return segments;
}

/**
 * Split a voice range into sentences and emit them with the merge-forward rule:
 * a sentence shorter than the running minimum merges with the FOLLOWING
 * sentence (range union, spokenText re-stripped from the merged slice); a
 * trailing short sentence merges backward. `collect` receives ranges in the
 * same offset space as `source` (the paragraph slice).
 */
function emitSentences(
  source: string,
  v: VoiceRange,
  stripSingle: boolean,
  noneEmittedYet: boolean,
  collect: (range: [number, number], spokenText: string, voice: VoiceRange['voice']) => void,
): void {
  const slice = source.slice(v.start, v.end);
  const rawRanges = sentenceRanges(slice).map(([s, e]): [number, number] => [
    v.start + s,
    v.start + e,
  ]);

  // Build merged-forward groups. `firstEmitted` tracks whether ANY segment has
  // been emitted in the whole call yet (drives the 20 vs 30 minimum).
  const strip = (s: number, e: number): string =>
    stripForSpeech(source.slice(s, e), { stripSingleAsteriskEmphasis: stripSingle });

  const groups: Array<[number, number]> = [];
  let pendingStart: number | null = null;
  let anyEmittedBefore = !noneEmittedYet;

  for (const [rangeStart, e] of rawRanges) {
    const start: number = pendingStart ?? rangeStart;
    const text = strip(start, e);
    if (text.length === 0) {
      // Empty so far; keep accumulating to absorb into the next sentence.
      pendingStart = start;
      continue;
    }
    const min = anyEmittedBefore || groups.length > 0 ? MIN_REST : MIN_FIRST;
    if (text.length < min) {
      // Too short — merge forward by carrying the start into the next sentence.
      pendingStart = start;
      continue;
    }
    groups.push([start, e]);
    pendingStart = null;
    anyEmittedBefore = true;
  }
  // Trailing leftover (short final sentence) merges backward into the last group.
  if (pendingStart !== null) {
    const last = groups[groups.length - 1];
    if (last) {
      last[1] = v.end;
    } else {
      // No prior group: the whole range is one (possibly short) group.
      groups.push([pendingStart, v.end]);
    }
  }

  for (const [s, e] of groups) {
    const spoken = strip(s, e);
    if (spoken.length > 0) collect([s, e], spoken, v.voice);
  }
}

/**
 * Find `[start, end)` raw-offset ranges of fenced and inline code regions.
 *
 * Fenced blocks are detected with a line-based scan applying the same
 * CommonMark §4.5 close rule as `paragraphRanges`: a closing fence line must
 * consist of ONLY the opening marker (optionally followed by whitespace), so a
 * line like "```yaml" inside an open fence is content, not a closer.
 */
function findCodeSpans(source: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];

  // --- Fenced blocks (line-based) ---
  let inFence = false;
  let fenceMarker = '';
  let fenceStart = 0;
  let lineStart = 0;

  for (let i = 0; i <= source.length; i++) {
    const atEnd = i === source.length;
    if (!atEnd && source[i] !== '\n') continue;
    const trimmed = source.slice(lineStart, i).trim();
    const fenceOpen = /^(```|~~~)/.exec(trimmed);

    if (inFence) {
      // Closing fence: only the marker, optionally followed by whitespace.
      if (
        fenceOpen &&
        trimmed.startsWith(fenceMarker) &&
        trimmed.slice(fenceMarker.length).trim() === ''
      ) {
        spans.push([fenceStart, i]); // include up to (but not past) the newline
        inFence = false;
      }
    } else if (fenceOpen) {
      inFence = true;
      fenceMarker = fenceOpen[1] ?? '```';
      fenceStart = lineStart;
    }

    lineStart = i + 1;
  }
  // Unclosed fence: treat the rest as a code span.
  if (inFence) {
    spans.push([fenceStart, source.length]);
  }

  // --- Inline code (backtick runs) ---
  const inline = /(`+)([\s\S]*?)\1/g;
  for (let m = inline.exec(source); m !== null; m = inline.exec(source)) {
    const start = m.index;
    const end = start + m[0].length;
    // Skip inline matches that fall inside an already-recorded fence.
    if (spans.some(([s, e]) => start >= s && start < e)) continue;
    spans.push([start, end]);
  }
  return spans;
}

/**
 * Segment a full message. Each `type === 'text'` content block is segmented on
 * its RAW text (see module JSDoc), keyed by its index among the content blocks
 * so `segmentId`s stay stable. Non-text blocks contribute no segments but their
 * index is preserved (it is simply skipped).
 */
export function segmentMessage(blocks: ContentBlock[], opts: SegmentationOpts): SpeechSegment[] {
  const out: SpeechSegment[] = [];
  blocks.forEach((block, index) => {
    if (block.type !== 'text') return;
    out.push(...segmentBlock(block.text, index, opts));
  });
  return out;
}
