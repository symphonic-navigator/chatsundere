// SPDX-License-Identifier: LGPL-3.0-only

import { constantTimeEqual } from './primitives/constant-time.js';
import { hkdfSha256 } from './primitives/kdf.js';
import { type RecoveryKey, type VerifierKey, asVerifierKey } from './types.js';

const INFO_VERIFIER = 'chatsundere-rk-verifier-key-v1';

/**
 * Derive the per-user verifier key. This is what the server stores; the
 * recovery key itself is never sent. To prove possession of the recovery
 * key the client signs a fresh server-issued nonce with HMAC under this
 * key.
 */
export async function deriveVerifierKey(rk: RecoveryKey): Promise<VerifierKey> {
  const bytes = await hkdfSha256(rk, new Uint8Array(), INFO_VERIFIER);
  return asVerifierKey(bytes);
}

/**
 * Compute the recovery proof. The (nonce, username, server_id) tuple is
 * fresh per attempt; replay is blocked server-side by a single-use nonce
 * with 60-second TTL.
 */
export async function computeRecoveryProof(
  rk: RecoveryKey,
  nonce: Uint8Array,
  username: string,
  serverId: string,
): Promise<Uint8Array> {
  const vk = await deriveVerifierKey(rk);
  return signRecoveryMessage(vk, nonce, username, serverId);
}

/** Server-side verification (also re-usable client-side for tests). */
export async function verifyRecoveryProof(
  vk: VerifierKey,
  nonce: Uint8Array,
  username: string,
  serverId: string,
  proof: Uint8Array,
): Promise<boolean> {
  const expected = await signRecoveryMessage(vk, nonce, username, serverId);
  return constantTimeEqual(expected, proof);
}

async function signRecoveryMessage(
  vk: VerifierKey,
  nonce: Uint8Array,
  username: string,
  serverId: string,
): Promise<Uint8Array> {
  const subtle = globalThis.crypto.subtle;
  const key = await subtle.importKey(
    'raw',
    vk as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const message = concat(
    nonce,
    new TextEncoder().encode(username),
    new Uint8Array([0]),
    new TextEncoder().encode(serverId),
  );
  const sig = await subtle.sign('HMAC', key, message as BufferSource);
  return new Uint8Array(sig);
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
