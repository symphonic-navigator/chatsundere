// SPDX-License-Identifier: AGPL-3.0-only
// Bearer-only passkey link endpoints unchanged; join endpoints absorbed the OPAQUE flows.
import type { ServerClient } from '@chatsundere/crypto';
import type {
  JoinFinishRequest,
  JoinFinishResponse,
  JoinStartRequest,
  JoinStartResponse,
  LinkPasskeyFinishRequest,
  LinkPasskeyFinishResponse,
  LinkPasskeyStartRequest,
  LinkPasskeyStartResponse,
  OpaqueLoginFinishRequest,
  OpaqueLoginFinishResponse,
  OpaqueLoginStartRequest,
  OpaqueLoginStartResponse,
  PassphraseChangeFinishRequest,
  PassphraseChangeFinishResponse,
  PassphraseChangeStartRequest,
  PassphraseChangeStartResponse,
  RecoveryFinishRequest,
  RecoveryFinishResponse,
  RecoveryStartRequest,
  RecoveryStartResponse,
  StepUpFinishRequest,
  StepUpFinishResponse,
  StepUpStartRequest,
  StepUpStartResponse,
} from '@chatsundere/shared-types';
import { apiFetch } from './fetch.js';

export const httpServerClient: ServerClient = {
  joinStart: (req: JoinStartRequest, baseUrl: string) =>
    apiFetch<JoinStartResponse>({
      baseUrl,
      path: '/api/v1/join/start',
      json: req,
      authMode: 'none',
    }),
  joinFinish: (req: JoinFinishRequest, baseUrl: string) =>
    apiFetch<JoinFinishResponse>({
      baseUrl,
      path: '/api/v1/join/finish',
      json: req,
      authMode: 'none',
    }),
  linkPasskeyStart: (req: LinkPasskeyStartRequest, baseUrl: string, _accessToken: string) =>
    apiFetch<LinkPasskeyStartResponse>({
      baseUrl,
      path: '/api/v1/link/passkey/start',
      json: req,
      authMode: 'bearer',
    }),
  linkPasskeyFinish: (req: LinkPasskeyFinishRequest, baseUrl: string, _accessToken: string) =>
    apiFetch<LinkPasskeyFinishResponse>({
      baseUrl,
      path: '/api/v1/link/passkey/finish',
      json: req,
      authMode: 'bearer',
    }),
  loginOpaqueStart: (req: OpaqueLoginStartRequest, baseUrl: string) =>
    apiFetch<OpaqueLoginStartResponse>({
      baseUrl,
      path: '/api/v1/opaque/login/start',
      json: req,
      authMode: 'none',
    }),
  loginOpaqueFinish: (req: OpaqueLoginFinishRequest, baseUrl: string) =>
    apiFetch<OpaqueLoginFinishResponse>({
      baseUrl,
      path: '/api/v1/opaque/login/finish',
      json: req,
      authMode: 'none',
    }),
  recoveryStart: (req: RecoveryStartRequest, baseUrl: string) =>
    apiFetch<RecoveryStartResponse>({
      baseUrl,
      path: '/api/v1/recovery/start',
      json: req,
      authMode: 'none',
    }),
  recoveryFinish: (req: RecoveryFinishRequest, baseUrl: string) =>
    apiFetch<RecoveryFinishResponse>({
      baseUrl,
      path: '/api/v1/recovery/finish',
      json: req,
      authMode: 'none',
    }),
  deleteMe: (baseUrl: string, _accessToken: string) =>
    apiFetch<void>({ baseUrl, path: '/api/v1/me', method: 'DELETE', authMode: 'bearer' }),
  passphraseChangeStart: (
    req: PassphraseChangeStartRequest,
    baseUrl: string,
    _accessToken: string,
  ) =>
    apiFetch<PassphraseChangeStartResponse>({
      baseUrl,
      path: '/api/v1/auth-methods/passphrase/change/start',
      json: req,
      authMode: 'bearer',
    }),
  passphraseChangeFinish: (
    req: PassphraseChangeFinishRequest,
    baseUrl: string,
    _accessToken: string,
  ) =>
    apiFetch<PassphraseChangeFinishResponse>({
      baseUrl,
      path: '/api/v1/auth-methods/passphrase/change/finish',
      json: req,
      authMode: 'bearer',
    }),
  stepUpStart: (req: StepUpStartRequest, baseUrl: string, _accessToken: string) =>
    apiFetch<StepUpStartResponse>({
      baseUrl,
      path: '/api/v1/auth/step-up/start',
      json: req,
      authMode: 'bearer',
      skipStepUpGate: true,
    }),
  stepUpFinish: (req: StepUpFinishRequest, baseUrl: string) =>
    apiFetch<StepUpFinishResponse>({
      baseUrl,
      path: '/api/v1/auth/step-up/finish',
      json: req,
      authMode: 'none',
      skipStepUpGate: true,
    }),
};
