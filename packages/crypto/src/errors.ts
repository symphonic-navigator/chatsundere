// SPDX-License-Identifier: LGPL-3.0-only

export type CryptoErrorCode =
  | 'wrong_passphrase'
  | 'wrong_password'
  | 'wrong_recovery_key'
  | 'passkey_not_available'
  | 'prf_not_supported'
  | 'corrupted_data'
  | 'expired_state'
  | 'invalid_recovery_key_format'
  | 'integrity_check_failed'
  | 'runtime_unsupported'
  | 'opaque_protocol_error'
  | 'webauthn_verification_failed'
  | 'webauthn_sign_counter_rollback'
  | 'db_schema_mismatch'
  | 'staging_inconsistent'
  | 'not_found'
  | 'local_account_exists'
  | 'invalid_input'
  | 'conflict'
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
