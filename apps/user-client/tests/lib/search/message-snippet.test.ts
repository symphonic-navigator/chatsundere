// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { ContentBlock } from '../../../src/boot/client-data-db.js';
import { queryWords } from '../../../src/lib/search/fold.js';
import {
  type Snippet,
  displayedText,
  matchMessage,
  rawCandidate,
} from '../../../src/lib/search/message-snippet.js';

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function marked(s: Snippet): string[] {
  return s.marks.map(([a, b]) => s.text.slice(a, b));
}

function match(text: string, q: string): Snippet | null {
  return matchMessage(text, queryWords(q));
}

describe('matchMessage', () => {
  it('matches case- and accent-insensitively', () => {
    for (const q of ['Müller', 'muller', 'MULLER']) {
      const s = match('I spoke to Frau Müller today.', q);
      expect(s).not.toBeNull();
      expect(marked(s as Snippet)).toEqual(['Müller']);
    }
  });

  it('puts the mark on the accented original when the query has no accent', () => {
    const s = match('We met at the café on Friday', 'cafe') as Snippet;
    expect(s.text).toBe('We met at the café on Friday');
    expect(s.marks).toEqual([[14, 18]]);
    expect(marked(s)).toEqual(['café']);
  });

  it('keeps a decomposed accent inside its mark', () => {
    const s = match('a café here', 'cafe') as Snippet;
    expect(marked(s)).toEqual(['café']);
  });

  it('needs all words, in any order', () => {
    const text = 'The paprika was smoked over oak.';
    const s = match(text, 'smoked papri') as Snippet;
    expect(marked(s)).toEqual(['papri', 'smoked']);
    expect(match(text, 'smoked cumin')).toBeNull();
  });

  it('marks every occurrence and merges overlaps', () => {
    const s = match('aaa banana', 'ana nan') as Snippet;
    expect(marked(s)).toEqual(['anana']);
  });

  it('turns newlines into spaces', () => {
    const s = match('first line\nsecond line', 'second') as Snippet;
    expect(s.text).toBe('first line second line');
  });

  it('cuts a long text on word boundaries with an ellipsis at each cut', () => {
    const filler = 'lorem ipsum dolor sit amet '.repeat(20);
    const s = match(`${filler}the needle sits here ${filler}`, 'needle') as Snippet;
    expect(s.text.startsWith('…')).toBe(true);
    expect(s.text.endsWith('…')).toBe(true);
    expect(s.text.length).toBeLessThanOrEqual(120 + 2 * 16 + 2);
    const inner = s.text.slice(1, -1);
    expect(`${filler}the needle sits here ${filler}`).toContain(inner);
    for (const word of inner.split(' ')) {
      expect(['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'the', 'needle', 'sits', 'here']).toContain(
        word,
      );
    }
    expect(marked(s)).toEqual(['needle']);
  });

  it('prefers the region holding both words in a long text', () => {
    const filler = 'nothing to see in this part of the message at all '.repeat(8);
    const text = `alpha early on. ${filler}Then alpha and beta together. ${filler}`;
    const s = match(text, 'alpha beta') as Snippet;
    expect(s.text).toContain('alpha and beta together');
    expect(marked(s)).toEqual(['alpha', 'beta']);
    expect(s.text).not.toContain('early on');
  });

  it('never splits an emoji or ZWJ sequence at a cut', () => {
    const family = '👨‍👩‍👧';
    const text = `${family.repeat(60)}needle${family.repeat(60)}`;
    const s = match(text, 'needle') as Snippet;
    const inner = s.text.replace(/^…/, '').replace(/…$/, '');
    const parts = Array.from(GRAPHEMES.segment(inner), (g) => g.segment);
    const nonFamily = parts.filter((p) => p !== family).join('');
    expect(nonFamily).toBe('needle');
    expect(marked(s)).toEqual(['needle']);
  });

  it('returns null for no words', () => {
    expect(matchMessage('anything', [])).toBeNull();
  });
});

describe('displayedText', () => {
  it('never lets Markdown or TEAL into the snippet', () => {
    const blocks: ContentBlock[] = [
      {
        type: 'text',
        text: '## Recipe\n\n- **smoked** paprika [laugh] and <whisper>a [link](https://x.y) secret</whisper>',
      },
    ];
    const s = matchMessage(displayedText(blocks), queryWords('smoked paprika secret')) as Snippet;
    expect(s.text).toBe('Recipe  smoked paprika 😄 and a link secret');
    for (const raw of ['**', '##', '[laugh]', '<whisper>', '](', '- ']) {
      expect(s.text).not.toContain(raw);
    }
    expect(marked(s)).toEqual(['smoked', 'paprika', 'secret']);
  });

  it('keeps inline code text and drops reasoning and pills', () => {
    const blocks: ContentBlock[] = [
      { type: 'reasoning', text: 'hidden thought' },
      { type: 'text', text: 'run `pnpm _test_` now' },
      { type: 'pill', pillId: 'p1' },
    ];
    expect(displayedText(blocks)).toBe('run pnpm _test_ now');
  });
});

describe('rawCandidate', () => {
  it('passes when every word occurs in the text blocks', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'Smoked ' },
      { type: 'pill', pillId: 'p1' },
      { type: 'text', text: 'Paprika' },
    ];
    expect(rawCandidate(blocks, queryWords('paprika smoked'))).toBe(true);
    expect(rawCandidate(blocks, queryWords('paprika cumin'))).toBe(false);
  });

  it('rejects a match only in reasoning', () => {
    const blocks: ContentBlock[] = [
      { type: 'reasoning', text: 'The user wants paprika.' },
      { type: 'text', text: 'Here you go.' },
    ];
    expect(rawCandidate(blocks, queryWords('paprika'))).toBe(false);
  });

  it('rejects an empty word list', () => {
    expect(rawCandidate([{ type: 'text', text: 'x' }], [])).toBe(false);
  });
});
