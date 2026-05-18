// SPDX-License-Identifier: LGPL-3.0-only

import { CryptoError } from '../errors.js';
import { type AMK, type IntegrityKey, type WrappedKey, asIntegrityKey } from '../types.js';
import { constantTimeEqual } from './constant-time.js';
import { hkdfSha256 } from './kdf.js';

const INTEGRITY_INFO = 'chatsundere-integrity-v1';

/**
 * Derive the integrity HMAC key from an AMK. The resulting key is used
 * to compute the integrity tag over a wrapped MK bundle that lives in
 * IndexedDB.
 */
export async function deriveIntegrityKey(amk: AMK): Promise<IntegrityKey> {
  const bytes = await hkdfSha256(amk, new Uint8Array(), INTEGRITY_INFO);
  return asIntegrityKey(bytes);
}

/** Compute and attach an HMAC-SHA256 over (ciphertext || nonce || aad). */
export async function addIntegrityHmac(
  wrapped: WrappedKey,
  key: IntegrityKey,
): Promise<WrappedKey> {
  const tag = await computeHmac(wrapped, key);
  return { ...wrapped, integrity_hmac: tag };
}

/** Verify the HMAC tag in-place. Throws if the field is absent. */
export async function verifyIntegrityHmac(
  wrapped: WrappedKey,
  key: IntegrityKey,
): Promise<boolean> {
  if (!wrapped.integrity_hmac || wrapped.integrity_hmac.length === 0) {
    throw new CryptoError('integrity_check_failed', 'wrapped key has no integrity tag');
  }
  const expected = await computeHmac(wrapped, key);
  return constantTimeEqual(expected, wrapped.integrity_hmac);
}

async function computeHmac(wrapped: WrappedKey, key: IntegrityKey): Promise<Uint8Array> {
  const subtle = globalThis.crypto.subtle;
  const hmacKey = await subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const buf = concat(wrapped.ciphertext, wrapped.nonce, wrapped.aad);
  const tag = await subtle.sign('HMAC', hmacKey, buf as BufferSource);
  return new Uint8Array(tag);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
