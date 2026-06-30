// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  emittedRangesForParagraph,
  paragraphRanges,
  segmentBlock,
  segmentMessage,
} from '../../../src/lib/voice/segmentation.js';

const opts = { mode: 'paragraph' as const, roleplay: false };

describe('segmentBlock — paragraph mode', () => {
  it('cuts at blank lines, one segment per paragraph, dialogue voice', () => {
    const src = 'First paragraph here.\n\nSecond paragraph follows on.';
    const segs = segmentBlock(src, 0, opts);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({
      segmentId: '0:0',
      blockIndex: 0,
      paragraphIndex: 0,
      ordinalInParagraph: 0,
      voice: 'dialogue',
      spokenText: 'First paragraph here.',
    });
    expect(segs[1]?.paragraphIndex).toBe(1);
    const [s, e] = segs[1]?.charRange ?? [0, 0];
    expect(src.slice(s, e)).toBe('Second paragraph follows on.');
  });

  it('drops segments that are empty after stripping (code-only paragraph)', () => {
    const src = 'Spoken bit.\n\n```ts\nconst x = 1;\n```\n\nMore speech.';
    const segs = segmentBlock(src, 0, opts);
    expect(segs.map((s) => s.spokenText)).toEqual(['Spoken bit.', 'More speech.']);
    expect(segs[1]?.paragraphIndex).toBe(2); // skipped paragraph still counts (glow alignment)
  });

  it('strips markdown but keeps link labels', () => {
    const src = '## Heading\n\nSee [the docs](https://example.com) for **bold** detail.';
    const segs = segmentBlock(src, 0, opts);
    expect(segs[0]?.spokenText).toBe('Heading');
    expect(segs[1]?.spokenText).toBe('See the docs for bold detail.');
  });

  it('retains TEAL tags in spokenText (canonical text; provider hook strips later)', () => {
    const segs = segmentBlock('Hello [laugh] friend.', 0, opts);
    expect(segs[0]?.spokenText).toContain('[laugh]');
  });

  it('strips emoji from spokenText', () => {
    const segs = segmentBlock('Hello 😄 there 👍🏽 friend.', 0, opts);
    expect(segs[0]?.spokenText).toBe('Hello there friend.');
  });

  it('strips a known integration tag from spokenText (it is never spoken)', () => {
    const segs = segmentBlock('We did it [sfx:emoji-shower 🎉] at last.', 0, opts);
    expect(segs[0]?.spokenText).toBe('We did it at last.');
  });

  it('leaves an unknown integration command literal (matches the display layer)', () => {
    const segs = segmentBlock('Try [sfx:confetti 🎉] now.', 0, opts);
    expect(segs[0]?.spokenText).toContain('[sfx:confetti');
  });

  it('strips list markers and blockquote markers', () => {
    const src = '- First item here.\n- Second item here.\n\n> A quoted line follows.';
    const segs = segmentBlock(src, 0, opts);
    expect(segs[0]?.spokenText).toBe('First item here. Second item here.');
    expect(segs[1]?.spokenText).toBe('A quoted line follows.');
  });

  it('drops a paragraph that is empty after stripping but keeps the index count', () => {
    const src = 'Real speech here.\n\n![alt text](https://example.com/x.png)\n\nMore speech.';
    const segs = segmentBlock(src, 0, opts);
    expect(segs.map((s) => s.spokenText)).toEqual(['Real speech here.', 'More speech.']);
    expect(segs[1]?.paragraphIndex).toBe(2);
  });
});

