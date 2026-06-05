// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { cosineSimilarity, dot, l2Norm } from './similarity.js';

describe('similarity', () => {
  it('dot computes the inner product', () => {
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32);
  });

  it('l2Norm computes the Euclidean length', () => {
    expect(l2Norm([3, 4])).toBe(5);
  });

  it('cosineSimilarity is 1 for identical direction', () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 6);
  });

  it('cosineSimilarity is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('cosineSimilarity returns 0 when either vector is zero-length', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});
