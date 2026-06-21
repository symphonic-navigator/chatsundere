// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { dropDuplicates, normaliseForDedup } from '../../src/memory/dedup.js';
import type { ExtractedEntry } from '../../src/memory/extraction-parse.js';

const mk = (content: string): ExtractedEntry => ({ content, category: null, isCorrection: false });

describe('normaliseForDedup', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normaliseForDedup('  Likes   TEA ')).toBe('likes tea');
  });
});

describe('dropDuplicates', () => {
  it('drops candidates already present as a journal entry (normalised)', () => {
    const out = dropDuplicates([mk('Likes tea'), mk('Has a dog')], ['likes  TEA'], '');
    expect(out.map((e) => e.content)).toEqual(['Has a dog']);
  });

  it('drops candidates already contained in the body', () => {
    const out = dropDuplicates([mk('enjoys hiking')], [], 'The user enjoys hiking on weekends.');
    expect(out).toEqual([]);
  });

  it('dedupes within the batch and drops blanks', () => {
    const out = dropDuplicates([mk('A'), mk('a'), mk('   ')], [], '');
    expect(out.map((e) => e.content)).toEqual(['A']);
  });
});
