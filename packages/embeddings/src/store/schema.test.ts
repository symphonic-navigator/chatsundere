// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { rowBytes } from './schema.js';

describe('rowBytes', () => {
  it('returns a positive size for ordinary metadata', () => {
    expect(rowBytes({ persona: 'p1' }, { salience: 3 }, { note: 'hello' })).toBeGreaterThan(0);
  });

  it('treats absent metadata as zero extra bytes', () => {
    const withMeta = rowBytes({}, {}, { note: 'hello' });
    const without = rowBytes({}, {}, undefined);
    expect(without).toBeLessThan(withMeta);
    expect(without).toBeGreaterThan(0); // still counts the fixed vector size
  });

  // IndexedDB structured-clone can persist values that JSON.stringify throws on.
  // rowBytes must degrade to an estimate rather than blow up the write path.
  it('does not throw on BigInt metadata (structured-clone-valid, non-JSON)', () => {
    expect(() => rowBytes({}, {}, { big: 10n })).not.toThrow();
    expect(rowBytes({}, {}, { big: 10n })).toBeGreaterThan(0);
  });

  it('does not throw on a circular metadata graph', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => rowBytes({}, {}, circular)).not.toThrow();
    expect(rowBytes({}, {}, circular)).toBeGreaterThan(0);
  });
});
