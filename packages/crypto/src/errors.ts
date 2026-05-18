// SPDX-License-Identifier: LGPL-3.0-only

export type CryptoErrorCode =
  | 'wrong_passphrase'
  | 'wrong_recovery_key'
  | 'passkey_not_available'
  | 'prf_not_supported'
  | 'corrupted_data'
  | 'expired_state'
  | 'invalid_recovery_key_format'
  | 'internal';

/**
 * The only error class exposed by @chatsundere/crypto. Carries a stable
 * machine-readable code; the human-readable message must never contain
 * cryptographic material.
 */
export class CryptoError extends Error {
  constructor(
    public readonly code: CryptoErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CryptoError';
  }
}
