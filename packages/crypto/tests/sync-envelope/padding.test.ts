// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { padPlaintext, unpadPlaintext } from '../../src/sync-envelope/padding.js';

const bytes = (n: number) => new Uint8Array(n).fill(1);

describe('padding', () => {
  it('unpad inverts pad for both modes', () => {
    for (const padded of [true, false]) {
      const out = unpadPlaintext(padPlaintext(bytes(1000), padded));
      expect(out).toEqual(bytes(1000));
    }
  });
  it('bucket edges: 1023/1024/1025 total bytes (incl. the 4-byte prefix)', () => {
    // total = 4 + n, padded to the next power-of-two bucket ≥ 1024
    expect(padPlaintext(bytes(1019), true)).toHaveLength(1024); // 4+1019=1023 → 1024
    expect(padPlaintext(bytes(1020), true)).toHaveLength(1024); // exactly 1024
    expect(padPlaintext(bytes(1021), true)).toHaveLength(2048); // 1025 → 2048
  });
  it('caps at 1 MiB then steps by 256 KiB', () => {
    const oneMiB = 1_048_576;
    expect(padPlaintext(bytes(oneMiB - 4), true)).toHaveLength(oneMiB);
    expect(padPlaintext(bytes(oneMiB), true)).toHaveLength(oneMiB + 262_144);
  });
  it('unpadded mode adds only the prefix', () => {
    expect(padPlaintext(bytes(500), false)).toHaveLength(504);
  });
  it('rejects a corrupt length prefix', () => {
    const p = padPlaintext(bytes(10), true);
    new DataView(p.buffer).setUint32(0, 999999, true);
    expect(() => unpadPlaintext(p)).toThrow();
  });
});
