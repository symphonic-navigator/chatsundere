// SPDX-License-Identifier: AGPL-3.0-only
import type { Element, Root, RootContent } from 'hast';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';
import { preprocessMath } from '../../../src/lib/markdown/preprocess-math.js';
import { preprocessTeal } from '../../../src/lib/teal/preprocess-teal.js';
import { rehypeTeal } from '../../../src/lib/teal/rehype-teal.js';
import { rehypeVoiceAnchor } from '../../../src/lib/voice/rehype-voice-anchor.js';
import {
  type SegmentationOpts,
  type SpeechSegment,
  segmentBlock,
} from '../../../src/lib/voice/segmentation.js';

/**
 * Run the SAME remark/rehype chain MarkdownContent uses, with the voice-anchor
 * plugin spliced in (after katex, before teal — exactly the production seam).
 * `segments` are computed on the RAW block text, mirroring the hook; the plugin
 * runs on the PROCESSED string. This is the real pairing path under test.
 */
async function runPipeline(
  raw: string,
  opts: SegmentationOpts,
  // Optional override of the segment list, to fabricate a count mismatch.
  segmentsOverride?: SpeechSegment[],
  blockIndex = 0,
): Promise<{ tree: Root; segments: SpeechSegment[] }> {
  const processed = preprocessMath(preprocessTeal(raw));
  const segments = segmentsOverride ?? segmentBlock(raw, blockIndex, opts);
  const proc = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype)
    .use(rehypeKatex)
    .use(rehypeVoiceAnchor, {
      segments,
      blockIndex,
      opts,
      processedSource: processed,
      rawSource: raw,
    })
    .use(rehypeTeal);
  const tree = (await proc.run(proc.parse(processed))) as Root;
  return { tree, segments };
}

/** Top-level element children of the tree (skips stray whitespace text nodes). */
function topElements(tree: Root): Element[] {
  return tree.children.filter((n): n is Element => n.type === 'element');
}

/** Collect the textual content of a HAST subtree. */
function textOf(node: RootContent | Element): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'element') return node.children.map((c) => textOf(c)).join('');
  return '';
}

/** Collect every `data-voice-para` value across the whole tree, in document order. */
function voiceParas(tree: Root): string[] {
  const out: string[] = [];
  const walk = (node: RootContent | Element): void => {
    if (node.type !== 'element') return;
    const para = node.properties?.dataVoicePara;
    if (typeof para === 'string') out.push(para);
    for (const c of node.children) walk(c);
  };
  for (const c of tree.children) walk(c);
  return out;
}

/** Find every element carrying a `data-voice-seg` and return [id, text]. */
function voiceSegs(
  node: RootContent | Element,
  out: Array<[string, string]> = [],
): Array<[string, string]> {
  if (node.type === 'element') {
    const seg = node.properties?.dataVoiceSeg;
    if (typeof seg === 'string') out.push([seg, textOf(node)]);
    for (const c of node.children) voiceSegs(c, out);
  }
  return out;
}

describe('rehypeVoiceAnchor — paragraph mode', () => {
  const opts: SegmentationOpts = { mode: 'paragraph', roleplay: false };

  it('tags both paragraphs with data-voice-para and data-voice-seg ids 0:0 / 0:1', async () => {
    const { tree } = await runPipeline(
      'First paragraph here, long enough.\n\nSecond paragraph here, also long enough.',
      opts,
    );
    const els = topElements(tree);
    expect(els).toHaveLength(2);
    // data-voice-para is block-qualified: "<blockIndex>:<paragraphIndex>".
    // blockIndex=0 (the default in runPipeline) → "0:0" and "0:1".
    expect(els[0]?.properties?.dataVoicePara).toBe('0:0');
    expect(els[1]?.properties?.dataVoicePara).toBe('0:1');
    // Single emitted segment per paragraph → id sits on the <p> itself, no span.
    expect(els[0]?.properties?.dataVoiceSeg).toBe('0:0');
    expect(els[1]?.properties?.dataVoiceSeg).toBe('0:1');
    expect(els[0]?.tagName).toBe('p');
    // No span wrapping in single-segment paragraph mode.
    expect(voiceSegs(els[0] as Element)).toEqual([['0:0', 'First paragraph here, long enough.']]);
  });
});

