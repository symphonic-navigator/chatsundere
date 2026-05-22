// SPDX-License-Identifier: AGPL-3.0-only
import type { MiddlewareHandler } from 'hono';

/**
 * Adds the production security-header set. HSTS is **skipped** for loopback
 * hosts (localhost / 127.0.0.1) because the dev auth-service listens on plain
 * HTTP per ADR 0023 — sending HSTS over loopback HTTP convinces the browser
 * to upgrade subsequent dev requests to https://localhost:N which fails with
 * ERR_SSL_PROTOCOL_ERROR. Other headers are environment-independent.
 */
export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    const host = c.req.header('host')?.toLowerCase() ?? '';
    const isLoopback = host.startsWith('localhost') || host.startsWith('127.0.0.1');
    if (!isLoopback) {
      c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    }
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  };
}
