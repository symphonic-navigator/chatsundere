// SPDX-License-Identifier: AGPL-3.0-only

import { Hono } from 'hono';
import { corsMiddleware } from './cors.js';
import { onSyncError } from './error.js';
import type { SyncDeps } from './http/deps.js';
import { initialiseMetrics } from './metrics.js';
import { registerBlobRoutes } from './routes/blobs.js';
import { registerChangesRoutes } from './routes/changes.js';
import { registerDoorbellRoute } from './routes/doorbell.js';

/**
 * The public sync app — `/api/v1/sync/*` only, behind conventional CORS. No
 * `/healthz`, `/readyz` or `/metrics` here; ops lives on the second port
 * (ops.ts). The doorbell WebSocket upgrade is handled in index.ts (Bun.serve),
 * not by Hono; this app serves the ticket-mint and the push/pull routes.
 */
export function createServer(deps: SyncDeps): Hono {
  initialiseMetrics();
  const app = new Hono();
  app.onError(onSyncError);
  app.use('*', corsMiddleware(deps.env.CORS_ALLOWED_ORIGINS));
  registerChangesRoutes(app, deps);
  registerBlobRoutes(app, deps);
  registerDoorbellRoute(app, deps);
  return app;
}
