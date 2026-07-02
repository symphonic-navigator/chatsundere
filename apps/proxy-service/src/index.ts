// SPDX-License-Identifier: AGPL-3.0-only

import { Redis } from 'ioredis';
import { createTokenVerifier } from './auth/verify-token.js';
import { loadEnv } from './env.js';
import { createLogger } from './logger.js';
import { createOpsApp } from './ops.js';
import { createLimiter } from './ratelimit/limiter.js';
import { createServer } from './server.js';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');

const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
});

const verifyToken = createTokenVerifier(env);
const allow = createLimiter(redis);

const app = createServer({ env, verifyToken, allow });
const opsApp = createOpsApp();

// Public forward proxy — Traefik-routed, no reserved paths.
const publicServer = Bun.serve({
  port: env.PORT,
  idleTimeout: env.PROXY_IDLE_TIMEOUT_S,
  fetch(req, server) {
    const ip = server.requestIP(req)?.address;
    return app.fetch(req, { ip });
  },
});

// Internal ops — health + metrics, NEVER Traefik-routed.
const opsServer = Bun.serve({
  port: env.OPS_PORT,
  fetch: opsApp.fetch,
});

logger.info(
  { publicPort: publicServer.port, opsPort: opsServer.port },
  'proxy-service listening (public forward + internal ops)',
);
