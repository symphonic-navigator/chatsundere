// SPDX-License-Identifier: AGPL-3.0-only
import { useSessionStore } from '@chatsundere/ui-shared';

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
}

export async function apiFetch<T>(opts: ApiFetchOptions): Promise<T> {
  const url = joinUrl(opts.baseUrl, opts.path);
  const init = buildInit(opts);
  let res = await fetch(url, init);
  if (res.status === 401 && opts.authMode === 'bearer') {
    const refreshed = await tryRefresh(opts.baseUrl);
    if (refreshed) {
      res = await fetch(url, buildInit(opts));
    }
  }
  if (!res.ok) {
    const code = await safeReadCode(res);
    const retryAfter = parseRetryAfter(res.headers.get('Retry-After'));
    throw new HttpError(res.status, code, `${res.status} ${res.statusText}`, retryAfter);
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

async function tryRefresh(baseUrl: string): Promise<boolean> {
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

async function safeReadCode(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.clone().json()) as { error?: { code?: string } };
    return body.error?.code;
  } catch {
    return undefined;
  }
}
