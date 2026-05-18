// SPDX-License-Identifier: AGPL-3.0-only

import { Hono } from 'hono';
import { initialiseMetrics } from './metrics.js';
import { registerHealthRoutes } from './routes/health.js';

export function createServer(): Hono {
  initialiseMetrics();
  const app = new Hono();
  registerHealthRoutes(app);
  return app;
}
