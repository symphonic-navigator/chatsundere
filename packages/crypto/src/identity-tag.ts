// SPDX-License-Identifier: LGPL-3.0-only
import { deriveDek } from './dek.js';
import type { DEK, MasterKey } from './types.js';

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * One-way identity tag from an already-derived identity DEK. Lets a caller that
 * holds an encapsulated session (which exposes `deriveDek` but never the raw
 * MasterKey) compute the same tag as {@link deriveIdentityTag} — the client-data
 * guard uses this so it works on every unlock path (passphrase, passkey,
 * recovery), none of which need surface the raw MasterKey.
 */
export function identityTagFromDek(dek: DEK): Promise<string> {
  return sha256Hex(dek);
}

/**
 * Derive a deterministic, non-secret identity tag from a MasterKey, scoped by
 * `context`. The tag is the SHA-256 of a context-separated HKDF sub-key
 * (`deriveDek`), so it is one-way — it reveals neither the MasterKey nor the raw
 * DEK — yet stable per identity and distinct across identities.
 *
 * Used to bind a local store to the identity that owns it: a tag that does not
 * match the current session's MasterKey at boot means the store belongs to a
 * different identity and must be wiped (client-data identity isolation). The tag
 * stays on-device and is never sent to a server.
 *
 * Throws on an empty `context` (via `deriveDek`).
 */
export async function deriveIdentityTag(mk: MasterKey, context: string): Promise<string> {
  return identityTagFromDek(await deriveDek(mk, context));
}
