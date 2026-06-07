import { describe, expect, it } from 'vitest';
import type { LibraryRow } from '../../src/boot/client-data-db.js';
import { computeEffectiveLibraries } from '../../src/knowledge/effective-libraries.js';

const lib = (id: string, nsfw = false): LibraryRow => ({
  id,
  name: id.toUpperCase(),
  description: `${id} desc`,
  nsfw,
  createdAt: 0,
  updatedAt: 0,
});

describe('computeEffectiveLibraries', () => {
  const all = [lib('a'), lib('b'), lib('c'), lib('x', true)];

  it('unions persona and chat ids', () => {
    const out = computeEffectiveLibraries(['a'], ['b'], all, true);
    expect(out.map((l) => l.id).sort()).toEqual(['a', 'b']);
  });

  it('deduplicates overlap', () => {
    const out = computeEffectiveLibraries(['a', 'b'], ['b'], all, true);
    expect(out.map((l) => l.id).sort()).toEqual(['a', 'b']);
  });

  it('drops ids with no existing library row', () => {
    const out = computeEffectiveLibraries(['a', 'ghost'], [], all, true);
    expect(out.map((l) => l.id)).toEqual(['a']);
  });

  it('filters NSFW libraries when not allowed', () => {
    const out = computeEffectiveLibraries(['a', 'x'], [], all, false);
    expect(out.map((l) => l.id)).toEqual(['a']);
  });

  it('keeps NSFW libraries when allowed', () => {
    const out = computeEffectiveLibraries(['a', 'x'], [], all, true);
    expect(out.map((l) => l.id).sort()).toEqual(['a', 'x']);
  });
});
