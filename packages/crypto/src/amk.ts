// SPDX-License-Identifier: LGPL-3.0-only

import { argon2id, hkdfSha256 } from './primitives/kdf.js';
import { type AMK, ARGON2ID_PARAMS, type RecoveryKey, asAmk } from './types.js';

const INFO_LOCAL = 'chatsundere-amk-v1::local';
const INFO_RECOVERY = 'chatsundere-amk-v1::recovery';
const INFO_OPAQUE = 'chatsundere-amk-v1::opaque';
const INFO_PRF_BASE = 'chatsundere-amk-v1::prf::';

/**
 * Derive the local-Auth-Method-Key from the passphrase and per-device salt.
 * The Argon2id cost parameters are application-wide; do not weaken without
 * an ADR.
 */
export async function deriveLocalAmk(passphrase: string, salt: Uint8Array): Promise<AMK> {
  if (salt.length !== ARGON2ID_PARAMS.saltLength) {
    throw new Error(`salt must be ${ARGON2ID_PARAMS.saltLength} bytes`);
  }
  const argonOut = await argon2id(passphrase, salt, ARGON2ID_PARAMS);
  const bytes = await hkdfSha256(argonOut, new Uint8Array(), INFO_LOCAL);
  return asAmk(bytes);
}

/** Derive the recovery-key-derived AMK. */
export async function deriveRecoveryAmk(rk: RecoveryKey): Promise<AMK> {
  const bytes = await hkdfSha256(rk, new Uint8Array(), INFO_RECOVERY);
  return asAmk(bytes);
}

/** Derive the OPAQUE-export-key-derived AMK. */
export async function deriveOpaqueAmk(exportKey: Uint8Array): Promise<AMK> {
  if (exportKey.length === 0) throw new Error('exportKey must be non-empty');
  const bytes = await hkdfSha256(exportKey, new Uint8Array(), INFO_OPAQUE);
  return asAmk(bytes);
}

/**
 * Derive a per-credential PRF-AMK. The credential-id prefix is bound into
 * the info string to prevent a single AMK from being shared across
 * different authenticators registered for the same user.
 */
export async function derivePrfAmk(
  prfOutput: Uint8Array,
  credentialIdPrefix: string,
): Promise<AMK> {
  if (prfOutput.length === 0) throw new Error('prfOutput must be non-empty');
  if (credentialIdPrefix.length === 0) throw new Error('credentialIdPrefix must be non-empty');
  const info = `${INFO_PRF_BASE}${credentialIdPrefix}`;
  const bytes = await hkdfSha256(prfOutput, new Uint8Array(), info);
  return asAmk(bytes);
}
