// SPDX-License-Identifier: AGPL-3.0-only

import type { Context } from 'hono';

/**
 * Generic error handler. Returns a static 500 body and NEVER interpolates
 * `err.message` or request context (spec §10.2 — no request logging, no
 * ciphertext/identity leakage even on the error path).
 */
export function onSyncError(_err: unknown, c: Context): Response {
  return c.json({ error: { code: 'internal', message: 'Internal error' } }, 500);
}
