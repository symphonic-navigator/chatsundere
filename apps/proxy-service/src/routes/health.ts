// SPDX-License-Identifier: AGPL-3.0-only

import type { Hono } from 'hono';
import { renderMetrics } from '../metrics.js';

/** Registers the ops endpoints (health + metrics). Mounted on the internal ops app. */
export function registerHealthRoutes(app: Hono): void {
  app.get('/healthz', (c) => c.json({ status: 'ok' }));

  app.get('/readyz', (c) => {
    // The proxy touches no Postgres; only Redis is a dependency (rate-limit state).
    const deps: Record<string, 'ok' | 'unknown'> = {
      redis: 'unknown',
    };
    return c.json({ status: 'ok', deps });
  });

  app.get('/metrics', async (c) => {
    const { body, contentType } = await renderMetrics();
    c.header('content-type', contentType);
    return c.body(body);
  });
}
