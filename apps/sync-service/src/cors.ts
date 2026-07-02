// SPDX-License-Identifier: AGPL-3.0-only

import type { MiddlewareHandler } from 'hono';

/** Exact, lowercased, full-origin match — never a suffix; `null`/missing never match. */
export function matchOrigin(origin: string | null | undefined, allowed: Set<string>): string | null {
  if (!origin || origin === 'null') return null;
  return allowed.has(origin.toLowerCase()) ? origin : null;
}

/**
 * Conventional CORS (spec §10.1): reflect a matched exact origin, always
 * `Vary: Origin`, NO credentials. A disallowed / null / missing origin simply
 * gets no CORS headers (never a wildcard, never an auth decision).
 */
export function corsMiddleware(allowedOrigins: string[]): MiddlewareHandler {
  const allowed = new Set(allowedOrigins.map((o) => o.toLowerCase()));
  return async (c, next) => {
    const matched = matchOrigin(c.req.header('origin'), allowed);
    if (c.req.method === 'OPTIONS') {
      if (matched) {
        c.header('Access-Control-Allow-Origin', matched);
        c.header('Vary', 'Origin');
        c.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        c.header('Access-Control-Allow-Headers', c.req.header('access-control-request-headers') ?? 'Authorization, Content-Type');
        c.header('Access-Control-Max-Age', '600');
      }
      return c.body(null, 204);
    }
    if (matched) {
      c.header('Access-Control-Allow-Origin', matched);
      c.header('Vary', 'Origin');
    }
    await next();
  };
}
