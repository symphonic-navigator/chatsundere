// SPDX-License-Identifier: LGPL-3.0-only
import { getProxyAuthSource } from './proxy-auth.js';
import type { ProviderConfig } from './types.js';

/** Callback interface for observing resolved request and response data without re-implementing transport. */
export interface StreamDiagnosticsSink {
  onRequest(info: { method: string; url: string; headers: Record<string, string> }): void;
  onResponse(info: { status: number; statusText: string; headers: Record<string, string> }): void;
}

const SECRET_REQUEST_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'api-key',
  'x-chatsundere-authorization',
]);

/** Returns a plain object copy of `headers` with all secret-bearing headers removed. */
export function redactRequestHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (SECRET_REQUEST_HEADERS.has(key.toLowerCase())) return;
    out[key.toLowerCase()] = value;
  });
  return out;
}

const ALLOWED_RESPONSE_HEADERS = new Set([
  'content-type',
  'content-encoding',
  'transfer-encoding',
  'cache-control',
  'server',
  'via',
  'cf-ray',
  'x-request-id',
  'retry-after',
  'date',
]);

/** Returns a plain object containing only the allowlisted diagnostic response headers. */
export function pickResponseHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (ALLOWED_RESPONSE_HEADERS.has(key.toLowerCase())) out[key.toLowerCase()] = value;
  });
  return out;
}

/**
 * Thrown when a provider requires the account proxy but the device has no
 * discovered proxy URL / no account token — the user-facing remedy is
 * linking the account.
 */
export class ProxyUnavailableError extends Error {
  readonly missing: 'proxy_url' | 'account_token';

  constructor(missing: 'proxy_url' | 'account_token', message: string) {
    super(message);
    this.name = 'ProxyUnavailableError';
    this.missing = missing;
  }
}

/**
 * Whether a proxy round-trip is possible right now — a URL and an account token
 * are both registered. Used where proxying is decided by the TARGET rather than
 * by the provider row (see `buildSignedUrlGet`).
 */
export function canRouteThroughProxy(): boolean {
  const source = getProxyAuthSource();
  return (source?.getUrl() ?? null) !== null && (source?.getToken() ?? null) !== null;
}

/**
 * Build a header-free GET for an ABSOLUTE url that is already authorised by its
 * own signature — today the pre-signed R2 links nano-gpt returns from
 * `/images/generations`.
 *
 * Deliberately carries **no `Authorization`**: the URL is AWS-V4 signed and a
 * Bearer token collides with the signature (spec §5.2). Only `host` is inside
 * `X-Amz-SignedHeaders`, so routing through the proxy leaves the signature
 * intact — the proxy forwards to `target.origin + request-path`, which
 * reproduces the host exactly.
 *
 * Proxying is not optional on a deployed origin: nano-gpt's R2 bucket answers a
 * cross-origin GET with **no CORS headers at all** unless the Origin is
 * localhost (measured 2026-07-26), so a browser on any real domain cannot read
 * the bytes.
 *
 * Crucially, `proxied` here is decided by the **target**, not by the provider
 * row. nano-gpt's own API is CORS-friendly and therefore correctly routed
 * `direct` (`corsHint: 'inofficial'`) — but its storage bucket is a different
 * host with a different policy. Keying this off the provider's routing was the
 * first fix's mistake and left the bug fully intact in production: the branch
 * simply never ran.
 */
export function buildSignedUrlGet(absoluteUrl: string, opts: { proxied: boolean }): Request {
  if (!opts.proxied) return new Request(absoluteUrl, { method: 'GET' });

  const source = getProxyAuthSource();
  const proxyUrl = source?.getUrl() ?? null;
  const token = source?.getToken() ?? null;
  if (proxyUrl === null) {
    throw new ProxyUnavailableError(
      'proxy_url',
      'transport: cors-proxy routing selected but no proxy is available',
    );
  }
  if (token === null) {
    throw new ProxyUnavailableError(
      'account_token',
      'transport: cors-proxy routing selected but no account token is available',
    );
  }
  const upstream = new URL(absoluteUrl);
  return new Request(joinUrl(proxyUrl, `${upstream.pathname}${upstream.search}`), {
    method: 'GET',
    headers: new Headers({
      'x-chatsundere-authorization': `Bearer ${token}`,
      'x-cors-proxy-target': upstream.origin,
    }),
    // The browser must never chase an upstream redirect off-proxy (spec §5).
    redirect: 'manual',
  });
}

