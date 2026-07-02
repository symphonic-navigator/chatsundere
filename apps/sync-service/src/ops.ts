// SPDX-License-Identifier: AGPL-3.0-only

import { Hono } from 'hono';
import { initialiseMetrics } from './metrics.js';
import { type ReadyCheck, registerHealthRoutes } from './routes/health.js';

/**
 * The internal ops app — `/healthz`, `/readyz`, `/metrics`. Runs on OPS_PORT,
 * never Traefik-routed, so the public port serves only `/api/v1/sync/*`.
 */
export function createOpsApp(check: ReadyCheck): Hono {
  initialiseMetrics();
  const app = new Hono();
  registerHealthRoutes(app, check);
  return app;
}
