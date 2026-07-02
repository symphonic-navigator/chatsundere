// SPDX-License-Identifier: AGPL-3.0-only
import type { StepUpTier } from '@chatsundere/shared-types';
import { requestStepUp, useSessionStore } from '@chatsundere/ui-shared';

/**
 * Thrown by apiFetch when the server returns a non-2xx response. Network-level
 * failures (DNS, connection refused, CORS reject) bypass this class and surface
 * as plain Error — UI callers must check `instanceof HttpError` before reading
 * `.status`, `.code`, or `.retryAfterSeconds`.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
    readonly retryAfterSeconds?: number,
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
  if (res.status === 401 && opts.authMode === 'bearer') {
    const refreshed = await refreshAccessToken(opts.baseUrl);
    if (refreshed) {
      res = await fetch(url, buildInit(opts));
    }
  }
  // Step-up gate (ADR 0027): one modal round, one retry, never a loop.
  if (res.status === 403 && !opts.skipStepUpGate) {
    const envelope = await safeReadError(res);
    if (envelope?.code === 'step_up_required') {
      const confirmed = await requestStepUp(tierFromEnvelope(envelope));
      if (confirmed) {
        res = await fetch(url, buildInit(opts));
      }
    }
  }
  if (!res.ok) {
    const envelope = await safeReadError(res);
    const retryAfter = parseRetryAfter(res.headers.get('Retry-After'));
    throw new HttpError(res.status, envelope?.code, `${res.status} ${res.statusText}`, retryAfter);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Concatenate a server `baseUrl` with an API `path` so that a baseUrl-embedded
 * path prefix is preserved.
 *
 * The `new URL(path, base)` constructor treats an absolute `path` (one starting
 * with `/`) as a replacement of base's path — so `new URL('/auth', 'https://x/api')`
 * yields `https://x/auth`, silently dropping the `/api` prefix. Path-routed
 * deployments (e.g. a server reached at `https://example.com/chatsundere`) need
 * the prefix kept, so we concatenate explicitly and normalise the seam.
 */
export function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const rel = path.startsWith('/') ? path : `/${path}`;
  return `${base}${rel}`;
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

/**
 * Refresh the account access token via the HTTP-only refresh cookie. Exported
 * so the proxy auth source (lib/proxy-auth.ts) can share the one refresh path
 * on a proxied 401. Returns true on success; on failure it closes-and-forgets
 * the session (per the 2026-05-18 refresh-reuse deferral) and returns false.
 */
export async function refreshAccessToken(baseUrl: string): Promise<boolean> {
  try {
    const url = joinUrl(baseUrl, '/api/v1/token/refresh');
    const res = await fetch(url, { method: 'POST', credentials: 'include' });
    if (!res.ok) {
      // Per 2026-05-18 refresh-reuse deferral: when the server returns
      // refresh_token.reuse_detected we silently log out. Surfacing a
      // "session stolen" banner is deferred to phase 1.
      useSessionStore.getState().closeAndForget();
      return false;
    }
    const body = (await res.json()) as { access_token: string; expires_in: number };
    useSessionStore.getState().updateAccessToken(body.access_token);
    return true;
  } catch {
    useSessionStore.getState().closeAndForget();
    return false;
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const asInt = Number.parseInt(value, 10);
  if (Number.isFinite(asInt) && asInt > 0) return asInt;
  return undefined;
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
