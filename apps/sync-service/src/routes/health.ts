// SPDX-License-Identifier: AGPL-3.0-only

import type { Hono } from 'hono';
import { renderMetrics } from '../metrics.js';

/** Reports dependency reachability for /readyz. */
export type ReadyCheck = () => Promise<{ database: 'ok' | 'down'; redis: 'ok' | 'down' }>;

/** Registers the ops endpoints (health + metrics). Mounted on the internal ops app. */
export function registerHealthRoutes(app: Hono, check: ReadyCheck): void {
  app.get('/healthz', (c) => c.json({ status: 'ok' }));

  app.get('/readyz', async (c) => {
    const deps = await check();
    const ok = deps.database === 'ok' && deps.redis === 'ok';
    return c.json({ status: ok ? 'ok' : 'degraded', deps }, ok ? 200 : 503);
  });

  app.get('/metrics', async (c) => {
    const { body, contentType } = await renderMetrics();
    c.header('content-type', contentType);
    return c.body(body);
  });
}
