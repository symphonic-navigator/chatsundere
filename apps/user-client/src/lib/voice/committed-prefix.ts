// SPDX-License-Identifier: AGPL-3.0-only

import type { ContentBlock } from '../../boot/client-data-db.js';
import { type SegmentationOpts, type SpeechSegment, segmentMessage } from './segmentation.js';

/**
 * Merge adjacent same-type text/reasoning blocks exactly as the stream engine
 * does at finalisation (`stream-engine.appendText`/`appendReasoning`), so a
 * streaming buffer's block indices match the finalised message's. Pills are
 * never coalesced — their identity is a structural boundary.
 */
export function coalesceBlocks(blocks: ContentBlock[]): ContentBlock[] {
  const out: ContentBlock[] = [];
  for (const b of blocks) {
    const last = out[out.length - 1];
    if ((b.type === 'text' || b.type === 'reasoning') && last?.type === b.type) {
      out[out.length - 1] = { ...last, text: last.text + b.text };
    } else {
      out.push({ ...b });
    }
  }
  return out;
}

/**
 * Length of the stable prefix of `text`: everything up to the last paragraph
 * closed by a blank line (outside a code fence). The open trailing paragraph —
 * and any unterminated code fence — is withheld. `streamDone` commits all.
 *
 * Mirrors the fence-aware line scan of `segmentation.paragraphRanges`, but
 * reports the commit boundary rather than the ranges.
 */
export function committedTextLength(text: string, streamDone: boolean): number {
  if (streamDone) return text.length;
  let inFence = false;
  let fenceMarker = '';
  let paraStart: number | null = null;
  let fenceStart: number | null = null;
  let committedEnd = 0;
  let lineStart = 0;
  for (let i = 0; i <= text.length; i++) {
    const atEnd = i === text.length;
    if (!atEnd && text[i] !== '\n') continue;
    const line = text.slice(lineStart, i);
    const trimmed = line.trim();
    const fenceOpen = /^(```|~~~)/.exec(trimmed);
    if (inFence) {
      if (
        fenceOpen &&
        trimmed.startsWith(fenceMarker) &&
        trimmed.slice(fenceMarker.length).trim() === ''
      ) {
        inFence = false;
        fenceStart = null;
      }
    } else if (fenceOpen) {
      inFence = true;
      fenceMarker = fenceOpen[1] ?? '```';
      if (paraStart === null) paraStart = lineStart;
      fenceStart = lineStart;
    } else if (trimmed === '' && !atEnd) {
      if (paraStart !== null) {
        // Include the blank line's newline in the committed prefix so that
        // tail text starts cleanly at the first non-blank character of the
        // next paragraph. `i` is the position of this `\n`; `i + 1` is the
        // start of the next line. Cap at text.length for the end-of-string case.
        committedEnd = Math.min(i + 1, text.length);
        paraStart = null;
      }
    } else if (paraStart === null) {
      paraStart = lineStart;
    }
    lineStart = i + 1;
  }
  // An unterminated fence withholds everything from its opening line onwards.
  if (inFence && fenceStart !== null) committedEnd = Math.min(committedEnd, fenceStart);
  return committedEnd;
}

export interface StreamingSplit {
  /** Coalesced blocks whose text is fully committed — render as final markdown. */
  committedBlocks: ContentBlock[];
  /** The open trailing text (the still-growing paragraph) — render raw. */
  tailText: string;
}

/**
 * Split a streaming content buffer into its committed prefix (final-markdown
 * renderable, glow-anchorable) and the open tail (raw). With `streamDone`
 * everything is committed and the tail is empty.
 */
export function splitStreamingContent(blocks: ContentBlock[], streamDone: boolean): StreamingSplit {
  const coalesced = coalesceBlocks(blocks);
  if (streamDone || coalesced.length === 0) return { committedBlocks: coalesced, tailText: '' };
  const lastIdx = coalesced.length - 1;
  const last = coalesced[lastIdx];
  if (last === undefined || last.type !== 'text')
    return { committedBlocks: coalesced, tailText: '' };
  const len = committedTextLength(last.text, false);
  const committedText = last.text.slice(0, len);
  const tailText = last.text.slice(len);
  const committedBlocks = coalesced.slice(0, lastIdx);
  if (committedText.length > 0) committedBlocks.push({ type: 'text', text: committedText });
  return { committedBlocks, tailText };
}

/**
 * The speech segments for the committed prefix of a streaming message. Reuses
 * the existing `segmentMessage` on the committed blocks, so ids/order match the
 * finalised render's anchors by construction.
 */
export function committedSegments(
  blocks: ContentBlock[],
  streamDone: boolean,
  opts: SegmentationOpts,
): SpeechSegment[] {
  return segmentMessage(splitStreamingContent(blocks, streamDone).committedBlocks, opts);
}
