// SPDX-License-Identifier: AGPL-3.0-only
import type { MiddlewareHandler } from 'hono';

export function requestId(): MiddlewareHandler {
  return async (c, next) => {
    const id = crypto.randomUUID();
    c.set('request_id', id);
    c.header('X-Request-Id', id);
    await next();
  };
}
