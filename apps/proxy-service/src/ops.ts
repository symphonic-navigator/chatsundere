// SPDX-License-Identifier: AGPL-3.0-only

import { Hono } from 'hono';
import { initialiseMetrics } from './metrics.js';
import { registerHealthRoutes } from './routes/health.js';

/**
 * The internal ops app — `/healthz`, `/readyz`, `/metrics`. Runs on OPS_PORT,
 * which is NEVER Traefik-routed, so the ops endpoints are unreachable from
 * outside and cannot collide with a proxied upstream path (spec §8.4).
 */
export function createOpsApp(): Hono {
  initialiseMetrics();
  const app = new Hono();
  registerHealthRoutes(app);
  return app;
}
