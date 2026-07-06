// SPDX-License-Identifier: MIT

import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/types';

/**
 * Step-up tiers accepted by POST /api/v1/auth/step-up/start (ADR 0027).
 * t2 is reserved with no enforcing endpoint; t0 is not a step-up tier.
 */
export type StepUpTier = 't1' | 't3' | 't4';

/** Step-up mechanisms per ADR 0027: A (WebAuthn UV=required) and B (OPAQUE). */
export type StepUpMechanism = 'webauthn' | 'opaque';

/** Request body for `POST /api/v1/auth/step-up/start` (bearer-authorised). */
export interface StepUpStartRequest {
  mechanism: StepUpMechanism;
  tier_requested: StepUpTier;
  /** base64url OPAQUE KE1 — required for mechanism=opaque. */
  login_request?: string;
}

/** Response for mechanism=webauthn start. */
export interface StepUpStartWebAuthnResponse {
  session_id: string;
  mechanism: 'webauthn';
  options: PublicKeyCredentialRequestOptionsJSON;
}

/** Response for mechanism=opaque start. */
export interface StepUpStartOpaqueResponse {
  session_id: string;
  mechanism: 'opaque';
  /** base64url OPAQUE KE2. */
  login_response: string;
}

export type StepUpStartResponse = StepUpStartWebAuthnResponse | StepUpStartOpaqueResponse;

/** Request body for `POST /api/v1/auth/step-up/finish` (no bearer — round-state bound). */
export interface StepUpFinishRequest {
  mechanism: StepUpMechanism;
  session_id: string;
  /** @simplewebauthn assertion envelope — required for mechanism=webauthn. */
  assertion?: AuthenticationResponseJSON;
  /** base64url OPAQUE KE3 — required for mechanism=opaque. */
  login_evidence?: string;
}

/** Success response of `POST /api/v1/auth/step-up/finish`. */
export interface StepUpFinishResponse {
  tier_confirmed: StepUpTier;
  expires_at: string;
}
