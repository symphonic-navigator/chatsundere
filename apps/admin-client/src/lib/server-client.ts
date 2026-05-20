// SPDX-License-Identifier: AGPL-3.0-only
// Slim ServerClient for admin-client login. Long-term this consolidates into
// ui-shared once both apps share the wire-shape types.
import type { ServerClient } from '@chatsundere/crypto';
import type {
  OpaqueLoginFinishRequest,
  OpaqueLoginFinishResponse,
  OpaqueLoginStartRequest,
  OpaqueLoginStartResponse,
} from '@chatsundere/shared-types';
import { apiFetch } from './fetch.js';

export const httpServerClient: ServerClient = {
  loginOpaqueStart: (req: OpaqueLoginStartRequest, baseUrl: string) =>
    apiFetch<OpaqueLoginStartResponse>({
      baseUrl,
      path: '/v1/opaque/login/start',
      json: req,
      authMode: 'none',
    }),
  loginOpaqueFinish: (req: OpaqueLoginFinishRequest, baseUrl: string) =>
    apiFetch<OpaqueLoginFinishResponse>({
      baseUrl,
      path: '/v1/opaque/login/finish',
      json: req,
      authMode: 'none',
    }),
  linkOpaqueStart: () => {
    throw new Error('not used in admin-client');
  },
  linkOpaqueFinish: () => {
    throw new Error('not used in admin-client');
  },
  linkPasskeyStart: () => {
    throw new Error('not used in admin-client');
  },
  linkPasskeyFinish: () => {
    throw new Error('not used in admin-client');
  },
  recoveryStart: () => {
    throw new Error('not used in admin-client');
  },
  recoveryFinish: () => {
    throw new Error('not used in admin-client');
  },
  deleteMe: () => {
    throw new Error('not used in admin-client');
  },
  passphraseChangeStart: () => {
    throw new Error('not used in admin-client');
  },
  passphraseChangeFinish: () => {
    throw new Error('not used in admin-client');
  },
};
