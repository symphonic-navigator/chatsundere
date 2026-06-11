// SPDX-License-Identifier: AGPL-3.0-only
import type { Element, ElementContent, Root, Text } from 'hast';
import { preprocessForDisplay } from '../markdown/preprocess-for-display.js';
import {
  type SegmentationOpts,
  type SpeechSegment,
  emittedRangesForParagraph,
  paragraphRanges,
} from './segmentation.js';

/**
 * Options for {@link rehypeVoiceAnchor}.
 *
 * `segments` is the AUTHORITATIVE list the TTS side plays, computed on the RAW
 * block text. `processedSource` is the string ReactMarkdown actually parsed
 * (after the shared {@link preprocessForDisplay} chain). The two have different
 * offsets AND a different paragraph COUNT — `preprocessMath` rewrites a
 * multiline `\[…\]` into `\n\n$$\n…\n$$\n\n`, so one raw paragraph can become
 * three processed paragraphs. The plugin therefore never pairs by bare
 * processed-paragraph index; it maps each processed paragraph back to its RAW
 * paragraph (running the same {@link preprocessForDisplay} per raw slice to count
 * the split) and pairs TTS segments — keyed raw-side — against that raw index.
 */
export interface RehypeVoiceAnchorOptions {
  segments: SpeechSegment[];
  blockIndex: number;
  opts: SegmentationOpts;
  processedSource: string;
  /** The RAW block text the segments were computed on (spec I1 mapping). */
  rawSource: string;
}

/** A processed-source paragraph range, with its own index and its RAW index. */
interface ProcessedParagraph {
  /** Index into `paragraphRanges(processedSource)`. */
  index: number;
  /** Index of the RAW paragraph this processed paragraph descends from. */
  rawIndex: number;
  start: number;
  end: number;
}

/**
 * Map every processed paragraph back to the raw paragraph it descends from.
 *
 * For each raw paragraph slice we apply the SAME {@link preprocessForDisplay}
 * chain the renderer applies, then count how many processed paragraphs it
 * yields (`k_r`). Raw paragraph 0 contributing k_0 processed paragraphs, raw 1
 * contributing k_1, etc., gives `processedToRaw = [0×k_0, 1×k_1, …]`.
 *
 * Defensive: if the concatenated count differs from the actual processed
 * paragraph count (some preprocessing interaction we did not foresee), we fall
 * back to an identity-capped mapping (processed i → raw i) past the first
 * mismatch and mark `rawKByIndex` so those raw paragraphs degrade to
 * paragraph-level glow. We never crash and never mis-highlight.
 */
function buildRawMapping(
  rawSource: string,
  processedCount: number,
): { processedToRaw: number[]; rawK: Map<number, number> } {
  const rawParas = paragraphRanges(rawSource);
  const processedToRaw: number[] = [];
  const rawK = new Map<number, number>();

  rawParas.forEach(([s, e], rawIndex) => {
    const slice = rawSource.slice(s, e);
    const k = paragraphRanges(preprocessForDisplay(slice)).length;
    // A raw paragraph that strips to nothing processable still occupies its raw
    // index on the TTS side; record k (possibly 0) so degrade logic is exact.
    rawK.set(rawIndex, k);
    for (let i = 0; i < k; i++) processedToRaw.push(rawIndex);
  });

  if (processedToRaw.length !== processedCount) {
    // Fall back to identity (processed i → raw i) and force paragraph-level
    // degrade everywhere by marking every raw index with the -1 sentinel.
    const capped: number[] = [];
    const degraded = new Map<number, number>();
    for (let i = 0; i < processedCount; i++) {
      capped.push(i);
      degraded.set(i, -1);
    }
    return { processedToRaw: capped, rawK: degraded };
  }

  // Any raw paragraph that split (k > 1) must degrade to paragraph-level glow:
  // its emitted-range comparison would be against a fragment. Mark with -1.
  for (const [rawIndex, k] of rawK) if (k > 1) rawK.set(rawIndex, -1);
  return { processedToRaw, rawK };
}

