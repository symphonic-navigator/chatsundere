// SPDX-License-Identifier: LGPL-3.0-only

export type Vector = ArrayLike<number>;

export function dot(a: Vector, b: Vector): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const aVal = a[i];
    const bVal = b[i];
    if (aVal !== undefined && bVal !== undefined) {
      sum += aVal * bVal;
    }
  }
  return sum;
}

export function l2Norm(v: Vector): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    const val = v[i];
    if (val !== undefined) {
      sum += val * val;
    }
  }
  return Math.sqrt(sum);
}

export function cosineSimilarity(a: Vector, b: Vector): number {
  const denom = l2Norm(a) * l2Norm(b);
  return denom === 0 ? 0 : dot(a, b) / denom;
}
