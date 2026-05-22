// SPDX-License-Identifier: AGPL-3.0-only

import { ready as opaqueReady, server as opaqueServer } from '@serenity-kit/opaque';
import { createRedis } from '../redis/client.js';

let serverSetupCache: string | null = null;
const STATE_TTL_SECONDS = 60;
const SESSION_ID_BYTES = 16;

/** Waits for the OPAQUE WASM module to be ready. Must be called before any OPAQUE operations. */
export async function ensureOpaqueReady(): Promise<void> {
  await opaqueReady;
}

/**
 * Returns the OPAQUE server setup string.
 *
 * Phase-0 limitation: this generates a fresh setup on first call and caches it for the process
 * lifetime. A restart produces a new setup, which invalidates all in-flight OPAQUE sessions.
 * In a multi-replica deployment this is also broken — every replica would have a different
 * setup. See obsidian/insights/security-deferrals.md for the deferral entry.
 */
export function getServerSetup(): string {
  if (serverSetupCache) return serverSetupCache;
  serverSetupCache = opaqueServer.createSetup();
  return serverSetupCache;
}

/** Generates a cryptographically random session ID as a base64url string. */
export function generateSessionId(): string {
  const buf = new Uint8Array(SESSION_ID_BYTES);
  crypto.getRandomValues(buf);
  return Buffer.from(buf).toString('base64url');
}

/** Stores per-session OPAQUE state in Redis with a short TTL. */
export async function storeOpaqueState(args: {
  scope: 'register' | 'login' | 'step-up';
  sessionId: string;
  payload: Record<string, string>;
}): Promise<void> {
  const redis = createRedis();
  await redis.set(
    `opaque:${args.scope}:${args.sessionId}`,
    JSON.stringify(args.payload),
    'EX',
    STATE_TTL_SECONDS,
  );
}

/**
 * Fetches and atomically deletes the OPAQUE session state from Redis.
 * Returns null if the session has expired or never existed.
 */
export async function fetchOpaqueState(
  scope: 'register' | 'login' | 'step-up',
  sessionId: string,
): Promise<Record<string, string> | null> {
  const redis = createRedis();
  const raw = await redis.get(`opaque:${scope}:${sessionId}`);
  if (!raw) return null;
  await redis.del(`opaque:${scope}:${sessionId}`);
  return JSON.parse(raw) as Record<string, string>;
}
