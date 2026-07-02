// SPDX-License-Identifier: AGPL-3.0-only
// Probe 2 + 4 (spec §21): Hono/Bun request-body streaming at 32 MiB.
//  - chunked consumption of c.req.raw.body as a ReadableStream (flat RSS)
//  - incremental SHA-256 via Bun.CryptoHasher('sha256') over the chunks
//  - Content-Length surfaced pre-body; chunked-encoding (absent length) refusable
//  - a body that overruns the declared Content-Length is observable
// Run: bun probes/body-stream.ts

import { Hono } from 'hono';

const MiB = 1024 * 1024;
const SIZE = 32 * MiB;

function rssMiB(): number {
  return Math.round((process.memoryUsage().rss / MiB) * 10) / 10;
}

const app = new Hono();

// A route that streams the body through an incremental hasher/counter without
// ever materialising the whole payload — the Task 7 upload pipeline in miniature.
app.put('/sink', async (c) => {
  const declared = c.req.header('content-length');
  if (declared === undefined) return c.json({ error: 'no content-length' }, 411);
  const limit = Number(declared);
  const body = c.req.raw.body;
  if (!body) return c.json({ error: 'no body' }, 400);

  const hasher = new Bun.CryptoHasher('sha256');
  let count = 0;
  let peakRss = rssMiB();
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      count += value.byteLength;
      hasher.update(value);
      if (count > limit) {
        await reader.cancel();
        return c.json({ error: 'overrun', count, limit }, 400);
      }
    }
    const rss = rssMiB();
    if (rss > peakRss) peakRss = rss;
  }
  return c.json({ count, hash: hasher.digest('base64'), peakRss, declared: limit });
});

const server = Bun.serve({ port: 0, fetch: app.fetch });
const base = `http://localhost:${server.port}`;

function makeBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = i & 0xff;
  return b;
}

const rssStart = rssMiB();
const payload = makeBytes(SIZE);
const expectedHash = new Bun.CryptoHasher('sha256').update(payload).digest('base64');

// 1. Happy 32 MiB PUT with a correct Content-Length.
const res = await fetch(`${base}/sink`, {
  method: 'PUT',
  headers: { 'content-length': String(SIZE), 'content-type': 'application/octet-stream' },
  body: payload,
});
const out = (await res.json()) as { count: number; hash: string; peakRss: number };
console.log('[probe2] 32 MiB PUT:', {
  status: res.status,
  countMatches: out.count === SIZE,
  hashMatches: out.hash === expectedHash,
  rssStartMiB: rssStart,
  peakRssMiB: out.peakRss,
  rssDeltaMiB: Math.round((out.peakRss - rssStart) * 10) / 10,
});

// 2. Missing Content-Length → 411 (chunked encoding is distinguishable).
//    fetch() sets content-length for a Uint8Array body, so simulate absence by
//    reading the header inside the handler; here we assert the handler's guard.
const noLen = await fetch(`${base}/sink`, {
  method: 'PUT',
  body: new ReadableStream({
    start(ctrl) {
      ctrl.enqueue(new Uint8Array([1, 2, 3]));
      ctrl.close();
    },
  }),
  /* @ts-expect-error Bun streaming request bodies need duplex */ duplex: 'half',
});
console.log('[probe4] no Content-Length →', noLen.status, '(expect 411)');

server.stop(true);
console.log('\nDecision inputs recorded in README-blobs.md.');