export interface BuildRequestArgs {
  provider: ProviderConfig;
  apiKey: string;
  path: string;
  method: 'GET' | 'POST';
  body?: unknown;
  /**
   * Adapter-supplied extra headers, merged on top of the base
   * Authorisation/Content-Type (and any cors-proxy headers). The adapter owns
   * these — e.g. wafer's `Wafer-ZDR: required`.
   */
  extraHeaders?: Record<string, string>;
  /** Optional sink for observing the resolved request and response for debugging purposes. */
  onDiagnostics?: StreamDiagnosticsSink;
}

/**
 * Build a fetch-ready Request for the given provider. The Request's URL
 * and headers reflect the routing choice — direct fetch hits the upstream
 * with a Bearer Authorization header; via-cors-proxy routes through the
 * account's authenticated proxy, attaching the current account JWT (read
 * at build time from the registered ProxyAuthSource, spec §3) in
 * `x-chatsundere-authorization` while the forwarded upstream key stays in
 * `Authorization`.
 */
export function buildRequest(args: BuildRequestArgs): Request {
  const { provider, apiKey, path, method, body, extraHeaders } = args;
  const headers = new Headers({ Authorization: `Bearer ${apiKey}` });
  // FormData carries its own multipart boundary — setting Content-Type here
  // would destroy it. Only JSON bodies get the explicit header.
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  if (method === 'POST' && !isForm) headers.set('Content-Type', 'application/json');

  let url: string;
  let redirect: RequestInit['redirect'] = 'follow';
  if (provider.routing.kind === 'direct') {
    url = joinUrl(provider.baseUrl, path);
  } else {
    const source = getProxyAuthSource();
    const proxyUrl = source?.getUrl() ?? null;
    const token = source?.getToken() ?? null;
    if (proxyUrl === null) {
      throw new ProxyUnavailableError(
        'proxy_url',
        'transport: cors-proxy routing selected but no proxy is available',
      );
    }
    if (token === null) {
      throw new ProxyUnavailableError(
        'account_token',
        'transport: cors-proxy routing selected but no account token is available',
      );
    }
    // The proxy target must be a BARE ORIGIN: apps/proxy-service `parseTarget`
    // refuses a target carrying a path (400 bad_target), and the forward is built
    // as `target.origin + request-path`. So compute the full upstream URL exactly
    // as the direct route would (`joinUrl(baseUrl, path)`), then split it — origin
    // to the target header, path+query onto the proxied request line. This keeps
    // the proxied forward identical to the direct URL for every provider, whether
    // the base path lives in `baseUrl` (xai `/v1`) or in `path` (ollama origin).
    const upstream = new URL(joinUrl(provider.baseUrl, path));
    url = joinUrl(proxyUrl, `${upstream.pathname}${upstream.search}`);
    headers.set('x-chatsundere-authorization', `Bearer ${token}`);
    headers.set('x-cors-proxy-target', upstream.origin);
    // The browser must never chase an upstream redirect off-proxy (spec §5).
    redirect = 'manual';
  }

  // Adapter-supplied headers sit on top of the base/cors-proxy headers.
  if (extraHeaders) {
    for (const [k, value] of Object.entries(extraHeaders)) headers.set(k, value);
  }

  const request = new Request(url, {
    method,
    headers,
    redirect,
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });
  args.onDiagnostics?.onRequest({ method, url, headers: redactRequestHeaders(headers) });
  return request;
}

function joinUrl(base: string, path: string): string {
  const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const trimmedPath = path.startsWith('/') ? path : `/${path}`;
  return `${trimmedBase}${trimmedPath}`;
}
