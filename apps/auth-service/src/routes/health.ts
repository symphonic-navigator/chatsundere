// SPDX-License-Identifier: AGPL-3.0-only

import type { Hono } from 'hono';

export function registerHealthRoutes(app: Hono): void {
  app.get('/healthz', (c) => c.json({ status: 'ok' }));

  app.get('/readyz', async (c) => {
    // Phase 0: env presence is the only signal. Real DB and Redis pings
    // arrive with the auth-service implementation unit.
    const deps: Record<string, 'ok' | 'unknown'> = {
      database: 'unknown',
      redis: 'unknown',
    };
    return c.json({ status: 'ok', deps });
  });
}
