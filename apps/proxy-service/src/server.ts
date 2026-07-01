// SPDX-License-Identifier: AGPL-3.0-only

import { Hono } from 'hono';
import { initialiseMetrics } from './metrics.js';
import { onProxyError } from './error.js';
import { type ProxyDeps, registerProxyRoute } from './routes/proxy.js';

/**
 * The public app — ONLY the forward proxy, on every path. No reserved
 * /healthz//readyz//metrics here, so an upstream MCP path like `/metrics`
 * proxies correctly; ops lives on the second port (see ops.ts).
 */
export function createServer(deps: ProxyDeps): Hono {
  initialiseMetrics();
  const app = new Hono();
  app.onError(onProxyError);
  registerProxyRoute(app, deps);
  return app;
}
