// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_LORE_OPTS,
  type LoreDocument,
  formatLore,
  phraseMatches,
  selectLore,
} from '../../src/knowledge/lore.js';

const lib = [{ id: 'L1', name: 'Story' }];
function doc(p: Partial<LoreDocument>): LoreDocument {
  return {
    id: 'd',
    libraryId: 'L1',
    title: 'Red Dragon',
    content: 'The red dragon guards the valley.',
    triggerPhrases: ['red dragon'],
    triggerOnCompanion: false,
    createdAt: 1,
    ...p,
  };
}

describe('phraseMatches (Unicode word boundary)', () => {
  it('matches a whole word', () => {
    expect(phraseMatches('here comes the red dragon now', 'red dragon')).toBe(true);
  });
  it('does NOT match a substring inside a longer word (dragon/dragonfly compound)', () => {
    expect(phraseMatches('i spotted a dragonfly', 'dragon')).toBe(false);
  });
  it('respects boundaries around diacritics (why \\p{L}, not ASCII \\b)', () => {
    // Diacritics are \p{L}, so the Unicode boundary holds where ASCII \b would fail.
    // This test exists deliberately to keep a non-ASCII vector in the suite.
    expect(phraseMatches('the café is open', 'café')).toBe(true);
    expect(phraseMatches('cafés are everywhere', 'café')).toBe(false); // é + s: no boundary
  });
  it('escapes regex metacharacters in the phrase', () => {
    expect(phraseMatches('the dr. no club meets', 'dr. no')).toBe(true);
  });
  it('an empty phrase never matches', () => {
    expect(phraseMatches('anything at all', '')).toBe(false);
  });
});

describe('selectLore', () => {
  it('injects a matching document on the user message', () => {
    const r = selectLore([doc({})], lib, 'about the red dragon', null, KNOWLEDGE_LORE_OPTS);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({ libraryName: 'Story', documentTitle: 'Red Dragon' });
  });

  it('the rose-society derailment case does not fire while discussing the general topic', () => {
    const d = doc({
      title: 'Society',
      triggerPhrases: ['rose society'],
      content: 'Club lore.',
    });
    const r = selectLore([d], lib, 'what kinds of roses are there', null, KNOWLEDGE_LORE_OPTS);
    expect(r.entries).toHaveLength(0);
  });

  it('companion text only triggers when the document opts in', () => {
    const off = doc({ triggerOnCompanion: false });
    const on = doc({ id: 'd2', triggerOnCompanion: true });
    const userText = 'and then?';
    const companion = 'The red dragon rose up.';
    expect(selectLore([off], lib, userText, companion, KNOWLEDGE_LORE_OPTS).entries).toHaveLength(
      0,
    );
    expect(selectLore([on], lib, userText, companion, KNOWLEDGE_LORE_OPTS).entries).toHaveLength(1);
  });

  it('orders by library order then createdAt', () => {
    const libs = [
      { id: 'L1', name: 'A' },
      { id: 'L2', name: 'B' },
    ];
    const a = doc({ id: 'a', libraryId: 'L2', title: 'A', createdAt: 5 });
    const b = doc({ id: 'b', libraryId: 'L1', title: 'B', createdAt: 9 });
    const c = doc({ id: 'c', libraryId: 'L1', title: 'C', createdAt: 2 });
    const r = selectLore([a, b, c], libs, 'red dragon', null, KNOWLEDGE_LORE_OPTS);
    expect(r.entries.map((e) => e.documentTitle)).toEqual(['C', 'B', 'A']);
  });

  it('truncates the overflowing entry and omits the rest', () => {
    const big = doc({ id: 'big', title: 'Big', content: 'x'.repeat(20), createdAt: 1 });
    const next = doc({ id: 'nxt', title: 'Next', content: 'yyyy', createdAt: 2 });
    const r = selectLore([big, next], lib, 'red dragon', null, {
      maxEntries: 8,
      maxTotalChars: 10,
      cooldownRounds: 8,
    });
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]?.injectedText).toBe(`${'x'.repeat(10)}…`);
    expect(r.truncatedCount).toBe(1);
    expect(r.omittedCount).toBe(1);
  });

  it('caps the entry count', () => {
    const docs = Array.from({ length: 5 }, (_, i) =>
      doc({ id: `d${i}`, title: `T${i}`, content: 'z', createdAt: i }),
    );
    const r = selectLore(docs, lib, 'red dragon', null, {
      maxEntries: 2,
      maxTotalChars: 8000,
      cooldownRounds: 8,
    });
    expect(r.entries).toHaveLength(2);
    expect(r.omittedCount).toBe(3);
  });

  it('ignores documents with no trigger phrases', () => {
    const r = selectLore(
      [doc({ triggerPhrases: [] })],
      lib,
      'red dragon',
      null,
      KNOWLEDGE_LORE_OPTS,
    );
    expect(r.entries).toHaveLength(0);
  });

  it('does not match a phrase that spans the user/companion boundary', () => {
    const d = doc({ triggerOnCompanion: true });
    // "red" ends the user message, "dragon" starts the companion message;
    // independent scans must NOT fire the "red dragon" phrase.
    const r = selectLore(
      [d],
      lib,
      'at the end stood the red',
      'dragon was its name',
      KNOWLEDGE_LORE_OPTS,
    );
    expect(r.entries).toHaveLength(0);
  });

  it('ignores documents whose library is not in the provided list', () => {
    const orphan = doc({ id: 'orphan', libraryId: 'L-unknown' });
    const r = selectLore([orphan], lib, 'red dragon', null, KNOWLEDGE_LORE_OPTS);
    expect(r.entries).toHaveLength(0);
  });

  it('excludes a document that was recently injected (cooldown)', () => {
    const d = doc({ id: 'cool', triggerPhrases: ['red dragon'] });
    const recent = new Set(['cool']);
    const r = selectLore([d], lib, 'the red dragon', null, KNOWLEDGE_LORE_OPTS, recent);
    expect(r.entries).toHaveLength(0);
  });

  it('emits the documentId on each entry', () => {
    const r = selectLore(
      [doc({ id: 'doc-1' })],
      lib,
      'the red dragon',
      null,
      KNOWLEDGE_LORE_OPTS,
      new Set(),
    );
    expect(r.entries[0]?.documentId).toBe('doc-1');
  });
});

describe('formatLore', () => {
  it('renders provenance-headed blocks, empty when none', () => {
    expect(formatLore([])).toBe('');
    const out = formatLore([
      { documentId: 'x', libraryName: 'Story', documentTitle: 'Red Dragon', injectedText: 'X.' },
    ]);
    expect(out).toContain("Relevant background from the user's knowledge:");
    expect(out).toContain('[Story › Red Dragon]\nX.');
  });
});
