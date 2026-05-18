// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { CryptoError } from '../../src/errors.js';
import { aeadEncrypt } from '../../src/primitives/aead.js';
import {
  addIntegrityHmac,
  deriveIntegrityKey,
  verifyIntegrityHmac,
} from '../../src/primitives/integrity.js';
import { asAmk, asMasterKey } from '../../src/types.js';

const AMK = asAmk(Uint8Array.from(Array.from({ length: 32 }, (_, i) => i)));
const MK = asMasterKey(Uint8Array.from(Array.from({ length: 32 }, (_, i) => i + 200)));
const AAD = new TextEncoder().encode('user_x::opaque::v1');

describe('integrity hmac', () => {
  it('verifies a freshly-tagged wrapped key', async () => {
    const wrapped = await aeadEncrypt(AMK, MK, AAD);
    const ik = await deriveIntegrityKey(AMK);
    const tagged = await addIntegrityHmac(wrapped, ik);
    await expect(verifyIntegrityHmac(tagged, ik)).resolves.toBe(true);
  });

  it('rejects a wrapped key whose ciphertext was tampered with', async () => {
    const wrapped = await aeadEncrypt(AMK, MK, AAD);
    const ik = await deriveIntegrityKey(AMK);
    const tagged = await addIntegrityHmac(wrapped, ik);
    tagged.ciphertext[0] = (tagged.ciphertext[0] as number) ^ 0xff;
    await expect(verifyIntegrityHmac(tagged, ik)).resolves.toBe(false);
  });

  it('rejects a wrapped key whose AAD was tampered with', async () => {
    const wrapped = await aeadEncrypt(AMK, MK, AAD);
    const ik = await deriveIntegrityKey(AMK);
    const tagged = await addIntegrityHmac(wrapped, ik);
    tagged.aad = new TextEncoder().encode('user_y::opaque::v1');
    await expect(verifyIntegrityHmac(tagged, ik)).resolves.toBe(false);
  });

  it('throws if the integrity hmac field is empty', async () => {
    const wrapped = await aeadEncrypt(AMK, MK, AAD);
    const ik = await deriveIntegrityKey(AMK);
    expect(() => verifyIntegrityHmac(wrapped, ik)).toThrow(CryptoError);
  });
});
