// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { cosineSimilarity } from '../lib/similarity.js';
import { cosineFromQuant, dequantise, quantiseMaxAbs } from './quantise.js';

function randomUnitVector(dim: number, seed: number): Float32Array {
  // Deterministic pseudo-random unit vector (no Math.random — reproducible tests).
  const v = new Float32Array(dim);
  let s = seed;
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

describe('quantiseMaxAbs', () => {
  it('maps the largest-magnitude component to exactly ±127 — no clipping', () => {
    const v = new Float32Array([0.1, -0.5, 0.25, 0.05]);
    const { q } = quantiseMaxAbs(v);
    expect(Math.max(...Array.from(q, (x) => Math.abs(x)))).toBe(127);
    for (const x of q) expect(Math.abs(x)).toBeLessThanOrEqual(127);
    expect(q[1]).toBe(-127); // the max-abs component
  });

  it('round-trips a unit vector with high cosine fidelity', () => {
    const v = randomUnitVector(768, 42);
    const back = dequantise(quantiseMaxAbs(v));
    expect(cosineSimilarity(v, back)).toBeGreaterThan(0.999);
  });

  it('cosineFromQuant matches true cosine within int8 tolerance (scale cancels)', () => {
    const a = randomUnitVector(768, 1);
    const b = randomUnitVector(768, 2);
    const trueCos = cosineSimilarity(a, b);
    const quantCos = cosineFromQuant(quantiseMaxAbs(a), quantiseMaxAbs(b));
    expect(Math.abs(quantCos - trueCos)).toBeLessThan(0.01);
  });

  it('handles the zero vector without NaN', () => {
    const z = new Float32Array(8);
    const qv = quantiseMaxAbs(z);
    expect(qv.norm).toBe(0);
    expect(qv.scale).toBe(0);
    expect(cosineFromQuant(qv, quantiseMaxAbs(randomUnitVector(8, 3)))).toBe(0);
  });
});