/**
 * Rehype plugin that anchors playback-glow data onto the rendered tree:
 *
 *   - Every top-level element gets `data-voice-para="<paragraphIndex>"` (its
 *     paragraph index in the processed source). Elements without a position are
 *     skipped — they cannot be located in the source.
 *   - In sentence mode (and roleplay paragraph cuts), each emitted segment's
 *     range within the paragraph is wrapped in `<span data-voice-seg="<id>">`
 *     by splitting the paragraph's descendant text nodes at the range
 *     boundaries (text-node positions are in processed-source space here,
 *     because this plugin runs BEFORE `rehypeTeal`, which is what strips them).
 *   - In paragraph mode with a single emitted segment per paragraph, the id is
 *     placed on the paragraph element itself — no span wrapping.
 *   - If the processed-source emitted COUNT for a paragraph differs from the
 *     TTS-side count (rare TEAL length drift), OR the raw paragraph split into
 *     several processed paragraphs (multiline display math), the paragraph
 *     degrades to paragraph-level glow: `data-voice-para` stays (the RAW index),
 *     but no spans and no element-level `data-voice-seg` are written. The
 *     active-toggling effect falls back to matching `data-voice-para`, so the
 *     glow still advances; it just never mis-highlights a sentence.
 *
 * Must run after `rehype-katex` and before `rehype-teal`.
 */
export function rehypeVoiceAnchor(options: RehypeVoiceAnchorOptions) {
  const { segments, blockIndex, opts, processedSource, rawSource } = options;

  const processedRanges = paragraphRanges(processedSource);
  const { processedToRaw, rawK } = buildRawMapping(rawSource, processedRanges.length);

  const paragraphs: ProcessedParagraph[] = processedRanges.map(([start, end], index) => ({
    index,
    // Default to identity if (impossibly) unmapped — never out of bounds.
    rawIndex: processedToRaw[index] ?? index,
    start,
    end,
  }));

  // TTS segment ids grouped by RAW paragraph index, in emitted order. (Segments
  // carry their raw `paragraphIndex`; the mapping above bridges to processed.)
  const ttsByParagraph = new Map<number, string[]>();
  for (const s of segments) {
    const list = ttsByParagraph.get(s.paragraphIndex) ?? [];
    list.push(s.segmentId);
    ttsByParagraph.set(s.paragraphIndex, list);
  }

  // M4: the first EMITTING raw paragraph on the TTS side uses MIN_FIRST. A block
  // whose paragraph 0 is code-only (emits nothing) has its first segment in a
  // later paragraph — read it off the authoritative segment list, not index 0.
  const firstEmittingRaw = segments[0]?.paragraphIndex ?? -1;

  return (tree: Root): void => {
    for (const node of tree.children) {
      if (node.type !== 'element') continue;
      const offset = node.position?.start?.offset;
      if (offset === undefined) continue;

      const paragraph = paragraphs.find((p) => offset >= p.start && offset < p.end);
      if (paragraph === undefined) continue;

      // Tag with the RAW paragraph index. Multiple processed paragraphs from one
      // split raw paragraph all carry the same raw index, so paragraph-level
      // glow covers the whole logical paragraph (correct UX, spec I1).
      setData(node, 'dataVoicePara', `${blockIndex}:${paragraph.rawIndex}`);

      const ttsIds = ttsByParagraph.get(paragraph.rawIndex) ?? [];
      if (ttsIds.length === 0) continue; // paragraph emits nothing (e.g. a code fence)

      // A split (or defensively-flagged) raw paragraph degrades to paragraph
      // level: no span pairing, because the processed slice is only a fragment.
      if ((rawK.get(paragraph.rawIndex) ?? 1) !== 1) continue;

      const slice = processedSource.slice(paragraph.start, paragraph.end);
      const emitted = emittedRangesForParagraph(
        slice,
        opts,
        paragraph.rawIndex === firstEmittingRaw,
      );

      // Count mismatch → degrade this paragraph to paragraph-level glow only.
      if (emitted.length !== ttsIds.length) continue;

      // Single emitted segment in paragraph mode: tag the element, no spans.
      if (opts.mode === 'paragraph' && emitted.length === 1) {
        const id = ttsIds[0];
        if (id !== undefined) setData(node, 'dataVoiceSeg', id);
        continue;
      }

      // Otherwise wrap each emitted range in a span. Re-base paragraph-relative
      // ranges onto absolute processed-source offsets to match text positions.
      const wraps = emitted.map((e, i) => ({
        start: paragraph.start + e.range[0],
        end: paragraph.start + e.range[1],
        id: ttsIds[i] ?? '',
      }));
      wrapRanges(node, wraps);
    }
  };
}