describe('segmentBlock — roleplay voice cuts', () => {
  const rp = { mode: 'paragraph' as const, roleplay: true };
  it('labels *asterisk narration* narrator and the rest dialogue, in order', () => {
    const segs = segmentBlock('*She smiles warmly.* Welcome back, traveller.', 0, rp);
    expect(segs.map((s) => [s.voice, s.spokenText])).toEqual([
      ['narrator', 'She smiles warmly.'],
      ['dialogue', 'Welcome back, traveller.'],
    ]);
  });
  it('outside roleplay, single asterisks are emphasis: stripped, dialogue voice', () => {
    const segs = segmentBlock('*She smiles.* Hello.', 0, opts);
    expect(segs).toHaveLength(1);
    expect(segs[0]?.voice).toBe('dialogue');
    expect(segs[0]?.spokenText).toBe('She smiles. Hello.');
  });
  it('does not fire the narration cut inside inline code', () => {
    const segs = segmentBlock('Use `a * b` to multiply, alright?', 0, rp);
    expect(segs).toHaveLength(1);
    expect(segs[0]?.voice).toBe('dialogue');
  });
  it('orders multiple narrator/dialogue sub-ranges within a paragraph', () => {
    const segs = segmentBlock('Hi there. *She waves.* Lovely day. *He nods slowly.*', 0, rp);
    expect(segs.map((s) => s.voice)).toEqual(['dialogue', 'narrator', 'dialogue', 'narrator']);
    expect(segs.map((s) => s.spokenText)).toEqual([
      'Hi there.',
      'She waves.',
      'Lovely day.',
      'He nods slowly.',
    ]);
  });
});

describe('segmentBlock — sentence mode', () => {
  const sm = { mode: 'sentence' as const, roleplay: false };
  it('splits within a paragraph via Intl.Segmenter and merges short fragments', () => {
    const src =
      'This is the first reasonably long sentence of the reply. Short. ' +
      'And this is the third sentence, also comfortably long enough.';
    const segs = segmentBlock(src, 0, sm);
    expect(segs).toHaveLength(2); // 'Short.' merges forward
    expect(segs[1]?.spokenText).toBe(
      'Short. And this is the third sentence, also comfortably long enough.',
    );
  });
  it('segment ids stay stable and ordered across paragraphs', () => {
    const segs = segmentBlock(
      'One full sentence long enough to stand alone here.\n\nAnother one, equally long enough to stand alone.',
      0,
      sm,
    );
    expect(segs.map((s) => s.segmentId)).toEqual(['0:0', '0:1']);
    expect(segs.map((s) => s.ordinalInParagraph)).toEqual([0, 0]);
  });
  it('ordinalInParagraph counts emitted segments within one paragraph', () => {
    const src =
      'This is the first reasonably long sentence here, standing alone. ' +
      'This is the second reasonably long sentence here, also alone.';
    const segs = segmentBlock(src, 0, sm);
    expect(segs).toHaveLength(2);
    expect(segs.map((s) => s.paragraphIndex)).toEqual([0, 0]);
    expect(segs.map((s) => s.ordinalInParagraph)).toEqual([0, 1]);
  });
});

describe('paragraphRanges', () => {
  it('splits on blank lines into [start, end) ranges into the input', () => {
    const src = 'Alpha line.\n\nBeta line.\n\nGamma line.';
    const ranges = paragraphRanges(src);
    expect(ranges.map(([s, e]) => src.slice(s, e))).toEqual([
      'Alpha line.',
      'Beta line.',
      'Gamma line.',
    ]);
  });
  it('does not split on blank lines inside a fenced code block', () => {
    const src = 'Before.\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter.';
    const ranges = paragraphRanges(src);
    expect(ranges.map(([s, e]) => src.slice(s, e))).toEqual([
      'Before.',
      '```ts\nconst a = 1;\n\nconst b = 2;\n```',
      'After.',
    ]);
  });
  it('treats a single paragraph as one range', () => {
    const src = 'Just one paragraph of text.';
    expect(paragraphRanges(src)).toEqual([[0, src.length]]);
  });
  it('does not close a fence on a nested fence-opener line inside the block', () => {
    const src = 'Intro.\n\n```md\nExample:\n```yaml\nkey: value\n```\n\nAfter.';
    const ranges = paragraphRanges(src);
    // The ```md fence runs to the bare ``` line; 'After.' is its own paragraph.
    expect(ranges).toHaveLength(3);
    const last = ranges[2];
    expect(last && src.slice(last[0], last[1])).toBe('After.');
  });
  it('does not split on a blank line inside an unclosed (streaming) fence', () => {
    const src = 'Before.\n\n```ts\nconst x = 1;\n\nconst y = 2;';
    const ranges = paragraphRanges(src);
    expect(ranges).toHaveLength(2);
    const last = ranges[1];
    expect(last && src.slice(last[0], last[1])).toBe('```ts\nconst x = 1;\n\nconst y = 2;');
  });
});

