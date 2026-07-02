// SPDX-License-Identifier: AGPL-3.0-only

import type { Context } from 'hono';

const DEFAULT_ALLOW_HEADERS =
  'x-chatsundere-authorization, x-cors-proxy-target, x-cors-proxy-kind, authorization, content-type';

/**
 * Exact, lowercased, full-origin match (scheme+host+port) — never a suffix.
 * `Origin: null` and a missing Origin never match: CORS is browser-only
 * defence-in-depth, never an auth layer (spec §6.3).
 */
export function matchOrigin(origin: string | null, allowed: string[]): string | null {
  if (!origin || origin === 'null') return null;
  return allowed.includes(origin.toLowerCase()) ? origin : null;
}

/**
 * Sets the response CORS headers for a matched origin: the specific origin (never
 * `*`), always `Vary: Origin`, and NO `Access-Control-Allow-Credentials` (auth is
 * a header, not a cookie).
 */
export function applyCorsHeaders(c: Context, origin: string): void {
  c.header('Access-Control-Allow-Origin', origin);
  c.header('Vary', 'Origin');
}

/**
 * Builds the CORS preflight response for a matched origin: echoes the requested
 * `Access-Control-Request-Headers`, advertises the method-agnostic surface, and
 * exposes `Mcp-Session-Id`. Returns 204.
 */
export function preflightResponse(c: Context, origin: string): Response {
  const requested = c.req.header('access-control-request-headers');
  c.header('Access-Control-Allow-Origin', origin);
  c.header('Vary', 'Origin');
  c.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  c.header(
    'Access-Control-Allow-Headers',
    requested && requested.length > 0 ? requested : DEFAULT_ALLOW_HEADERS,
  );
  c.header('Access-Control-Expose-Headers', 'Mcp-Session-Id');
  c.header('Access-Control-Max-Age', '600');
  return c.body(null, 204);
}
