// SPDX-License-Identifier: LGPL-3.0-only

/**
 * The current algorithm version. Bump when wrap or KDF parameters change
 * in an incompatible way; bumping requires a migration plan.
 */
export const ALGO_VERSION = 'v1';
export const WRAP_ALGO = 'AES-256-GCM';
export const HKDF_HASH = 'SHA-256';

declare const masterKeyBrand: unique symbol;
declare const amkBrand: unique symbol;
declare const dekBrand: unique symbol;
declare const recoveryKeyBrand: unique symbol;

/**
 * A 32-byte symmetric master key that protects every per-user secret.
 * Never persisted to disk, never sent to the server.
 */
export type MasterKey = Uint8Array & { readonly [masterKeyBrand]: 'MasterKey' };

/**
 * Auth-Method Key — derived from a specific auth method's secret and used
 * only to wrap/unwrap the MasterKey.
 */
export type AMK = Uint8Array & { readonly [amkBrand]: 'AMK' };

/**
 * Data Encryption Key — derived from the MasterKey for a specific
 * encryption context (e.g., 'vault/conversations').
 */
export type DEK = Uint8Array & { readonly [dekBrand]: 'DEK' };

/**
 * A 32-byte random key shown to the user once at registration. The user
 * stores it themselves; losing it loses access to data (no server-side
 * recovery exists by design).
 */
export type RecoveryKey = Uint8Array & { readonly [recoveryKeyBrand]: 'RecoveryKey' };

/**
 * A symmetrically-encrypted blob produced by wrapping a key with another key.
 */
export interface WrappedKey {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  algo: string;
}
