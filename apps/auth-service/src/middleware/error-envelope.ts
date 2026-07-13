// SPDX-License-Identifier: AGPL-3.0-only
import type { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ValiError } from 'valibot';

export class ApiError extends HTTPException {
  constructor(
    status: 400 | 401 | 403 | 404 | 409 | 410 | 422 | 429 | 500 | 503,
    public readonly code: string,
    message: string,
    public readonly metadata?: Record<string, unknown>,
  ) {
    super(status, { message });
    this.name = 'ApiError';
  }
}

export const errorEnvelope: ErrorHandler = (err, c) => {
  if (err instanceof ApiError) {
    // Surface a rate-limit wait as the standard Retry-After header (whole
    // seconds) so the client can tell the user exactly how long, not just "in a
    // moment". CORS exposes this header (see corsAndOriginCheck) so a
    // cross-origin fetch can actually read it.
    const retryAfter = err.metadata?.retryAfterSeconds;
    if (err.status === 429 && typeof retryAfter === 'number' && retryAfter > 0) {
      c.header('Retry-After', String(Math.ceil(retryAfter)));
    }
    return c.json(
      { error: { code: err.code, message: err.message, ...(err.metadata ?? {}) } },
      err.status,
    );
  }
  if (err instanceof ValiError) {
    // Schema validation failure — surface the first issue message as a 400.
    const message = err.issues[0]?.message ?? 'Invalid input';
    return c.json({ error: { code: 'invalid_input', message } }, 400);
  }
  if (err instanceof HTTPException) {
    return c.json({ error: { code: codeForStatus(err.status), message: err.message } }, err.status);
  }
  // Unhandled — log via Hono's c.error elsewhere; respond opaquely.
  return c.json({ error: { code: 'internal', message: 'Internal error' } }, 500);
};

function codeForStatus(status: number): string {
  switch (status) {
    case 400:
      return 'invalid_input';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 410:
      return 'expired';
    case 429:
      return 'rate_limited';
    default:
      return 'internal';
  }
}
