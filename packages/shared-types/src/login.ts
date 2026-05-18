// SPDX-License-Identifier: MIT

import type { UserRole } from './auth.js';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from './linking.js';

export interface OpaqueLoginStartRequest {
  username: string;
  ke1: string;
}

export interface OpaqueLoginStartResponse {
  session_id: string;
  ke2: string;
  wrapped_mk_opaque: string;
  wrap_nonce_opaque: string;
  wrap_aad_opaque: string;
}

export interface OpaqueLoginFinishRequest {
  session_id: string;
  ke3: string;
}

export interface OpaqueLoginFinishResponse {
  user_id: string;
  role: UserRole;
  access_token: string;
  expires_in: number;
}

export interface PasskeyLoginStartRequest {
  username?: string;
}

export interface PasskeyLoginStartResponse {
  session_id: string;
  options: PublicKeyCredentialRequestOptionsJSON;
}

export interface PasskeyLoginFinishRequest {
  session_id: string;
  credential: AuthenticationResponseJSON;
}

export interface PasskeyLoginFinishResponse extends OpaqueLoginFinishResponse {
  wrapped_mk_passkey: string;
  wrap_nonce_passkey: string;
  wrap_aad_passkey: string;
}
