// SPDX-License-Identifier: AGPL-3.0-only

import { getRandomBytes, toBase64Url } from '@chatsundere/crypto';
import type { Hono } from 'hono';
import type { Redis } from 'ioredis';
import { authenticate } from '../http/authenticate.js';
import type { SyncDeps } from '../http/deps.js';

/** What a doorbell ticket resolves to inside Redis (never leaves the server). */
export interface TicketData {
  accountId: string;
  /** The minting token's expiry (unix seconds) — the socket inherits it (spec §8.4). */
  tokenExp: number;
}

const ticketKey = (ticket: string): string => `sync:ticket:${ticket}`;

/** Registers `POST /api/v1/sync/doorbell-ticket` — mints a single-use upgrade ticket. */
export function registerDoorbellRoute(app: Hono, deps: SyncDeps): void {
  app.post('/api/v1/sync/doorbell-ticket', async (c) => {
    const auth = await authenticate(c, deps);
    if (!auth.ok) return auth.response;
    const ticket = toBase64Url(getRandomBytes(32));
    const data: TicketData = { accountId: auth.claims.sub, tokenExp: auth.claims.exp };
    await deps.redis.set(ticketKey(ticket), JSON.stringify(data), 'EX', deps.env.DOORBELL_TICKET_TTL_S);
    return c.json({ ticket });
  });
}

/**
 * Atomically consumes a ticket (GETDEL — single-use, the step-up round-state
 * discipline). Returns the ticket data or null if absent/expired/already used.
 */
export async function consumeTicket(redis: Redis, ticket: string): Promise<TicketData | null> {
  const raw = await redis.getdel(ticketKey(ticket));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TicketData;
  } catch {
    return null;
  }
}
