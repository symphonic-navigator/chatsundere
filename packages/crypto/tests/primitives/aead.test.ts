// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { CryptoError } from '../../src/errors.js';
import { aeadDecrypt, aeadEncrypt } from '../../src/primitives/aead.js';
import { asAmk, asMasterKey } from '../../src/types.js';

const KEY = asAmk(Uint8Array.from(Array.from({ length: 32 }, (_, i) => i)));
const MK = asMasterKey(Uint8Array.from(Array.from({ length: 32 }, (_, i) => i + 100)));
const AAD = new TextEncoder().encode('user_x::opaque::v1');

describe('aeadEncrypt / aeadDecrypt', () => {
  it('round-trips plaintext through encrypt then decrypt', async () => {
    const wrapped = await aeadEncrypt(KEY, MK, AAD);
    const decrypted = await aeadDecrypt(KEY, wrapped, AAD);
    expect(Buffer.from(decrypted).equals(Buffer.from(MK))).toBe(true);
  });

  it('rejects tampered ciphertext', async () => {
    const wrapped = await aeadEncrypt(KEY, MK, AAD);
    wrapped.ciphertext[0] = (wrapped.ciphertext[0] as number) ^ 0xff;
    await expect(aeadDecrypt(KEY, wrapped, AAD)).rejects.toBeInstanceOf(CryptoError);
  });

  it('rejects tampered AAD', async () => {
    const wrapped = await aeadEncrypt(KEY, MK, AAD);
    const wrong = new TextEncoder().encode('user_y::opaque::v1');
    await expect(aeadDecrypt(KEY, wrapped, wrong)).rejects.toBeInstanceOf(CryptoError);
  });

  it('rejects tampered nonce', async () => {
    const wrapped = await aeadEncrypt(KEY, MK, AAD);
    wrapped.nonce[0] = (wrapped.nonce[0] as number) ^ 0xff;
    await expect(aeadDecrypt(KEY, wrapped, AAD)).rejects.toBeInstanceOf(CryptoError);
  });

  it('produces different ciphertexts on repeated calls (random nonce)', async () => {
    const a = await aeadEncrypt(KEY, MK, AAD);
    const b = await aeadEncrypt(KEY, MK, AAD);
    expect(Buffer.from(a.nonce).equals(Buffer.from(b.nonce))).toBe(false);
    expect(Buffer.from(a.ciphertext).equals(Buffer.from(b.ciphertext))).toBe(false);
  });
});
