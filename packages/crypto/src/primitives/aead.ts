// SPDX-License-Identifier: LGPL-3.0-only

import { CryptoError } from '../errors.js';
import { type AMK, WRAP_ALGO, type WrappedKey } from '../types.js';
import { getRandomBytes } from './random.js';

const NONCE_BYTES = 12;

/**
 * Wrap `plaintext` under `key` (AES-256-GCM, random 12-byte nonce). The
 * provided AAD is bound into the auth tag and must be presented verbatim
 * at unwrap time. Returns a WrappedKey with an UNSET integrity_hmac field
 * — call `addIntegrityHmac` from `./integrity` before persisting.
 */
export async function aeadEncrypt(
  key: AMK,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Promise<WrappedKey> {
  const nonce = getRandomBytes(NONCE_BYTES);
  const subtle = globalThis.crypto.subtle;
  const cryptoKey = await subtle.importKey('raw', key as BufferSource, { name: 'AES-GCM' }, false, [
    'encrypt',
  ]);
  const buf = await subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as BufferSource, additionalData: aad as BufferSource },
    cryptoKey,
    plaintext as BufferSource,
  );
  return {
    ciphertext: new Uint8Array(buf),
    nonce,
    algo: WRAP_ALGO,
    aad,
    integrity_hmac: new Uint8Array(),
  };
}

/**
 * Unwrap a WrappedKey under `key`. AAD must match the wrap-time value
 * exactly. Throws CryptoError('corrupted_data') on auth-tag failure.
 */
export async function aeadDecrypt(
  key: AMK,
  wrapped: WrappedKey,
  aad: Uint8Array,
): Promise<Uint8Array> {
  if (wrapped.algo !== WRAP_ALGO) {
    throw new CryptoError('corrupted_data', `unexpected wrap algorithm ${wrapped.algo}`);
  }
  const subtle = globalThis.crypto.subtle;
  const cryptoKey = await subtle.importKey('raw', key as BufferSource, { name: 'AES-GCM' }, false, [
    'decrypt',
  ]);
  try {
    const buf = await subtle.decrypt(
      { name: 'AES-GCM', iv: wrapped.nonce as BufferSource, additionalData: aad as BufferSource },
      cryptoKey,
      wrapped.ciphertext as BufferSource,
    );
    return new Uint8Array(buf);
  } catch {
    throw new CryptoError('corrupted_data', 'AEAD decryption failed');
  }
}
