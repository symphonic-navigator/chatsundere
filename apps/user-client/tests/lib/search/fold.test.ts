// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { fold, foldWithMap, queryWords } from '../../../src/lib/search/fold.js';

describe('fold', () => {
  it('folds case and accents so Müller, muller and MULLER agree', () => {
    expect(fold('Müller')).toBe('muller');
    expect(fold('muller')).toBe('muller');
    expect(fold('MULLER')).toBe('muller');
  });

  it('folds precomposed and decomposed accents alike', () => {
    expect(fold('café')).toBe('cafe');
    expect(fold('café')).toBe('cafe');
  });

  it('agrees with foldWithMap, including word-final sigma', () => {
    for (const s of ['ΟΔΥΣΣΕΥΣ', 'Crème Brûlée', 'İstanbul', '👨‍👩‍👧 family']) {
      expect(foldWithMap(s).folded).toBe(fold(s));
    }
  });
});

describe('foldWithMap', () => {
  it('maps every folded unit back to its original index, with a sentinel', () => {
    const s = 'Ça va';
    const { folded, map } = foldWithMap(s);
    expect(folded).toBe('ca va');
    expect(map).toEqual([0, 1, 2, 3, 4, s.length]);
  });

  it('skips dropped combining marks in the map', () => {
    const s = 'été';
    const { folded, map } = foldWithMap(s);
    expect(folded).toBe('ete');
    expect(map).toEqual([0, 2, 3, 4]);
  });

  it('maps both units of a surrogate pair to its start', () => {
    const { folded, map } = foldWithMap('a😀b');
    expect(folded).toBe('a😀b');
    expect(map).toEqual([0, 1, 1, 3, 4]);
  });
});

describe('queryWords', () => {
  it('folds, splits on whitespace, drops empties and de-duplicates', () => {
    expect(queryWords('  Smoked   PAPRIKA smoked\tpaprika ')).toEqual(['smoked', 'paprika']);
    expect(queryWords('   ')).toEqual([]);
    expect(queryWords('Café cafe')).toEqual(['cafe']);
  });
});
