// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';

import { constantTimeEqual } from '../../src/primitives/constant-time.js';

describe('constantTimeEqual', () => {
  it('returns true for identical buffers', () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 4]);
    expect(constantTimeEqual(a, b)).toBe(true);
  });

  it('returns false for buffers differing in a single byte', () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 5]);
    expect(constantTimeEqual(a, b)).toBe(false);
  });

  it('returns false for buffers of different length', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 3, 4]);
    expect(constantTimeEqual(a, b)).toBe(false);
  });

  it('returns true for empty buffers', () => {
    expect(constantTimeEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true);
  });
});
