// SPDX-License-Identifier: AGPL-3.0-only
import type { MiddlewareHandler } from 'hono';

export function corsAndOriginCheck(allowedOrigins: string[]): MiddlewareHandler {
  const allow = new Set(allowedOrigins);
  return async (c, next) => {
    const origin = c.req.header('Origin');
    const isPreflight = c.req.method === 'OPTIONS';

    if (origin && !allow.has(origin)) {
      // Strict: no permissive fallback.
      return c.json({ error: { code: 'forbidden', message: 'Origin not allowed' } }, 403);
    }

    const isStateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method);
    if (isStateChanging && !origin) {
      return c.json({ error: { code: 'forbidden', message: 'Origin header required' } }, 403);
    }

    if (origin) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Vary', 'Origin');
      c.header('Access-Control-Allow-Credentials', 'true');
      // Retry-After is not a CORS-safelisted response header, so a cross-origin
      // fetch cannot read it unless we expose it explicitly. The client uses it
      // to show a concrete rate-limit wait rather than a vague "in a moment".
      c.header('Access-Control-Expose-Headers', 'Retry-After');
    }

    if (isPreflight) {
      c.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      c.header(
        'Access-Control-Allow-Headers',
        c.req.header('Access-Control-Request-Headers') ?? 'Authorization, Content-Type',
      );
      c.header('Access-Control-Max-Age', '600');
      return c.body(null, 204);
    }

    await next();
  };
}
