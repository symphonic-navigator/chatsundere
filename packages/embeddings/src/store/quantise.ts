// SPDX-License-Identifier: LGPL-3.0-only

/**
 * A vector stored as symmetric per-vector max-abs int8.
 * `scale` dequantises (v ≈ scale · q); `norm` is the L2 length of `q`
 * in integer space, precomputed so cosine divides by it directly.
 */
export interface QuantVector {
  q: Int8Array;
  scale: number;
  norm: number;
}

/**
 * Quantise a float vector to symmetric per-vector max-abs int8. The component
 * with the largest magnitude maps to exactly ±127, so nothing is ever clipped —
 * an outlier defines the scale rather than being truncated.
 */
export function quantiseMaxAbs(v: ArrayLike<number>): QuantVector {
  let max = 0;
  for (let i = 0; i < v.length; i++) {
    const a = Math.abs(v[i] ?? 0);
    if (a > max) max = a;
  }
  const q = new Int8Array(v.length);
  if (max === 0) return { q, scale: 0, norm: 0 };

  const inv = 127 / max;
  let sumSq = 0;
  for (let i = 0; i < v.length; i++) {
    let qi = Math.round((v[i] ?? 0) * inv);
    // Defensive clamp for floating-point edge cases only; the true max maps to ±127.
    if (qi > 127) qi = 127;
    else if (qi < -127) qi = -127;
    q[i] = qi;
    sumSq += qi * qi;
  }
  return { q, scale: max / 127, norm: Math.sqrt(sumSq) };
}

/** Reconstruct an approximate float vector (used by the future "dreaming" merge pass). */
export function dequantise(qv: QuantVector): Float32Array {
  const out = new Float32Array(qv.q.length);
  for (let i = 0; i < qv.q.length; i++) out[i] = (qv.q[i] ?? 0) * qv.scale;
  return out;
}

/**
 * Cosine similarity directly from two int8 vectors. The per-vector scales cancel:
 * cosine = Σ(qaᵢ·qbᵢ) / (‖qa‖·‖qb‖). Integer dot product, divided by the
 * precomputed norms.
 */
export function cosineFromQuant(a: QuantVector, b: QuantVector): number {
  if (a.norm === 0 || b.norm === 0) return 0;
  const qa = a.q;
  const qb = b.q;
  const n = Math.min(qa.length, qb.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += (qa[i] ?? 0) * (qb[i] ?? 0);
  return dot / (a.norm * b.norm);
}
