// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { createTokenVerifier } from './auth/verify-token.js';
import { bootstrapBucket, createS3Backend } from './blobs/s3.js';
import { createDb, getInstanceEpoch } from './db/client.js';
import { createDoorbellHub } from './doorbell/hub.js';
import { blobsEnabled, loadEnv } from './env.js';
import type { SyncDeps } from './http/deps.js';
import { createLogger } from './logger.js';
import { setBlobBackendUp } from './metrics.js';
import { createOpsApp } from './ops.js';
import { createLimiter } from './ratelimit/limiter.js';
import { type TicketData, consumeTicket } from './routes/doorbell.js';
import { createServer } from './server.js';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');

const { db, sql: pg } = createDb();
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3, enableReadyCheck: true });
// A dedicated connection for the doorbell pub/sub (a subscriber cannot issue
// ordinary commands, so it is duplicated from the main client).
const subscriber = redis.duplicate();

const epoch = await getInstanceEpoch(db);
const verifyToken = createTokenVerifier(env);
const allow = createLimiter(redis);
const blobBackend = blobsEnabled(env) ? createS3Backend(env) : null;
const deps: SyncDeps = { env, db, redis, verifyToken, allow, epoch, blobBackend };

// Bucket bootstrap (blob spec §8): non-blocking. S3 down at boot must NOT stop
// the service — records serve regardless; retry in the background until it takes.
if (blobsEnabled(env)) {
  const bootLog = (level: 'info' | 'warn' | 'error', msg: string): void => {
    logger[level](msg);
  };
  const tryBootstrap = async (): Promise<void> => {
    const ok = await bootstrapBucket(env, bootLog);
    setBlobBackendUp(ok);
    if (!ok) setTimeout(() => void tryBootstrap(), 30_000);
  };
  void tryBootstrap();
}

const app = createServer(deps);
const hub = createDoorbellHub(subscriber, {
  maxSocketsPerAccount: env.MAX_SOCKETS_PER_ACCOUNT,
  pingIntervalMs: env.WS_PING_INTERVAL_S * 1000,
});

const readyCheck = async (): Promise<{ database: 'ok' | 'down'; redis: 'ok' | 'down' }> => {
  let database: 'ok' | 'down' = 'down';
  let redisOk: 'ok' | 'down' = 'down';
  try {
    await db.execute(sql`SELECT 1`);
    database = 'ok';
  } catch {
    // reported as down
  }
  try {
    await redis.ping();
    redisOk = 'ok';
  } catch {
    // reported as down
  }
  return { database, redis: redisOk };
};
const opsApp = createOpsApp(readyCheck);

// Public port: the sync API + the doorbell WebSocket upgrade (Probe-A pattern —
// ticket check pre-upgrade, everything else → Hono).
const publicServer = Bun.serve<TicketData>({
  port: env.PORT,
  idleTimeout: env.WS_IDLE_TIMEOUT_S,
  async fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === '/api/v1/sync/doorbell') {
      const ticket = url.searchParams.get('ticket');
      const consumed = ticket ? await consumeTicket(redis, ticket) : null;
      if (!consumed) return new Response('unauthorized', { status: 401 });
      const ok = server.upgrade(req, { data: consumed });
      return ok ? undefined : new Response('upgrade failed', { status: 400 });
    }
    const ip = server.requestIP(req)?.address;
    return app.fetch(req, { ip });
  },
  websocket: {
    idleTimeout: env.WS_IDLE_TIMEOUT_S,
    open(ws) {
      if (!hub.add(ws)) ws.close(4401, 'too many sockets');
    },
    message() {
      // The doorbell is server → client only; inbound frames are ignored.
    },
    close(ws) {
      hub.remove(ws);
    },
  },
});

// Internal ops port: health + metrics, NEVER Traefik-routed.
const opsServer = Bun.serve({ port: env.OPS_PORT, fetch: opsApp.fetch });

// Keep the pg pool referenced for the process lifetime.
void pg;

logger.info(
  { publicPort: publicServer.port, opsPort: opsServer.port },
  'sync-service listening (public sync API + internal ops)',
);
