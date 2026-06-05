// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { cosineSimilarity, l2Norm } from '../lib/similarity.js';
import {
  BLOCK_SIZE,
  CODEC_VERSION,
  I4L_VECTOR_BYTES,
  cosineQuery,
  decode,
  deserialise,
  encode,
  serialise,
} from './codec.js';

/** Deterministic pseudo-random unit vector (no Math.random — reproducible). */
function randomUnitVector(dim: number, seed: number): Float32Array {
  const v = new Float32Array(dim);
  let s = seed >>> 0;
  for (let i = 0; i < dim; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    v[i] = (s / 0xffffffff) * 2 - 1;
  }
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += (v[i] ?? 0) * (v[i] ?? 0);
  norm = Math.sqrt(norm);
  for (let i = 0; i < dim; i++) v[i] = (v[i] ?? 0) / norm;
  return v;
}

describe('codec constants', () => {
  it('exposes the format version, block size, and per-vector byte size', () => {
    expect(CODEC_VERSION).toBe(1);
    expect(BLOCK_SIZE).toBe(16);
    expect(I4L_VECTOR_BYTES).toBe(497); // 1 + 4 + 12 + 48 + 48 + 384
  });
});

describe('encode/decode', () => {
  it('tags every encoded vector with the codec version', () => {
    const e = encode(randomUnitVector(768, 7));
    expect(e.version).toBe(CODEC_VERSION);
    expect(e.codes.length).toBe(384);
    expect(e.scales.length).toBe(48);
    expect(e.offsets.length).toBe(48);
  });

  it('round-trips a unit vector with high cosine fidelity', () => {
    const v = randomUnitVector(768, 42);
    const back = decode(encode(v));
    expect(cosineSimilarity(v, back)).toBeGreaterThan(0.99);
  });

  it('per-block: block min and max are reconstructed without clipping (single lossless block)', () => {
    // A single 16-dim block: the per-vector metadata quantisation is lossless,
    // so the block min maps exactly to code 0 and the max to code 15.
    const v = new Float32Array(16);
    for (let i = 0; i < 16; i++) v[i] = Math.sin(i + 1);
    const back = decode(encode(v));
    const mn = Math.min(...Array.from(v));
    const mx = Math.max(...Array.from(v));
    expect(Math.min(...Array.from(back))).toBeCloseTo(mn, 5);
    expect(Math.max(...Array.from(back))).toBeCloseTo(mx, 5);
    for (const x of back) {
      expect(x).toBeGreaterThanOrEqual(mn - 1e-5);
      expect(x).toBeLessThanOrEqual(mx + 1e-5);
    }
  });

  it('handles the zero vector without NaN', () => {
    const e = encode(new Float32Array(768));
    expect(e.norm).toBe(0);
    expect(e.scaleMax).toBe(0);
    const back = decode(e);
    for (const x of back) expect(x).toBe(0);
  });
});

describe('cosineQuery', () => {
  it('equals the fp32 cosine of the query against the decoded candidate', () => {
    const q = randomUnitVector(768, 11);
    const c = randomUnitVector(768, 22);
    const e = encode(c);
    const viaQuery = cosineQuery(q, l2Norm(q), e);
    const viaDecode = cosineSimilarity(q, decode(e));
    expect(viaQuery).toBeCloseTo(viaDecode, 5);
  });

  it('returns 0 against an all-zero candidate (no NaN)', () => {
    const q = randomUnitVector(768, 33);
    expect(cosineQuery(q, l2Norm(q), encode(new Float32Array(768)))).toBe(0);
  });

  it('keeps a vector its own nearest neighbour at high similarity', () => {
    const v = randomUnitVector(768, 44);
    expect(cosineQuery(v, l2Norm(v), encode(v))).toBeGreaterThan(0.99);
  });

  it('returns 0 for a zero-norm query (no NaN)', () => {
    const zeroQuery = new Float32Array(768);
    expect(cosineQuery(zeroQuery, 0, encode(randomUnitVector(768, 55)))).toBe(0);
  });
});

describe('serialise/deserialise', () => {
  it('round-trips an encoded vector byte-exactly', () => {
    const e = encode(randomUnitVector(768, 99));
    const blob = serialise(e);
    expect(blob.length).toBe(I4L_VECTOR_BYTES);
    const back = deserialise(blob);
    expect(back.version).toBe(e.version);
    expect(back.scaleMax).toBeCloseTo(e.scaleMax, 6);
    expect(back.offMin).toBeCloseTo(e.offMin, 6);
    expect(back.offMax).toBeCloseTo(e.offMax, 6);
    expect(back.norm).toBeCloseTo(e.norm, 4);
    expect(Array.from(back.codes)).toEqual(Array.from(e.codes));
    expect(Array.from(back.scales)).toEqual(Array.from(e.scales));
    expect(Array.from(back.offsets)).toEqual(Array.from(e.offsets));
  });

  it('writes the version tag as the first byte', () => {
    const blob = serialise(encode(randomUnitVector(768, 100)));
    expect(blob[0]).toBe(CODEC_VERSION);
  });

  it('rejects an unrecognised version byte', () => {
    const blob = serialise(encode(randomUnitVector(768, 101)));
    blob[0] = 2;
    expect(() => deserialise(blob)).toThrow(/version/i);
  });

  it('rejects a blob of incorrect length', () => {
    const short = new Uint8Array(10);
    short[0] = CODEC_VERSION;
    expect(() => deserialise(short)).toThrow(/length/i);
  });
});
