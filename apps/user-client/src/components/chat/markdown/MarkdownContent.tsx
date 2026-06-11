// SPDX-License-Identifier: AGPL-3.0-only
import 'katex/dist/katex.min.css';
import { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { PluggableList } from 'unified';
import { useHighlighter } from '../../../lib/markdown/highlighter.js';
import { preprocessForDisplay } from '../../../lib/markdown/preprocess-for-display.js';
import { rehypeTeal } from '../../../lib/teal/rehype-teal.js';
import { rehypeVoiceAnchor } from '../../../lib/voice/rehype-voice-anchor.js';
import type { SegmentationOpts, SpeechSegment } from '../../../lib/voice/segmentation.js';
import { createMarkdownComponents } from './markdown-components.js';

const remarkPlugins: PluggableList = [remarkGfm, remarkMath];

/**
 * Voice-glow anchoring for this block. When present, the rehype chain gains the
 * voice-anchor plugin, which tags paragraphs/sentences with the data attributes
 * the active-state effect toggles `voice-glow-active` on. Absent for user
 * messages and any block with no speakable segments — the chain then matches
 * the pre-glow behaviour exactly.
 */
export interface VoiceGlow {
  segments: SpeechSegment[];
  blockIndex: number;
  opts: SegmentationOpts;
  /** The RAW block text the segments were computed on. The plugin maps raw
   *  paragraphs through the display preprocessing to pair glow anchors even
   *  when a raw paragraph splits into several processed ones (spec I1). */
  rawSource: string;
}

function MarkdownContentBase({ text, glow }: { text: string; glow?: VoiceGlow }): JSX.Element {
  const highlighter = useHighlighter();
  const components = useMemo(() => createMarkdownComponents(highlighter), [highlighter]);
  // The single shared display chain (TEAL then math). The glow plugin reuses
  // the SAME helper so its raw↔processed paragraph mapping can never drift.
  const processed = useMemo(() => preprocessForDisplay(text), [text]);
  // The voice-anchor plugin runs AFTER rehype-katex (so katex output keeps its
  // positions) and BEFORE rehypeTeal — rehypeTeal rebuilds text nodes without
  // positions, so anchoring must split them first. The plugin's output is a
  // pure function of [processed, glow]; it does not depend on the active
  // segment, so glow advance never re-parses the markdown.
  const rehypePlugins = useMemo<PluggableList>(() => {
    const chain: PluggableList = [[rehypeKatex, { throwOnError: false }]];
    if (glow !== undefined) {
      chain.push([
        rehypeVoiceAnchor,
        {
          segments: glow.segments,
          blockIndex: glow.blockIndex,
          opts: glow.opts,
          processedSource: processed,
          rawSource: glow.rawSource,
        },
      ]);
    }
    chain.push(rehypeTeal);
    return chain;
  }, [glow, processed]);
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {processed}
    </ReactMarkdown>
  );
}

/**
 * Memoised so that, during streaming, only the active bubble's MarkdownContent
 * re-parses on each token — historical messages (same `text`) skip the whole
 * remark / rehype / shiki pipeline. The `glow` object is memoised by its owner
 * per [text, mode, roleplay] so this stays a stable reference across
 * segment-advance renders (the active segment is NOT a memo dependency).
 */
export const MarkdownContent = memo(MarkdownContentBase);
