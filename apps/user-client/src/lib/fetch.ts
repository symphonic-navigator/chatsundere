// SPDX-License-Identifier: AGPL-3.0-only
import type { StepUpTier } from '@chatsundere/shared-types';
import { requestStepUp, useAccountLinkStore, useSessionStore } from '@chatsundere/ui-shared';
import { isAuthDegraded, setAuthDegraded } from './auth-degrade.js';

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
  /**
   * Cookie mode. Default `'include'` (the auth-service sets and reads the
   * HTTP-only refresh cookie). Calls to cookie-free services (sync) MUST pass
   * `'omit'`: their CORS deliberately answers without
   * `Access-Control-Allow-Credentials`, so an include-mode request fails the
   * browser's preflight check outright.
   */
  credentials?: 'include' | 'omit';
  /**
   * Who initiated this call, deciding how a definitive refresh refusal is
   * handled (spec §5.2). `'user'` (default) means an interactive path: a refusal
   * logs the user out. `'background'` means the sync engine or another
   * unattended path: a refusal latches auth-degraded instead of destroying the
   * session, so local work survives and the relink affordance is offered.
   */
  origin?: FetchOrigin;
}

/** Provenance of an {@link apiFetch} call — see {@link ApiFetchOptions.origin}. */
export type FetchOrigin = 'user' | 'background';

/**
 * Thrown to background callers whose refresh was definitively refused (§5.2).
 * Not currently raised by apiFetch itself (a refused background refresh returns
 * a normal HttpError to the caller); exported for background paths that want a
 * dedicated signal after {@link refreshAccessToken} returns false while
 * {@link isAuthDegraded} is set.
 */
export class AuthDegradedError extends Error {
  constructor() {
    super('The server no longer recognises this session.');
    this.name = 'AuthDegradedError';
  }
}

export async function apiFetch<T>(opts: ApiFetchOptions): Promise<T> {
  const url = joinUrl(opts.baseUrl, opts.path);
  let res = await fetch(url, buildInit(opts));
  if (res.status === 401 && opts.authMode === 'bearer') {
    // The refresh endpoint and its HTTP-only cookie live on the AUTH origin —
    // a call against another service (sync) must not refresh against itself.
    const authBase = useAccountLinkStore.getState().baseUrl ?? opts.baseUrl;
    const refreshed = await refreshAccessToken(authBase, opts.origin ?? 'user');
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
    credentials: opts.credentials ?? 'include',
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
  };
}

/**
 * The outcome of a single refresh attempt (spec §5.2):
 *  - `'ok'`          — the server rotated the cookie and returned a fresh token.
 *  - `'refused'`     — the server DEFINITIVELY refused (401 `unauthorized`): the
 *                      refresh token is invalid or revoked. Authority is real.
 *  - `'unreachable'` — we could not get a definitive answer (network throw, 5xx,
 *                      429, unparseable body, or any other status). The server
 *                      never asserted authority, so nothing may be destroyed.
 */
type RefreshOutcome = 'ok' | 'refused' | 'unreachable';

/**
 * The single shared in-flight refresh. A 401 storm (many parallel calls all
 * hitting an expired access token at once) collapses into one round-trip: the
 * first caller starts the fetch, the rest await the same promise. Cleared in a
 * `finally` so the next expiry starts fresh.
 */
let refreshInFlight: Promise<RefreshOutcome> | null = null;

/**
 * Serialise the refresh round-trip across all same-origin tabs. Two tabs
 * refreshing concurrently present the same refresh token to the server, which
 * reads that as reuse and revokes the whole family (F3). An exclusive, blocking
 * Web Lock makes the second tab wait, so each refresh presents the current
 * (already-rotated) cookie — no concurrent reuse. Falls back to a direct call
 * where navigator.locks is unavailable (jsdom, older engines); the module-local
 * refreshInFlight guard still collapses a within-tab 401 storm.
 */
async function withRefreshLock(fn: () => Promise<RefreshOutcome>): Promise<RefreshOutcome> {
  const locks = globalThis.navigator?.locks;
  if (locks && typeof locks.request === 'function') {
    // Exclusive (default mode), blocking — the second tab waits, it does not skip.
    return locks.request('chatsundere-token-refresh', fn);
  }
  return fn();
}

/**
 * Perform one refresh round-trip and classify it. On success the new access
 * token is applied to the session store here (once, shared by all awaiters); the
 * refused/unreachable decision on what to do about it is left to
 * {@link refreshAccessToken}, which alone knows the caller's origin.
 */
async function classifyRefresh(baseUrl: string): Promise<RefreshOutcome> {
  try {
    const url = joinUrl(baseUrl, '/api/v1/token/refresh');
    const res = await fetch(url, { method: 'POST', credentials: 'include' });
    if (res.ok) {
      const body = (await res.json()) as { access_token: string; expires_in: number };
      useSessionStore.getState().updateAccessToken(body.access_token);
      return 'ok';
    }
    // The auth service emits exactly ONE refusal shape: HTTP 401 with envelope
    // code `unauthorized` (auth-service token route). Only that is authority;
    // every other 401 (or non-401) is treated as unreachable — we refuse to
    // destroy a session on an ambiguous answer.
    if (res.status === 401) {
      const envelope = await safeReadError(res);
      if (envelope?.code === 'unauthorized') return 'refused';
    }
    return 'unreachable';
  } catch {
    // Network-level failure (DNS, connection refused, CORS reject, offline).
    return 'unreachable';
  }
}

/**
 * Refresh the account access token via the HTTP-only refresh cookie. Exported so
 * the proxy auth source (lib/proxy-auth.ts) can share the one refresh path on a
 * proxied 401. SINGLE-FLIGHTED: concurrent callers share one round-trip.
 *
 * Returns true on success. On failure the action depends on how definitive the
 * refusal was and who asked (spec §5.2):
 *  - definitive refusal + `'user'`       → close-and-forget the session (logout).
 *  - definitive refusal + `'background'` → latch auth-degraded, keep the session;
 *    local work continues and the relink affordance is surfaced.
 *  - unreachable (any origin)            → nothing destroyed; connectivity
 *    handling owns transient failure.
 * A success also clears a previously latched auth-degraded state.
 */
export async function refreshAccessToken(
  baseUrl: string,
  origin: FetchOrigin = 'user',
): Promise<boolean> {
  refreshInFlight ??= withRefreshLock(() => classifyRefresh(baseUrl)).finally(() => {
    refreshInFlight = null;
  });
  const outcome = await refreshInFlight;
  if (outcome === 'ok') {
    if (isAuthDegraded()) await setAuthDegraded(false);
    return true;
  }
  if (outcome === 'refused') {
    if (origin === 'background') {
      await setAuthDegraded(true);
      return false;
    }
    // Per 2026-05-18 refresh-reuse deferral: an interactive definitive refusal
    // silently logs out. Surfacing a "session stolen" banner is deferred.
    useSessionStore.getState().closeAndForget();
    return false;
  }
  // Unreachable: the server never asserted authority; destroy nothing.
  return false;
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
