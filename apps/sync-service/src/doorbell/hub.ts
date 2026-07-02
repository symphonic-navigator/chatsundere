// SPDX-License-Identifier: AGPL-3.0-only

import type { Redis } from 'ioredis';
import { doorbellConnected, doorbellDisconnected, recordPoke } from '../metrics.js';
import { doorbellChannel } from './publish.js';

/** The socket surface the hub needs — satisfied by Bun's ServerWebSocket. */
export interface HubSocket {
  readonly data: { accountId: string; tokenExp: number };
  send(data: string): void;
  ping(): void;
  close(code?: number, reason?: string): void;
}

export interface DoorbellHub {
  /** Registers a socket; returns false (caller should close) if the per-account cap is hit. */
  add(ws: HubSocket): boolean;
  remove(ws: HubSocket): void;
  size(accountId: string): number;
  stop(): void;
}

export interface HubOptions {
  maxSocketsPerAccount: number;
  pingIntervalMs: number;
  /** Injectable clock (unix ms) for deterministic expiry tests. */
  now?: () => number;
}

/**
 * The per-account doorbell socket registry. Holds one multiplexed Redis
 * subscriber, SUBSCRIBE/UNSUBSCRIBE-ing per-account channels as sockets come and
 * go, and forwards each poke verbatim to that account's sockets only. A single
 * interval pings every socket (liveness + idle-timeout defeat, spec §8.4) and
 * force-closes any whose minting token has expired.
 */
export function createDoorbellHub(subscriber: Redis, opts: HubOptions): DoorbellHub {
  const now = opts.now ?? (() => Date.now());
  const sockets = new Map<string, Set<HubSocket>>();

  subscriber.on('message', (channel: string, message: string) => {
    const accountId = channel.startsWith('sync:') ? channel.slice('sync:'.length) : channel;
    const set = sockets.get(accountId);
    if (!set) return;
    for (const ws of set) {
      ws.send(message);
      recordPoke();
    }
  });

  const tick = setInterval(() => {
    const cutoff = now();
    for (const set of sockets.values()) {
      for (const ws of set) {
        if (ws.data.tokenExp * 1000 <= cutoff) {
          ws.close(4401, 'token expired');
        } else {
          ws.ping();
        }
      }
    }
  }, opts.pingIntervalMs);
  // Do not keep the process alive solely for the ping loop.
  (tick as unknown as { unref?: () => void }).unref?.();

  return {
    add(ws) {
      const { accountId } = ws.data;
      let set = sockets.get(accountId);
      if (set && set.size >= opts.maxSocketsPerAccount) return false;
      if (!set) {
        set = new Set();
        sockets.set(accountId, set);
        void subscriber.subscribe(doorbellChannel(accountId));
      }
      set.add(ws);
      doorbellConnected();
      return true;
    },
    remove(ws) {
      const { accountId } = ws.data;
      const set = sockets.get(accountId);
      if (!set || !set.has(ws)) return;
      set.delete(ws);
      doorbellDisconnected();
      if (set.size === 0) {
        sockets.delete(accountId);
        void subscriber.unsubscribe(doorbellChannel(accountId));
      }
    },
    size(accountId) {
      return sockets.get(accountId)?.size ?? 0;
    },
    stop() {
      clearInterval(tick);
    },
  };
}
