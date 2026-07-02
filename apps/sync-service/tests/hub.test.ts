// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { Redis } from 'ioredis';
import { createDoorbellHub } from '../src/doorbell/hub.js';
import type { HubSocket } from '../src/doorbell/hub.js';

// A minimal subscriber fake: emits 'message' and records subscribe/unsubscribe.
function fakeSubscriber() {
  const em = new EventEmitter();
  const subscribed = new Set<string>();
  const redis = Object.assign(em, {
    subscribe: async (ch: string) => {
      subscribed.add(ch);
      return 1;
    },
    unsubscribe: async (ch: string) => {
      subscribed.delete(ch);
      return 0;
    },
    emitMessage: (ch: string, msg: string) => em.emit('message', ch, msg),
  }) as unknown as Redis & { emitMessage: (ch: string, msg: string) => void };
  return { redis, subscribed };
}

function fakeSocket(accountId: string, tokenExp: number) {
  const sent: string[] = [];
  let pings = 0;
  let closed: { code?: number } | null = null;
  const ws: HubSocket = {
    data: { accountId, tokenExp },
    send: (d) => sent.push(d),
    ping: () => {
      pings += 1;
    },
    close: (code) => {
      closed = { code };
    },
  };
  return {
    ws,
    sent,
    get pings() {
      return pings;
    },
    get closed() {
      return closed;
    },
  };
}

let stopFns: Array<() => void> = [];
afterEach(() => {
  for (const s of stopFns) s();
  stopFns = [];
});

describe('doorbell hub', () => {
  test('forwards a poke to the account sockets only', () => {
    const { redis } = fakeSubscriber();
    const hub = createDoorbellHub(redis, { maxSocketsPerAccount: 8, pingIntervalMs: 100_000 });
    stopFns.push(() => hub.stop());
    const a = fakeSocket('acc-A', 9_999_999_999);
    const b = fakeSocket('acc-B', 9_999_999_999);
    hub.add(a.ws);
    hub.add(b.ws);
    (redis as unknown as { emitMessage: (c: string, m: string) => void }).emitMessage('sync:acc-A', '{"rev":7}');
    expect(a.sent).toEqual(['{"rev":7}']);
    expect(b.sent).toEqual([]);
  });

  test('enforces the per-account socket cap', () => {
    const { redis } = fakeSubscriber();
    const hub = createDoorbellHub(redis, { maxSocketsPerAccount: 2, pingIntervalMs: 100_000 });
    stopFns.push(() => hub.stop());
    expect(hub.add(fakeSocket('acc', 9e12).ws)).toBe(true);
    expect(hub.add(fakeSocket('acc', 9e12).ws)).toBe(true);
    expect(hub.add(fakeSocket('acc', 9e12).ws)).toBe(false); // 3rd refused
    expect(hub.size('acc')).toBe(2);
  });

  test('unsubscribes when the last socket for an account leaves', () => {
    const { redis, subscribed } = fakeSubscriber();
    const hub = createDoorbellHub(redis, { maxSocketsPerAccount: 8, pingIntervalMs: 100_000 });
    stopFns.push(() => hub.stop());
    const s = fakeSocket('acc', 9e12);
    hub.add(s.ws);
    expect(subscribed.has('sync:acc')).toBe(true);
    hub.remove(s.ws);
    expect(subscribed.has('sync:acc')).toBe(false);
  });

  test('pings live sockets and closes expired ones on each tick', async () => {
    const { redis } = fakeSubscriber();
    let clock = 1_000_000;
    const hub = createDoorbellHub(redis, { maxSocketsPerAccount: 8, pingIntervalMs: 20, now: () => clock });
    stopFns.push(() => hub.stop());
    const live = fakeSocket('acc', 2000); // tokenExp 2000 s → far future in ms terms below
    const expired = fakeSocket('acc', 999); // tokenExp*1000 = 999000 < clock
    hub.add(live.ws);
    hub.add(expired.ws);
    await new Promise((r) => setTimeout(r, 60)); // ≥2 ticks
    expect(live.pings).toBeGreaterThanOrEqual(1);
    expect(expired.closed?.code).toBe(4401);
  });
});
