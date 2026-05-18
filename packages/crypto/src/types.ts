// SPDX-License-Identifier: LGPL-3.0-only

/**
 * The current algorithm version. Bump when wrap or KDF parameters change
 * in an incompatible way; bumping requires a migration plan and an ADR.
 */
export const ALGO_VERSION = 'v1';
export const WRAP_ALGO = 'AES-256-GCM';
export const HKDF_HASH = 'SHA-256';

/** Argon2id parameters used to derive `local_amk` from the passphrase. */
export const ARGON2ID_PARAMS = {
  memorySizeKiB: 64 * 1024,
  iterations: 3,
  parallelism: 1,
  hashLength: 32,
  saltLength: 16,
} as const;

declare const masterKeyBrand: unique symbol;
declare const amkBrand: unique symbol;
declare const dekBrand: unique symbol;
declare const recoveryKeyBrand: unique symbol;
declare const integrityKeyBrand: unique symbol;
declare const verifierKeyBrand: unique symbol;

export type MasterKey = Uint8Array & { readonly [masterKeyBrand]: 'MasterKey' };
export type AMK = Uint8Array & { readonly [amkBrand]: 'AMK' };
export type DEK = Uint8Array & { readonly [dekBrand]: 'DEK' };
export type RecoveryKey = Uint8Array & { readonly [recoveryKeyBrand]: 'RecoveryKey' };
export type IntegrityKey = Uint8Array & { readonly [integrityKeyBrand]: 'IntegrityKey' };
export type VerifierKey = Uint8Array & { readonly [verifierKeyBrand]: 'VerifierKey' };

/**
 * A symmetrically-encrypted MK blob plus the AAD used at wrap time and an
 * integrity tag bound to the wrapping AMK family. The integrity tag is
 * verified before any unwrap is attempted; it guards against IndexedDB
 * tampering before the user has unlocked the session.
 */
export interface WrappedKey {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  algo: typeof WRAP_ALGO;
  aad: Uint8Array;
  integrity_hmac: Uint8Array;
}

/** Helper used when caller has bytes but no compile-time evidence of the brand. */
export function asMasterKey(bytes: Uint8Array): MasterKey {
  if (bytes.length !== 32) throw new Error('MasterKey must be 32 bytes');
  return bytes as MasterKey;
}

export function asAmk(bytes: Uint8Array): AMK {
  if (bytes.length !== 32) throw new Error('AMK must be 32 bytes');
  return bytes as AMK;
}

export function asDek(bytes: Uint8Array): DEK {
  if (bytes.length !== 32) throw new Error('DEK must be 32 bytes');
  return bytes as DEK;
}

export function asRecoveryKey(bytes: Uint8Array): RecoveryKey {
  if (bytes.length !== 32) throw new Error('RecoveryKey must be 32 bytes');
  return bytes as RecoveryKey;
}

export function asIntegrityKey(bytes: Uint8Array): IntegrityKey {
  if (bytes.length !== 32) throw new Error('IntegrityKey must be 32 bytes');
  return bytes as IntegrityKey;
}

export function asVerifierKey(bytes: Uint8Array): VerifierKey {
  if (bytes.length !== 32) throw new Error('VerifierKey must be 32 bytes');
  return bytes as VerifierKey;
}
