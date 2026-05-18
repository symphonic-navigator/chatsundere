// SPDX-License-Identifier: MIT

export interface RecoveryStartRequest {
  username: string;
  /** OPAQUE registration_request for the fresh re-registration under the new passphrase. */
  registration_request: string;
}

export interface RecoveryStartResponse {
  nonce: string;
  wrapped_mk_recovery: string;
  wrap_nonce_recovery: string;
  wrap_aad_recovery: string;
  /** Server-issued OPAQUE registration_response for the fresh re-registration. */
  registration_response: string;
}

export interface RecoveryFinishRequest {
  username: string;
  nonce: string;
  proof: string;
  /** OPAQUE registration record produced by finishRegistration against the server's response. */
  registration_record: string;
  new_wrapped_mk_opaque: string;
  new_wrap_nonce_opaque: string;
  new_wrap_aad_opaque: string;
  new_recovery_verifier_key: string;
  new_wrapped_mk_recovery: string;
  new_wrap_nonce_recovery: string;
  new_wrap_aad_recovery: string;
}

export interface RecoveryFinishResponse {
  user_id: string;
  role: 'primary_admin' | 'admin' | 'user';
  access_token: string;
  expires_in: number;
}
