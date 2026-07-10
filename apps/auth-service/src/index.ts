// SPDX-License-Identifier: AGPL-3.0-only

import { loadEnv } from './env.js';
import { createLogger } from './logger.js';
import { createServer } from './server.js';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');
const app = createServer();

const server = Bun.serve({
  port: env.PORT,
  // Inject the real socket peer so ipKey() can derive a spoof-resistant client
  // IP (deriveClientIp + TRUST_PROXY_HOPS) instead of trusting a client-set
  // X-Forwarded-For. Mirrors proxy-service and sync-service.
  fetch(req, srv) {
    const ip = srv.requestIP(req)?.address;
    return app.fetch(req, { ip });
  },
});

logger.info({ port: server.port }, 'auth-service listening');
