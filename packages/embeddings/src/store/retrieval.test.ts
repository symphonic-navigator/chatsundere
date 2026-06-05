// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { l2Norm } from '../lib/similarity.js';
import { encode } from './codec.js';
import { type Candidate, matchesFilter, scoreAndRank } from './retrieval.js';
import type { VectorRow } from './schema.js';

function row(
  id: string,
  vec: number[],
  tags: Record<string, string> = {},
  numeric: Record<string, number> = {},
  metadata?: unknown,
): VectorRow {
  const encoded = encode(new Float32Array(vec));
  return { ...encoded, id, collection: 'c', tags, numeric, metadata, updatedAt: 0, bytes: 0 };
}

describe('matchesFilter', () => {
  const r = row('1', [1, 0], { persona: 'p1', mode: 'sfw' }, { createdAt: 100, salience: 5 });

  it('passes when all tag equalities and numeric predicates hold', () => {
    expect(matchesFilter(r, { tags: { persona: 'p1' }, numeric: { createdAt: { gte: 50 } } })).toBe(
      true,
    );
  });
  it('fails on a tag mismatch', () => {
    expect(matchesFilter(r, { tags: { persona: 'p2' } })).toBe(false);
  });
  it('fails on a numeric range miss', () => {
    expect(matchesFilter(r, { numeric: { createdAt: { lt: 100 } } })).toBe(false);
  });
  it('fails when a filtered numeric key is absent on the record', () => {
    expect(matchesFilter(r, { numeric: { missing: { gte: 0 } } })).toBe(false);
  });
  it('passes with no filter', () => {
    expect(matchesFilter(r)).toBe(true);
  });
});

describe('scoreAndRank', () => {
  const query = new Float32Array([1, 0]);
  const queryNorm = l2Norm(query);
  const rows = [row('near', [0.99, 0.14]), row('mid', [0.7, 0.7]), row('far', [0, 1])];

  it('ranks by cosine descending and respects topK', () => {
    const out = scoreAndRank(query, queryNorm, rows, { topK: 2 });
    expect(out.map((c) => c.id)).toEqual(['near', 'mid']);
  });

  it('applies minScore as a floor before ranking', () => {
    const out = scoreAndRank(query, queryNorm, rows, { topK: 10, minScore: 0.5 });
    expect(out.map((c) => c.id)).toEqual(['near', 'mid']); // 'far' (cos 0) excluded
  });

  it('over-fetches candidateK then lets rerank reorder before topK', () => {
    const rerank = (cands: Candidate[]) => [...cands].reverse();
    const out = scoreAndRank(query, queryNorm, rows, { topK: 2, candidateK: 3, rerank });
    expect(out.map((c) => c.id)).toEqual(['far', 'mid']); // reversed pool [far,mid,near] → topK 2
  });

  it('exposes numeric and metadata on candidates for the rerank hook', () => {
    const withMeta = [row('x', [1, 0], {}, { salience: 9 }, { note: 'hi' })];
    const out = scoreAndRank(query, queryNorm, withMeta, { topK: 1 });
    expect(out[0]?.numeric.salience).toBe(9);
    expect(out[0]?.metadata).toEqual({ note: 'hi' });
  });
});
