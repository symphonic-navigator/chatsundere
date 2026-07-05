// SPDX-License-Identifier: AGPL-3.0-only
import type { StepUpTier } from '@chatsundere/shared-types';
import { requestStepUp, useSessionStore } from '@chatsundere/ui-shared';
import { joinUrl } from './joinUrl.js';

/**
 * Thrown by apiFetch when the server returns a non-2xx response. Network-level
 * failures (DNS, connection refused, CORS reject) bypass this class and
 * surface as plain Error — callers must check `instanceof HttpError` before
 * reading `.status` or `.code`. Admin-client deliberately does not implement
 * silent refresh (spec 2026-07-04 §3); instead, apiFetch clears the expired
 * session on a bearer 401 so the route guard redirects to login.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  baseUrl: string;
  path: string;
  json?: unknown;
  authMode?: 'none' | 'bearer';
  /**
   * Opt-out for the step-up endpoints themselves — the ceremony must never
   * recurse into the step-up gate. Leave unset everywhere else.
   */
  skipStepUpGate?: boolean;
}

export async function apiFetch<T>(opts: ApiFetchOptions): Promise<T> {
  const url = joinUrl(opts.baseUrl, opts.path);
  let res = await fetch(url, buildInit(opts));
  // Step-up gate (ADR 0027): one modal round, one retry, never a loop. The
  // admin-client has no silent refresh, so this branch slots straight after
  // the initial fetch.
  if (res.status === 403 && !opts.skipStepUpGate) {
    const envelope = await safeReadError(res);
    if (envelope?.code === 'step_up_required') {
      const confirmed = await requestStepUp(tierFromEnvelope(envelope));
      if (confirmed) {
        res = await fetch(url, buildInit(opts));
      }
    }
  }
  // No silent refresh here (spec 2026-07-04 §3). A 401 on a bearer call means
  // the access token has expired: clear the stale session so the route guard
  // stops seeing a present-but-dead token and redirects to /login, instead of
  // leaving the operator stuck behind a wall of 401s. `authMode === 'none'`
  // calls (login probes) carry no token — a 401 there is not our session dying.
  if (res.status === 401 && opts.authMode === 'bearer') {
    useSessionStore.getState().closeAndForget();
  }
  if (!res.ok) {
    const envelope = await safeReadError(res);
    throw new HttpError(res.status, envelope?.code, `${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function buildInit(opts: ApiFetchOptions): RequestInit {
  const headers = new Headers(opts.headers);
  if (opts.json !== undefined) headers.set('Content-Type', 'application/json');
  if (opts.authMode === 'bearer') {
    const token = useSessionStore.getState().session?.accessToken;
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  return {
    method: opts.method ?? (opts.json !== undefined ? 'POST' : 'GET'),
    headers,
    credentials: 'include',
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
  };
}

interface ErrorEnvelope {
  code?: string;
  tier?: number;
}

async function safeReadError(res: Response): Promise<ErrorEnvelope | undefined> {
  try {
    const body = (await res.clone().json()) as { error?: ErrorEnvelope };
    return body.error;
  } catch {
    return undefined;
  }
}

/** The server sends the tier numerically (`{ tier: 1 | 3 | 4 }`) — map to the wire enum. */
function tierFromEnvelope(envelope: ErrorEnvelope): StepUpTier {
  if (envelope.tier === 3) return 't3';
  if (envelope.tier === 4) return 't4';
  return 't1';
}
