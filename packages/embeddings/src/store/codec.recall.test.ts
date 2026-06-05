// SPDX-License-Identifier: LGPL-3.0-only
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cosineSimilarity, l2Norm } from '../lib/similarity.js';
import { cosineQuery, encode } from './codec.js';

const TOP_K = 10;

/** Indices of the top-K nearest fp32 neighbours of vector i (excluding i). Ported from dev/experiment.ts. */
function topKFp32(vecs: Float32Array[], i: number, k: number): Set<number> {
  const vi = vecs[i];
  if (!vi) return new Set();
  const scored: Array<{ idx: number; c: number }> = [];
  for (let j = 0; j < vecs.length; j++) {
    if (j === i) continue;
    const vj = vecs[j];
    if (!vj) continue;
    scored.push({ idx: j, c: cosineSimilarity(vi, vj) });
  }
  scored.sort((a, b) => b.c - a.c);
  return new Set(scored.slice(0, k).map((s) => s.idx));
}

/** Top-K neighbours of query i scored with the codec (fp32 query vs encoded candidates). */
function topKCodec(
  vecs: Float32Array[],
  encoded: ReturnType<typeof encode>[],
  norms: number[],
  i: number,
  k: number,
): Set<number> {
  const vi = vecs[i];
  if (!vi) return new Set();
  const qNorm = norms[i] ?? 0;
  const scored: Array<{ idx: number; c: number }> = [];
  for (let j = 0; j < encoded.length; j++) {
    if (j === i) continue;
    const ej = encoded[j];
    if (!ej) continue;
    scored.push({ idx: j, c: cosineQuery(vi, qNorm, ej) });
  }
  scored.sort((a, b) => b.c - a.c);
  return new Set(scored.slice(0, k).map((s) => s.idx));
}

/** Mean recall@K of the codec's neighbours against the fp32 ranking, leave-one-out. */
function meanRecall(vecs: Float32Array[], k: number): number {
  const encoded = vecs.map((v) => encode(v));
  const norms = vecs.map((v) => l2Norm(v));
  let sum = 0;
  let n = 0;
  for (let i = 0; i < vecs.length; i++) {
    const truth = topKFp32(vecs, i, k);
    if (truth.size === 0) continue;
    const got = topKCodec(vecs, encoded, norms, i, k);
    let hits = 0;
    for (const idx of got) if (truth.has(idx)) hits++;
    sum += hits / truth.size;
    n++;
  }
  return sum / Math.max(1, n);
}

function loadFixture(): Float32Array[] {
  const url = new URL('../../tests/fixtures/corpus-vectors.f32.bin', import.meta.url);
  const buf = readFileSync(fileURLToPath(url));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const all = new Float32Array(ab);
  const count = all[0] ?? 0;
  const dim = all[1] ?? 0;
  const vecs: Float32Array[] = [];
  for (let r = 0; r < count; r++) vecs.push(all.subarray(2 + r * dim, 2 + (r + 1) * dim));
  return vecs;
}

describe('recall harness (synthetic sanity)', () => {
  it('recovers clear cluster neighbours (harness + codec agree on obvious structure)', () => {
    // 4 clusters × 5 members; each member is a base direction + small noise, so a
    // vector's 4 nearest fp32 neighbours are its cluster-mates and int4_L preserves
    // that obvious structure. A sanity check on the harness, not the quality bar.
    let s = 12345 >>> 0;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff;
    };
    const dim = 768;
    const vecs: Float32Array[] = [];
    for (let c = 0; c < 4; c++) {
      const base = new Float32Array(dim);
      for (let i = 0; i < dim; i++) base[i] = rnd() * 2 - 1;
      for (let m = 0; m < 5; m++) {
        const v = new Float32Array(dim);
        for (let i = 0; i < dim; i++) v[i] = (base[i] ?? 0) + (rnd() * 2 - 1) * 0.02;
        let nrm = 0;
        for (let i = 0; i < dim; i++) nrm += (v[i] ?? 0) * (v[i] ?? 0);
        nrm = Math.sqrt(nrm);
        for (let i = 0; i < dim; i++) v[i] = (v[i] ?? 0) / nrm;
        vecs.push(v);
      }
    }
    // Each vector has 4 cluster-mates; recall@4 should be ~1.0.
    expect(meanRecall(vecs, 4)).toBeGreaterThan(0.95);
  });
});

describe('int4_L recall against real arctic-embed vectors', () => {
  it('keeps recall@10 ≥ 0.95 vs the fp32 ranking', () => {
    const vecs = loadFixture();
    expect(vecs.length).toBeGreaterThan(100);
    const recall = meanRecall(vecs, TOP_K);
    expect(recall).toBeGreaterThanOrEqual(0.95);
  });
});