describe('sentence splitting via emittedRangesForParagraph (public API)', () => {
  const sentenceOpts = { mode: 'sentence' as const, roleplay: false };

  it('splits a paragraph at sentence boundaries when each sentence clears the minimum', () => {
    const para =
      'This is the first reasonably long sentence standing on its own here. ' +
      'And this is a second reasonably long sentence standing alone too here.';
    const emitted = emittedRangesForParagraph(para, sentenceOpts, true);
    expect(emitted).toHaveLength(2);
    expect(emitted.map((e) => para.slice(e.range[0], e.range[1]).trim())).toEqual([
      'This is the first reasonably long sentence standing on its own here.',
      'And this is a second reasonably long sentence standing alone too here.',
    ]);
  });

  it('emits a single segment for a one-sentence paragraph', () => {
    const para = 'Only one reasonably long sentence stands here on its own.';
    const emitted = emittedRangesForParagraph(para, sentenceOpts, true);
    expect(emitted).toHaveLength(1);
    expect(para.slice(emitted[0]?.range[0] ?? 0, emitted[0]?.range[1] ?? 0).trim()).toBe(para);
  });

  it('merges a short middle sentence forward into the following one (merge rule)', () => {
    // "Short." is below the minimum, so it merges into the next sentence rather
    // than emitting on its own — the behaviour the raw boundaries do NOT have.
    const para =
      'This is a first reasonably long sentence standing on its own here now. ' +
      'Short. This is a third reasonably long sentence standing alone here too.';
    const emitted = emittedRangesForParagraph(para, sentenceOpts, true);
    const texts = emitted.map((e) => para.slice(e.range[0], e.range[1]).trim());
    expect(texts.some((t) => t === 'Short.')).toBe(false);
    expect(texts.some((t) => t.startsWith('Short.'))).toBe(true);
  });
});

describe('findCodeSpans / roleplay fence interaction (M1)', () => {
  // A *span* after a nested-opener line inside a fenced block must be treated
  // as code, not as a narrator cut in roleplay mode.
  it('does not produce a narrator cut for an asterisk span inside a fenced block with a nested-opener line', () => {
    // The fence contains a ```yaml opener (would fool the old regex) followed by
    // *span* — that asterisk must be classified as code, not narration.
    const src =
      'Preamble text here.\n\n```md\nSome example:\n```yaml\n*span*\n```\n\nEpilogue text here.';
    const rp = { mode: 'paragraph' as const, roleplay: true };
    const segs = segmentBlock(src, 0, rp);
    // The fenced block strips to empty (code), so only 'Preamble' and 'Epilogue' emit.
    // Neither should carry a narrator segment — the *span* is inside the fence.
    const voices = segs.map((s) => s.voice);
    expect(voices.every((v) => v === 'dialogue')).toBe(true);
    expect(segs.map((s) => s.spokenText)).toEqual(['Preamble text here.', 'Epilogue text here.']);
  });
});

