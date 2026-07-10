// SPDX-License-Identifier: MIT

/** Request body for `POST /api/v1/join/start`. Discriminated by `kind`. */
export type JoinStartRequest =
  | { kind: 'invitation'; code: string; registration_request: string }
  | { kind: 'pairing'; code: string; login_request: string };

/** Response body for `POST /api/v1/join/start`. Discriminated by request kind. */
export type JoinStartResponse =
  | {
      kind: 'invitation';
      session_id: string;
      registration_response: string;
      suggested_username: string | null;
    }
  | {
      kind: 'pairing';
      session_id: string;
      login_response: string;
      username: string;
      /**
       * The frozen OPAQUE client identifier this account registered under
       * (`auth_methods.opaque_client_identifier`), distinct from `username`
       * once the account has been renamed. The joining device must present
       * this value — not `username` — in the OPAQUE login finish, or the
       * AKE evidence will not match what the server bound at `/join/start`.
       * Optional for wire compatibility with older servers that predate
       * this field; a client talking to such a server should fall back to
       * `username`.
       */
      opaque_client_identifier?: string;
    };

/** Request body for `POST /api/v1/join/finish`. Discriminated by `kind`. */
export type JoinFinishRequest =
  | {
      kind: 'invitation';
      session_id: string;
      username: string;
      registration_record: string;
      wrapped_mk_opaque: string;
      wrap_nonce_opaque: string;
      wrap_aad_opaque: string;
      wrapped_mk_recovery: string;
      wrap_nonce_recovery: string;
      wrap_aad_recovery: string;
      recovery_verifier_key: string;
    }
  | {
      kind: 'pairing';
      session_id: string;
      login_evidence: string;
    };

/** Response body for `POST /api/v1/join/finish`. Discriminated by request kind. */
export type JoinFinishResponse =
  | {
      kind: 'invitation';
      user_id: string;
      username: string;
      role: 'primary_admin' | 'admin' | 'user';
      access_token: string;
      expires_in: number;
      is_new_account: true;
    }
  | {
      kind: 'pairing';
      user_id: string;
      username: string;
      role: 'primary_admin' | 'admin' | 'user';
      access_token: string;
      expires_in: number;
      is_new_account: false;
      wrapped_mk_opaque: string;
      wrap_nonce_opaque: string;
      wrap_aad_opaque: string;
    };

/** Error codes the join surface can emit. Used for narrow client-side handling. */
export const JoinError = {
  InvalidCodeFormat: 'invalid_code_format',
  KindMismatch: 'kind_mismatch',
  CodeNotFoundOrExpired: 'code_not_found_or_expired',
  CodeExpired: 'code_expired',
  CodeAlreadyRedeemed: 'code_already_redeemed',
  CodeAttemptsExhausted: 'code_attempts_exhausted',
  RateLimited: 'rate_limited',
  UsernameTaken: 'username_taken',
  OpaqueAuthenticationFailed: 'opaque_authentication_failed',
  SessionExpired: 'session_expired',
  WrappingInvariantViolated: 'wrapping_invariant_violated',
} as const;

export type JoinErrorCode = (typeof JoinError)[keyof typeof JoinError];