describe('rehypeVoiceAnchor — sentence mode', () => {
  const opts: SegmentationOpts = { mode: 'sentence', roleplay: false };

  it('wraps the sentences in spans with correct ids, text unchanged', async () => {
    const raw =
      'This is the first reasonably long sentence here, standing alone. ' +
      'This is the second reasonably long sentence here, also alone.';
    const { tree, segments } = await runPipeline(raw, opts);
    expect(segments).toHaveLength(2);
    const els = topElements(tree);
    expect(els).toHaveLength(1);
    expect(els[0]?.properties?.dataVoicePara).toBe('0:0');
    const spans = voiceSegs(els[0] as Element);
    expect(spans.map(([id]) => id)).toEqual(['0:0', '0:1']);
    // The concatenated rendered text is unchanged from the source paragraph.
    expect(textOf(els[0] as Element)).toBe(raw);
    expect(spans[0]?.[1]?.trim()).toBe(
      'This is the first reasonably long sentence here, standing alone.',
    );
  });
});

describe('rehypeVoiceAnchor — TEAL invariant', () => {
  const opts: SegmentationOpts = { mode: 'sentence', roleplay: false };

  it('degrades a TEAL-bearing paragraph to paragraph-level glow (sentence pairing is unsound across preprocessing)', async () => {
    // `[laugh]` is present in the RAW text (→ emoji in processed). The two
    // sides then segment DIFFERENT strings: effective lengths shift the
    // min-length merges, so equal counts can pair ids onto wrong boundaries
    // (device finding 2026-06-11). The contract is therefore: any paragraph
    // the preprocessors touched gets NO sentence spans — only the calm
    // paragraph-level anchor — while untouched paragraphs keep exact spans.
    const raw =
      'Oh that is genuinely hilarious [laugh] and I cannot stop smiling now here. ' +
      'But seriously, let us return to the actual matter at hand together.\n\n' +
      'This untouched paragraph has one full sentence standing comfortably alone. ' +
      'And a second full sentence that is also comfortably long enough to stand.';
    const { tree, segments } = await runPipeline(raw, opts);
    const els = topElements(tree);
    // TEAL paragraph: anchored, but span-free.
    expect(els[0]?.properties?.dataVoicePara).toBe('0:0');
    expect(voiceSegs(els[0] as Element)).toHaveLength(0);
    // Untouched paragraph: exact sentence spans, ids paired in order.
    expect(els[1]?.properties?.dataVoicePara).toBe('0:1');
    const spans = voiceSegs(els[1] as Element);
    const para1Ids = segments.filter((s) => s.paragraphIndex === 1).map((s) => s.segmentId);
    expect(spans.map(([id]) => id)).toEqual(para1Ids);
    expect(spans.length).toBeGreaterThanOrEqual(2);
  });
});

describe('rehypeVoiceAnchor — count-mismatch fallback', () => {
  const opts: SegmentationOpts = { mode: 'sentence', roleplay: false };

  it('degrades to paragraph-level when TTS count differs, no spans, no crash', async () => {
    const raw =
      'This is the first reasonably long sentence here, standing alone. ' +
      'This is the second reasonably long sentence here, also alone.';
    // Fabricate a single-segment list for a paragraph the plugin will split in 2.
    const fabricated: SpeechSegment[] = [
      {
        segmentId: '0:0',
        spokenText: 'whole paragraph',
        blockIndex: 0,
        paragraphIndex: 0,
        ordinalInParagraph: 0,
        charRange: [0, raw.length],
        voice: 'dialogue',
      },
    ];
    const { tree } = await runPipeline(raw, opts, fabricated);
    const els = topElements(tree);
    expect(els[0]?.properties?.dataVoicePara).toBe('0:0');
    // Degraded: no spans wrapped for this paragraph.
    expect(voiceSegs(els[0] as Element)).toEqual([]);
    // And the paragraph element itself does NOT get a (wrong) data-voice-seg.
    expect(els[0]?.properties?.dataVoiceSeg).toBeUndefined();
    expect(textOf(els[0] as Element)).toBe(raw);
  });
});

