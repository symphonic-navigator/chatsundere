// SPDX-License-Identifier: LGPL-3.0-only
import { describe, it } from 'bun:test';
import * as fc from 'fast-check';
import { CryptoError } from '../../src/errors.js';
import { aeadDecrypt, aeadEncrypt } from '../../src/primitives/aead.js';
import { asAmk } from '../../src/types.js';

describe('wrap round-trip (property)', () => {
  it('encrypt then decrypt is identity', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 256 }),
        fc.uint8Array({ minLength: 1, maxLength: 64 }),
        async (plaintext, aadBytes) => {
          const key = asAmk(Uint8Array.from(Array.from({ length: 32 }, (_, i) => i + 1)));
          const w = await aeadEncrypt(key, plaintext, aadBytes);
          const back = await aeadDecrypt(key, w, aadBytes);
          return Buffer.from(back).equals(Buffer.from(plaintext));
        },
      ),
      { numRuns: 30 },
    );
  });

  it('tampering ciphertext makes decrypt fail', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 1, maxLength: 64 }), async (plaintext) => {
        const key = asAmk(Uint8Array.from(Array.from({ length: 32 }, (_, i) => i)));
        const aad = new TextEncoder().encode('aad');
        const w = await aeadEncrypt(key, plaintext, aad);
        w.ciphertext[0] = (w.ciphertext[0] as number) ^ 0xff;
        try {
          await aeadDecrypt(key, w, aad);
          return false;
        } catch (err) {
          return err instanceof CryptoError;
        }
      }),
      { numRuns: 20 },
    );
  });
});
