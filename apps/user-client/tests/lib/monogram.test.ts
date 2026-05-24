// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { generateMonogram } from '../../src/lib/monogram.js';

describe('generateMonogram', () => {
  it('uses first + last initial for multi-part names', () => {
    expect(generateMonogram('Wilhelm Friedrich', new Set())).toBe('WF');
  });

  it('uppercases the result', () => {
    expect(generateMonogram('wilhelm friedrich', new Set())).toBe('WF');
  });

  it('falls back to letter combinations within a single-word name', () => {
    expect(generateMonogram('Alex', new Set())).toBe('AL');
  });

  it('iterates non-adjacent pairs when the first two collide', () => {
    expect(generateMonogram('Alex', new Set(['AL']))).toBe('AE');
  });

  it('falls back to the doubled first letter if no combinations are free', () => {
    expect(generateMonogram('Ab', new Set(['AB']))).toBe('AA');
  });

  it('iterates AA … ZZ for names with no usable letters', () => {
    expect(generateMonogram('!!', new Set())).toBe('AA');
    expect(generateMonogram('!!', new Set(['AA']))).toBe('AB');
  });

  it('returns ?? as the ultimate fallback when every AA…ZZ is taken', () => {
    const all: Set<string> = new Set();
    for (let i = 65; i <= 90; i++) {
      for (let j = 65; j <= 90; j++) {
        all.add(String.fromCharCode(i) + String.fromCharCode(j));
      }
    }
    expect(generateMonogram('whatever', all)).toBe('??');
  });

  it('strips non-alpha when computing letter pools', () => {
    expect(generateMonogram('Liz 2.0', new Set())).toBe('LI');
  });
});
