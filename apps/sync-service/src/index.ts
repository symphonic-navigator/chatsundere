// SPDX-License-Identifier: AGPL-3.0-only

import { loadEnv } from './env.js';
import { createLogger } from './logger.js';
import { createServer } from './server.js';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');
const app = createServer();

const server = Bun.serve({
  port: env.PORT,
  fetch: app.fetch,
});

logger.info({ port: server.port }, 'sync-service listening');
