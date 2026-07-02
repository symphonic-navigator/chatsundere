// SPDX-License-Identifier: AGPL-3.0-only
// Probe A + B: Bun.serve + WebSocket composition behind a Hono fetch, and the
// accepted idleTimeout maximum. Run: bun probes/ws-idle.ts

import { Hono } from 'hono';

const app = new Hono();
app.get('/plain', (c) => c.text('hono-ok'));

async function tryIdleTimeout(seconds: number): Promise<string> {
  try {
    const server = Bun.serve({
      port: 0,
      idleTimeout: seconds,
      fetch(req, server) {
        if (new URL(req.url).pathname === '/ws') {
          const ok = server.upgrade(req, { data: { accountId: 'test' } });
          return ok ? undefined : new Response('upgrade failed', { status: 400 });
        }
        return app.fetch(req);
      },
      websocket: {
        idleTimeout: seconds,
        open(ws) {
          ws.send('hello');
        },
        message() {},
        close() {},
      },
    });
    server.stop(true);
    return `accepted idleTimeout=${seconds}`;
  } catch (e) {
    return `REJECTED idleTimeout=${seconds}: ${(e as Error).message}`;
  }
}

// Probe A — the compose pattern works + a non-/ws route hits Hono.
const server = Bun.serve({
  port: 0,
  websocket: {
    open(ws) {
      ws.send('hello');
    },
    message() {},
    close() {},
  },
  fetch(req, server) {
    if (new URL(req.url).pathname === '/ws') {
      const ok = server.upgrade(req, { data: { accountId: 'test' } });
      return ok ? undefined : new Response('upgrade failed', { status: 400 });
    }
    return app.fetch(req);
  },
});
const plain = await fetch(`http://localhost:${server.port}/plain`).then((r) => r.text());
const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
const firstFrame = await new Promise<string>((resolve) => {
  ws.addEventListener('message', (e) => resolve(String(e.data)));
  setTimeout(() => resolve('(no frame)'), 1000);
});
ws.close();
server.stop(true);
console.log('Probe A — Hono route on non-/ws:', plain);
console.log('Probe A — first WS frame:', firstFrame);

// Probe B — idleTimeout acceptance sweep.
for (const s of [120, 255, 480, 960, 1200]) {
  console.log('Probe B —', await tryIdleTimeout(s));
}