interface Wrap {
  start: number;
  end: number;
  id: string;
}

/**
 * Wrap each `[start, end)` range (absolute processed-source offsets) in a
 * `<span data-voice-seg>` by splitting descendant text nodes at the boundaries.
 * Text nodes inside elements (e.g. an `<em>`) inherit the wrap of the range
 * their parent element falls inside; nodes without a position are wrapped only
 * if their enclosing element lies within a single range.
 */
function wrapRanges(paragraph: Element, wraps: Wrap[]): void {
  const wrapAt = (offset: number): Wrap | undefined =>
    wraps.find((w) => offset >= w.start && offset < w.end);

  const transform = (children: ElementContent[]): ElementContent[] => {
    const out: ElementContent[] = [];
    for (const child of children) {
      if (child.type === 'text') {
        out.push(...splitText(child, wraps));
        continue;
      }
      if (child.type === 'element') {
        const childOffset = child.position?.start?.offset;
        // Recurse so nested text nodes (e.g. inside <em>) split too.
        child.children = transform(child.children);
        // If the whole element sits inside one range and was not already split
        // internally, wrap it as a unit so glow covers inline formatting.
        const w = childOffset === undefined ? undefined : wrapAt(childOffset);
        if (w !== undefined && !containsVoiceSeg(child)) {
          out.push(spanWrap([child], w.id));
        } else {
          out.push(child);
        }
        continue;
      }
      out.push(child);
    }
    return out;
  };

  paragraph.children = transform(paragraph.children);
}

/** Split a positioned text node at the wrap boundaries; unpositioned nodes pass through. */
function splitText(node: Text, wraps: Wrap[]): ElementContent[] {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (start === undefined || end === undefined) return [node];

  const out: ElementContent[] = [];
  let cursor = start;
  while (cursor < end) {
    const wrap = wraps.find((w) => cursor >= w.start && cursor < w.end);
    if (wrap === undefined) {
      // Gap before the next wrap (or trailing tail) — emit as bare text.
      const nextStart = wraps
        .map((w) => w.start)
        .filter((s) => s > cursor)
        .reduce((a, b) => Math.min(a, b), end);
      const sliceEnd = Math.min(nextStart, end);
      out.push(textSlice(node, start, cursor, sliceEnd));
      cursor = sliceEnd;
      continue;
    }
    const sliceEnd = Math.min(wrap.end, end);
    out.push(spanWrap([textSlice(node, start, cursor, sliceEnd)], wrap.id));
    cursor = sliceEnd;
  }
  return out;
}

/** A `[from, to)` slice of `node`'s value, carrying through positions for further passes. */
function textSlice(node: Text, nodeStart: number, from: number, to: number): Text {
  return {
    type: 'text',
    value: node.value.slice(from - nodeStart, to - nodeStart),
    position: node.position,
  };
}

/** True if a subtree already carries a `data-voice-seg` somewhere. */
function containsVoiceSeg(node: ElementContent): boolean {
  if (node.type !== 'element') return false;
  if (node.properties?.dataVoiceSeg !== undefined) return true;
  return node.children.some((c) => containsVoiceSeg(c));
}

/** Wrap children in a `<span data-voice-seg="<id>">`. */
function spanWrap(children: ElementContent[], id: string): Element {
  return {
    type: 'element',
    tagName: 'span',
    properties: { dataVoiceSeg: id },
    children,
  };
}

/** Set a `data-*` property (hast uses the camelCased DOM-property key). */
function setData(element: Element, key: 'dataVoicePara' | 'dataVoiceSeg', value: string): void {
  element.properties = element.properties ?? {};
  element.properties[key] = value;
}
