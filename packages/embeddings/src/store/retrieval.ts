// SPDX-License-Identifier: LGPL-3.0-only
import { type QuantVector, cosineFromQuant } from './quantise.js';
import type { VectorRow } from './schema.js';

export interface NumericPredicate {
  gte?: number;
  lte?: number;
  gt?: number;
  lt?: number;
  eq?: number;
}

export interface VectorFilter {
  tags?: Record<string, string>;
  numeric?: Record<string, NumericPredicate>;
}

export interface Candidate {
  id: string;
  score: number; // cosine similarity
  numeric: Record<string, number>;
  metadata?: unknown;
}

export interface RankOptions {
  topK: number;
  candidateK?: number;
  minScore?: number;
  rerank?: (candidates: Candidate[]) => Candidate[];
}

/** True iff the row satisfies every tag equality and numeric predicate in the filter. */
export function matchesFilter(
  row: Pick<VectorRow, 'tags' | 'numeric'>,
  filter?: VectorFilter,
): boolean {
  if (!filter) return true;
  if (filter.tags) {
    for (const [k, v] of Object.entries(filter.tags)) {
      if (row.tags[k] !== v) return false;
    }
  }
  if (filter.numeric) {
    for (const [k, p] of Object.entries(filter.numeric)) {
      const x = row.numeric[k];
      if (x === undefined) return false;
      if (p.eq !== undefined && x !== p.eq) return false;
      if (p.gte !== undefined && !(x >= p.gte)) return false;
      if (p.lte !== undefined && !(x <= p.lte)) return false;
      if (p.gt !== undefined && !(x > p.gt)) return false;
      if (p.lt !== undefined && !(x < p.lt)) return false;
    }
  }
  return true;
}

/**
 * Score candidate rows against a query vector and rank them.
 * Order of operations: cosine score → minScore floor → sort desc →
 * over-fetch candidateK → rerank hook → final topK.
 */
export function scoreAndRank(
  query: QuantVector,
  rows: VectorRow[],
  opts: RankOptions,
): Candidate[] {
  let pool: Candidate[] = rows.map((r) => ({
    id: r.id,
    score: cosineFromQuant(query, r),
    numeric: r.numeric,
    metadata: r.metadata,
  }));

  const floor = opts.minScore;
  if (floor !== undefined) {
    pool = pool.filter((c) => c.score >= floor);
  }
  pool.sort((a, b) => b.score - a.score);
  if (opts.candidateK !== undefined) {
    pool = pool.slice(0, opts.candidateK);
  }
  if (opts.rerank) {
    pool = opts.rerank(pool);
  }
  return pool.slice(0, opts.topK);
}
