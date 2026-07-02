// SPDX-License-Identifier: AGPL-3.0-only

import type { Context } from 'hono';

/**
 * Generic error handler for the proxy. Returns a 502 with a static body and
 * NEVER interpolates `err.message` or request context — a failed upstream fetch
 * embeds the full target URL+path in its message, which would deanonymise
 * exactly what spec §8.1 forbids (no request logging, even on the error path).
 */
export function onProxyError(_err: unknown, c: Context): Response {
  return c.json({ error: { code: 'upstream_error', message: 'Upstream request failed' } }, 502);
}
