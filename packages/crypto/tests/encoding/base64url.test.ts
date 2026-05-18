// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';

import { fromBase64Url, toBase64Url } from '../../src/encoding/base64url.js';

describe('base64url', () => {
  const cases: Array<[number[], string]> = [
    [[], ''],
    [[0x66], 'Zg'],
    [[0x66, 0x6f], 'Zm8'],
    [[0x66, 0x6f, 0x6f], 'Zm9v'],
    [[0xfb, 0xff, 0xbf], '-_-_'],
  ];

  for (const [bytes, expected] of cases) {
    it(`encodes [${bytes.join(',')}] to "${expected}"`, () => {
      expect(toBase64Url(new Uint8Array(bytes))).toBe(expected);
    });

    it(`decodes "${expected}" back to [${bytes.join(',')}]`, () => {
      const decoded = fromBase64Url(expected);
      expect(Array.from(decoded)).toEqual(bytes);
    });
  }

  it('tolerates input with padding when decoding', () => {
    expect(Array.from(fromBase64Url('Zg=='))).toEqual([0x66]);
  });

  it('produces no padding when encoding', () => {
    expect(toBase64Url(new Uint8Array([0x66]))).not.toContain('=');
  });
});
