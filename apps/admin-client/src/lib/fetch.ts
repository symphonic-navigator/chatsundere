// SPDX-License-Identifier: AGPL-3.0-only
import { useSessionStore } from '@chatsundere/ui-shared';
import { joinUrl } from './joinUrl.js';

/**
 * Thrown by apiFetch when the server returns a non-2xx response. Network-level
 * failures (DNS, connection refused, CORS reject) bypass this class and
 * surface as plain Error — callers must check `instanceof HttpError` before
 * reading `.status` or `.code`. Admin-client deliberately does not implement
 * silent refresh; on 401 the route guard redirects to login.
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
}

export async function apiFetch<T>(opts: ApiFetchOptions): Promise<T> {
  const url = joinUrl(opts.baseUrl, opts.path);
  const init = buildInit(opts);
  const res = await fetch(url, init);
  if (!res.ok) {
    const code = await safeReadCode(res);
    throw new HttpError(res.status, code, `${res.status} ${res.statusText}`);
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

async function safeReadCode(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.clone().json()) as { error?: { code?: string } };
    return body.error?.code;
  } catch {
    return undefined;
  }
}