describe('segmentBlock — sentence mode × roleplay (M4)', () => {
  it('voices, order, and ordinalInParagraph run 0,1,2,… across narrator+dialogue in sentence mode', () => {
    // One paragraph: narrator intro, then two dialogue sentences long enough to stand alone.
    const src =
      '*She leans forward and smiles warmly at you.* ' +
      'Welcome back, traveller — the road has been long and I am glad you found your way here. ' +
      'Please, sit and rest your weary feet beside the fire tonight.';
    const segs = segmentBlock(src, 0, { mode: 'sentence', roleplay: true });
    // Narrator: 'She leans forward…' (one narrator segment, could be short but merged)
    // Dialogue: two long sentences → two dialogue segments
    // ordinalInParagraph must be 0,1,2 across ALL three in document order.
    expect(segs.length).toBeGreaterThanOrEqual(2);
    expect(segs[0]?.voice).toBe('narrator');
    // All segments belong to paragraph 0.
    expect(segs.every((s) => s.paragraphIndex === 0)).toBe(true);
    // ordinalInParagraph must be strictly sequential starting at 0.
    expect(segs.map((s) => s.ordinalInParagraph)).toEqual(segs.map((_, i) => i));
    // Dialogue segments follow the narrator segment.
    const dialogueSegs = segs.filter((s) => s.voice === 'dialogue');
    expect(dialogueSegs.length).toBeGreaterThanOrEqual(1);
    expect(dialogueSegs.every((s) => s.spokenText.length > 0)).toBe(true);
  });
});

describe('segmentMessage', () => {
  it('segments text blocks and uses the content-block index as blockIndex', () => {
    const segs = segmentMessage(
      [
        { type: 'text', text: 'First block speech.' },
        { type: 'pill', pillId: 'p1' },
        { type: 'text', text: 'Third block speech.' },
      ],
      opts,
    );
    expect(segs.map((s) => s.blockIndex)).toEqual([0, 2]);
    expect(segs.map((s) => s.segmentId)).toEqual(['0:0', '2:0']);
    expect(segs.map((s) => s.spokenText)).toEqual(['First block speech.', 'Third block speech.']);
  });
  it('contributes nothing for reasoning blocks', () => {
    const segs = segmentMessage(
      [
        { type: 'reasoning', text: 'Thinking out loud here.' },
        { type: 'text', text: 'Visible answer here.' },
      ],
      opts,
    );
    expect(segs).toHaveLength(1);
    expect(segs[0]?.blockIndex).toBe(1);
    expect(segs[0]?.spokenText).toBe('Visible answer here.');
  });
});

describe('segmentBlock — non-speakable segments (device finding 2026-06-11)', () => {
  const opts = { mode: 'paragraph' as const, roleplay: false };

  it('drops a thematic-break divider paragraph instead of sending "---" to the provider', () => {
    const segs = segmentBlock('Intro text here.\n\n---\n\nJoke text follows on.', 0, opts);
    expect(segs.map((s) => s.spokenText)).toEqual(['Intro text here.', 'Joke text follows on.']);
    // The divider still counts as a paragraph (glow alignment).
    expect(segs[1]?.paragraphIndex).toBe(2);
  });

  it('drops paragraphs that are only emphasis rubble and punctuation', () => {
    const segs = segmentBlock('Real sentence here.\n\n…… * **\n\nAnother real one.', 0, opts);
    expect(segs.map((s) => s.spokenText)).toEqual(['Real sentence here.', 'Another real one.']);
  });

  it('emittedRangesForParagraph applies the same speakability gate (glow consistency)', () => {
    expect(emittedRangesForParagraph('---', opts, true)).toEqual([]);
    expect(emittedRangesForParagraph('…… * **', opts, true)).toEqual([]);
  });
});

describe('segmentBlock — TEAL-aware speakability (device finding 2026-06-11, sentence-glow drift)', () => {
  const opts = { mode: 'paragraph' as const, roleplay: false };

  it('drops a tag-only paragraph — the provider strip would leave empty input', () => {
    const segs = segmentBlock('Real sentence before.\n\n[laugh]\n\nReal sentence after.', 0, opts);
    expect(segs.map((s) => s.spokenText)).toEqual([
      'Real sentence before.',
      'Real sentence after.',
    ]);
    expect(segs[1]?.paragraphIndex).toBe(2);
  });

  it('keeps a wrapped-tag segment whose enclosed text is speakable', () => {
    const segs = segmentBlock('<whisper>a real secret</whisper>', 0, opts);
    expect(segs).toHaveLength(1);
    expect(segs[0]?.spokenText).toContain('a real secret');
  });
});