describe('rehypeVoiceAnchor — multiline display math split (I1)', () => {
  const opts: SegmentationOpts = { mode: 'sentence', roleplay: false };

  it('keeps the plain paragraph anchored to raw index 1, never the post-split drift', async () => {
    // Raw paragraph 0 contains multiline display math. preprocessMath rewrites
    // \[…\] (with a newline inside) to `\n\n$$\n…\n$$\n\n` — ONE raw paragraph
    // becomes THREE processed paragraphs. Pairing on the PROCESSED index would
    // give the plain paragraph "0:3" (drift); the raw mapping must keep it "0:1".
    const raw =
      'Here is \\[\nx = 1\\\\\ny = 2\n\\] inline end.\n\nA plain sentence stands here on its own line afterwards.';
    const { tree } = await runPipeline(raw, opts);

    const paras = voiceParas(tree);
    // The plain paragraph carries the RAW index 1 — not 2 or 3 (the old drift).
    expect(paras).toContain('0:1');
    expect(paras).not.toContain('0:2');
    expect(paras).not.toContain('0:3');
    // Every processed element from the math-containing raw paragraph carries 0:0.
    expect(paras.filter((p) => p === '0:0').length).toBeGreaterThanOrEqual(1);

    // The plain paragraph still gets a sentence span (k_r === 1, normal pairing).
    const segs = topElements(tree).flatMap((el) => voiceSegs(el));
    const plainSeg = segs.find(([, text]) => text.includes('plain sentence'));
    expect(plainSeg).toBeDefined();
    expect(plainSeg?.[0]).toBe('0:1');
  });
});

describe('rehypeVoiceAnchor — code fence', () => {
  const opts: SegmentationOpts = { mode: 'paragraph', roleplay: false };

  it('skips a code-fence paragraph cleanly (no crash, no stray seg)', async () => {
    const raw = 'Intro paragraph long enough here.\n\n```ts\nconst a = 1;\n```';
    const { tree } = await runPipeline(raw, opts);
    const els = topElements(tree);
    // Prose paragraph gets a para index + seg; the <pre> fence carries a para
    // index but no seg (it strips to empty → no TTS segment for it).
    const pre = els.find((e) => e.tagName === 'pre');
    expect(pre).toBeDefined();
    expect(pre?.properties?.dataVoiceSeg).toBeUndefined();
    const prose = els.find((e) => e.tagName === 'p');
    expect(prose?.properties?.dataVoiceSeg).toBe('0:0');
  });
});

describe('rehypeVoiceAnchor — block-qualified data-voice-para (regression)', () => {
  const opts: SegmentationOpts = { mode: 'paragraph', roleplay: false };

  it('writes data-voice-para as "<blockIndex>:<paragraphIndex>", not bare paragraphIndex', async () => {
    // blockIndex=2 simulates this block being the third text block in a message
    // (e.g. text / pill / text / pill / text). Before the fix, data-voice-para
    // was the bare paragraph index "0", "1" — which collides with block 0's
    // paragraph 0 and causes the fallback glow to highlight the wrong block.
    const raw = 'First paragraph long enough here.\n\nSecond paragraph also long enough here.';
    const { tree } = await runPipeline(raw, opts, undefined, 2);
    const els = topElements(tree);
    expect(els).toHaveLength(2);
    // Must carry the block-qualified form, not the bare paragraph index.
    expect(els[0]?.properties?.dataVoicePara).toBe('2:0');
    expect(els[1]?.properties?.dataVoicePara).toBe('2:1');
    // Segment ids are also block-qualified (blockIndex=2) — verify alignment.
    expect(els[0]?.properties?.dataVoiceSeg).toBe('2:0');
    expect(els[1]?.properties?.dataVoiceSeg).toBe('2:1');
  });
});
