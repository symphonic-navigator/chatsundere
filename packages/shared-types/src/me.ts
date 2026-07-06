// SPDX-License-Identifier: MIT

/** Request body for `POST /v1/auth-methods/passphrase/change/start`. */
export interface PassphraseChangeStartRequest {
  registration_request: string;
}

/** Response body for `POST /v1/auth-methods/passphrase/change/start`. */
export interface PassphraseChangeStartResponse {
  session_id: string;
  registration_response: string;
}

/** Request body for `POST /v1/auth-methods/passphrase/change/finish`. */
export interface PassphraseChangeFinishRequest {
  session_id: string;
  registration_record: string;
  wrapped_mk_opaque: string;
  wrap_nonce_opaque: string;
  wrap_aad_opaque: string;
}

/** Response body for `POST /v1/auth-methods/passphrase/change/finish`. */
export interface PassphraseChangeFinishResponse {
  ok: boolean;
}

/** Request body for `PATCH /api/v1/me` — rename the authenticated user. */
export interface PatchMeRequest {
  username: string;
}

/** Response body for `PATCH /api/v1/me`. */
export interface PatchMeResponse {
  ok: boolean;
}
