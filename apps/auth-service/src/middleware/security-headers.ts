// SPDX-License-Identifier: AGPL-3.0-only
import type { MiddlewareHandler } from 'hono';

export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  };
}
