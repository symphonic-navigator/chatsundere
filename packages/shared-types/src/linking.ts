// SPDX-License-Identifier: MIT

import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/types';

import type { ServerAuthMethodType } from './auth.js';

/** Request body for `POST /v1/link/opaque/start`. */
export interface LinkOpaqueStartRequest {
  invitation_token: string;
  registration_request: string;
}

/** Response body for `POST /v1/link/opaque/start`. */
export interface LinkOpaqueStartResponse {
  session_id: string;
  registration_response: string;
}

/** Request body for `POST /v1/link/opaque/finish`. */
export interface LinkOpaqueFinishRequest {
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

/** Response body for `POST /v1/link/opaque/finish`. */
export interface LinkOpaqueFinishResponse {
  user_id: string;
  role: 'primary_admin' | 'admin' | 'user';
  access_token: string;
  expires_in: number;
}

/** Request body for `POST /v1/link/passkey/start`. */
export interface LinkPasskeyStartRequest {
  invitation_token?: string;
}

/** Response body for `POST /v1/link/passkey/start`. */
export interface LinkPasskeyStartResponse {
  session_id: string;
  options: PublicKeyCredentialCreationOptionsJSON;
}

/** Request body for `POST /v1/link/passkey/finish`. */
export interface LinkPasskeyFinishRequest {
  session_id: string;
  invitation_token?: string;
  credential: RegistrationResponseJSON;
  label: string;
  wrapped_mk_passkey: string;
  wrap_nonce_passkey: string;
  wrap_aad_passkey: string;
  /** Required on first-ever link, omitted when adding a passkey post-link. */
  wrapped_mk_opaque?: string;
  wrap_nonce_opaque?: string;
  wrap_aad_opaque?: string;
  wrapped_mk_recovery?: string;
  wrap_nonce_recovery?: string;
  wrap_aad_recovery?: string;
  recovery_verifier_key?: string;
  username?: string;
}

/** Response body for `POST /v1/link/passkey/finish`. */
export interface LinkPasskeyFinishResponse extends LinkOpaqueFinishResponse {
  auth_method_id: string;
  method_type: ServerAuthMethodType;
}

/** Re-exported WebAuthn JSON shapes from @simplewebauthn/types for convenience. */
export type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
};
