// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';

import { decodeRecoveryKey, encodeRecoveryKey } from '../../src/encoding/recovery-key.js';
import { CryptoError } from '../../src/errors.js';
import { asRecoveryKey } from '../../src/types.js';

const FIXED_KEY = asRecoveryKey(
  Uint8Array.from(Array.from({ length: 32 }, (_, i) => (i * 31 + 7) & 0xff)),
);

describe('recovery-key encoding', () => {
  it('round-trips through encode then decode', () => {
    const encoded = encodeRecoveryKey(FIXED_KEY);
    const decoded = decodeRecoveryKey(encoded);
    expect(Buffer.from(decoded).equals(Buffer.from(FIXED_KEY))).toBe(true);
  });

  it('formats with four-character dash-separated groups', () => {
    const encoded = encodeRecoveryKey(FIXED_KEY);
    const stripped = encoded.replace(/-/g, '');
    expect(encoded.split('-').every((g) => g.length === 4 || encoded.endsWith(g))).toBe(true);
    expect(stripped).toMatch(/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]+$/);
  });

  it('is case-insensitive and tolerant of separators on decode', () => {
    const encoded = encodeRecoveryKey(FIXED_KEY).toLowerCase().replaceAll('-', ' ');
    const decoded = decodeRecoveryKey(encoded);
    expect(Buffer.from(decoded).equals(Buffer.from(FIXED_KEY))).toBe(true);
  });

  it('rejects strings with an invalid checksum', () => {
    const encoded = encodeRecoveryKey(FIXED_KEY);
    const tampered = encoded.slice(0, -1) + (encoded.endsWith('A') ? 'B' : 'A');
    expect(() => decodeRecoveryKey(tampered)).toThrow(CryptoError);
  });

  it('rejects strings containing letters outside the Crockford alphabet', () => {
    expect(() => decodeRecoveryKey('IIII-IIII-IIII-IIII-IIII-IIII-XX')).toThrow(CryptoError);
  });
});
