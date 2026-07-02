// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { revokedJtiKey } from '@chatsundere/shared-types';
import { Hono } from 'hono';
import { Redis } from 'ioredis';
import { createDb } from '../src/db/client.js';
import { createDoorbellHub } from '../src/doorbell/hub.js';
import { loadEnv } from '../src/env.js';
import type { SyncDeps } from '../src/http/deps.js';
import { createLimiter } from '../src/ratelimit/limiter.js';
import { consumeTicket, registerDoorbellRoute } from '../src/routes/doorbell.js';

const A = '66666666-6666-6666-6666-666666666666';
const B = '77777777-7777-7777-7777-777777777777';
const tokenFor = (sub: string, jti = 'sess') => `${sub}|${jti}|9999999999`;

let redis: Redis;
let subscriber: Redis;
let hub: ReturnType<typeof createDoorbellHub>;
let server: ReturnType<typeof Bun.serve>;
let base: string;

const verifyToken = async (token: string) => {
  const [sub, jti, iat] = token.split('|');
  return sub && jti && iat ? { sub, jti, iat: Number(iat), exp: Number(iat) + 900 } : null;
};

beforeAll(async () => {
  redis = new Redis(process.env.REDIS_URL as string);
  subscriber = redis.duplicate();
  await redis.flushdb();
  const deps: SyncDeps = {
    env: loadEnv(),
    db: createDb().db,
    redis,
    verifyToken,
    allow: createLimiter(redis),
    epoch: 'epoch-1',
    blobBackend: null,
  };
  const app = new Hono();
  registerDoorbellRoute(app, deps);
  hub = createDoorbellHub(subscriber, { maxSocketsPerAccount: 8, pingIntervalMs: 100_000 });

  server = Bun.serve({
    port: 0,
    async fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === '/api/v1/sync/doorbell') {
        const ticket = url.searchParams.get('ticket');
        const consumed = ticket ? await consumeTicket(redis, ticket) : null;
        if (!consumed) return new Response('unauthorized', { status: 401 });
        const ok = srv.upgrade(req, { data: consumed });
        return ok ? undefined : new Response('upgrade failed', { status: 400 });
      }
      return app.fetch(req);
    },
    websocket: {
      open(ws) {
        if (!hub.add(ws as unknown as Parameters<typeof hub.add>[0]))
          ws.close(4401, 'too many sockets');
      },
      message() {},
      close(ws) {
        hub.remove(ws as unknown as Parameters<typeof hub.remove>[0]);
      },
    },
  });
  base = `http://localhost:${server.port}`;
});

afterAll(async () => {
  hub.stop();
  server.stop(true);
  await redis.quit();
  await subscriber.quit();
});

async function mint(sub: string, jti = 'sess'): Promise<string> {
  const res = await fetch(`${base}/api/v1/sync/doorbell-ticket`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tokenFor(sub, jti)}` },
  });
  const body = (await res.json()) as { ticket: string };
  return body.ticket;
}

/** Connects with a ticket; resolves { opened, ws }. */
function connect(ticket: string): Promise<{ opened: boolean; ws: WebSocket }> {
  const ws = new WebSocket(`ws://localhost:${server.port}/api/v1/sync/doorbell?ticket=${ticket}`);
  return new Promise((resolve) => {
    ws.addEventListener('open', () => resolve({ opened: true, ws }));
    ws.addEventListener('error', () => resolve({ opened: false, ws }));
    ws.addEventListener('close', () => resolve({ opened: false, ws }));
  });
}

describe('doorbell', () => {
  test('ticket mint requires auth', async () => {
    const res = await fetch(`${base}/api/v1/sync/doorbell-ticket`, { method: 'POST' });
    expect(res.status).toBe(401);
  });

  test('a revoked token cannot mint', async () => {
    await redis.set(revokedJtiKey('revsess'), '1');
    const res = await fetch(`${base}/api/v1/sync/doorbell-ticket`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokenFor(A, 'revsess')}` },
    });
    expect(res.status).toBe(401);
  });

  test('a valid ticket opens the socket; the same ticket twice is refused', async () => {
    const ticket = await mint(A);
    const first = await connect(ticket);
    expect(first.opened).toBe(true);
    const second = await connect(ticket); // GETDEL already consumed it
    expect(second.opened).toBe(false);
    first.ws.close();
  });

  test('an unknown/expired ticket is refused', async () => {
    // Simulate an expired ticket: a key that no longer exists.
    const res = await connect('nonexistent-ticket');
    expect(res.opened).toBe(false);
  });

  test('a poke on account A reaches A and never B', async () => {
    const [ta, tb] = await Promise.all([mint(A), mint(B)]);
    const a = await connect(ta);
    const b = await connect(tb);
    expect(a.opened).toBe(true);
    expect(b.opened).toBe(true);
    const aMsgs: string[] = [];
    const bMsgs: string[] = [];
    a.ws.addEventListener('message', (e) => aMsgs.push(String(e.data)));
    b.ws.addEventListener('message', (e) => bMsgs.push(String(e.data)));
    await new Promise((r) => setTimeout(r, 50)); // let subscriptions settle

    await redis.publish(`sync:${A}`, JSON.stringify({ rev: 42, epoch: 'epoch-1' }));
    await new Promise((r) => setTimeout(r, 100));

    expect(aMsgs.map((m) => JSON.parse(m).rev)).toEqual([42]);
    expect(bMsgs).toEqual([]);
    a.ws.close();
    b.ws.close();
  });
});
