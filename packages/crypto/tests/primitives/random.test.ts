// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';

import { getRandomBytes } from '../../src/primitives/random.js';

describe('getRandomBytes', () => {
  it('returns a Uint8Array of the requested length', () => {
    const bytes = getRandomBytes(32);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(32);
  });

  it('returns different values on successive calls (overwhelmingly likely)', () => {
    const a = getRandomBytes(32);
    const b = getRandomBytes(32);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('rejects non-positive lengths', () => {
    expect(() => getRandomBytes(0)).toThrow();
    expect(() => getRandomBytes(-1)).toThrow();
  });
});
