// SPDX-License-Identifier: AGPL-3.0-only
import type { Hono } from 'hono';
import { registry } from '../metrics.js';

export function registerMetricsRoute(app: Hono): void {
  app.get('/metrics', async (c) => {
    const body = await registry.metrics();
    c.header('Content-Type', registry.contentType);
    return c.body(body);
  });
}
