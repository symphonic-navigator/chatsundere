// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { decodeRow, encodeRow } from '../../src/sync-envelope/codec.js';

describe('sync codec', () => {
  it('round-trips a row with nested Uint8Array fields (EncryptedBlob shape)', () => {
    const row = {
      id: 'p1',
      apiKey: { ciphertext: new Uint8Array([1, 2, 255]), nonce: new Uint8Array(12) },
      name: 'wafer',
      updatedAt: 1730000000000,
    };
    const out = decodeRow(encodeRow(row)) as typeof row;
    expect(out.apiKey.ciphertext).toBeInstanceOf(Uint8Array);
    expect([...out.apiKey.ciphertext]).toEqual([1, 2, 255]);
    expect(out).toEqual(row);
  });
  it('round-trips vectors-shaped rows (codes/scales/offsets)', () => {
    const row = {
      id: 'd1#0',
      codes: new Uint8Array(64),
      scales: new Uint8Array(8),
      tags: ['lib1'],
    };
    expect(decodeRow(encodeRow(row))).toEqual(row);
  });
  it('rejects a Blob value', () => {
    expect(() => encodeRow({ blob: new Blob(['x']) })).toThrow();
  });
  it('rejects an ArrayBuffer value', () => {
    expect(() => encodeRow({ buf: new ArrayBuffer(8) })).toThrow();
  });
  it('rejects a reserved $bytes key in input', () => {
    expect(() => encodeRow({ nested: { $bytes: 'sneaky' } })).toThrow();
  });
});
