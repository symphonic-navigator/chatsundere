// SPDX-License-Identifier: AGPL-3.0-only
// Implementation note (ADR 0021 — OPAQUE-first linking): the passkey link
// endpoints are bearer-only and refuse passkey-first registration on a fresh
// account. The _accessToken parameter in linkPasskeyStart / linkPasskeyFinish
// is part of the ServerClient interface contract but not forwarded explicitly;
// the auth-aware fetch wrapper reads the token from the session store.
import type { ServerClient } from '@chatsundere/crypto';
import type {
  LinkOpaqueFinishRequest,
  LinkOpaqueFinishResponse,
  LinkOpaqueStartRequest,
  LinkOpaqueStartResponse,
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
} from '@chatsundere/shared-types';
import { apiFetch } from './fetch.js';

export const httpServerClient: ServerClient = {
  linkOpaqueStart: (req: LinkOpaqueStartRequest, baseUrl: string) =>
    apiFetch<LinkOpaqueStartResponse>({
      baseUrl,
      path: '/v1/link/opaque/start',
      json: req,
      authMode: 'none',
    }),
  linkOpaqueFinish: (req: LinkOpaqueFinishRequest, baseUrl: string) =>
    apiFetch<LinkOpaqueFinishResponse>({
      baseUrl,
      path: '/v1/link/opaque/finish',
      json: req,
      authMode: 'none',
    }),
  linkPasskeyStart: (req: LinkPasskeyStartRequest, baseUrl: string, _accessToken: string) =>
    apiFetch<LinkPasskeyStartResponse>({
      baseUrl,
      path: '/v1/link/passkey/start',
      json: req,
      authMode: 'bearer',
    }),
  linkPasskeyFinish: (req: LinkPasskeyFinishRequest, baseUrl: string, _accessToken: string) =>
    apiFetch<LinkPasskeyFinishResponse>({
      baseUrl,
      path: '/v1/link/passkey/finish',
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
};
