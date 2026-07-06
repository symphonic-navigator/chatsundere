// SPDX-License-Identifier: AGPL-3.0-only

import { ready as opaqueReady, server as opaqueServer } from '@serenity-kit/opaque';
import { loadEnv } from '../env.js';
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
 * The setup is the server's long-term OPAQUE key material: every registration
 * record is cryptographically bound to it, so it MUST be stable across
 * restarts and identical on every replica. It comes from `OPAQUE_SERVER_SETUP`
 * (generate once with `bun run generate-opaque-setup`). When the variable is
 * unset — tests and throwaway runs only — a per-process setup is generated and
 * a loud warning is printed, because every restart then permanently
 * invalidates all registered accounts' passphrase auth.
 */
export function getServerSetup(): string {
  if (serverSetupCache) return serverSetupCache;
  const configured = loadEnv().OPAQUE_SERVER_SETUP;
  if (configured) {
    serverSetupCache = configured;
    return serverSetupCache;
  }
  console.warn(
    'OPAQUE_SERVER_SETUP is not set — using an ephemeral per-process setup. ' +
      'Every restart will permanently invalidate all registered accounts. ' +
      'Generate one with `bun run generate-opaque-setup` and set it in the environment.',
  );
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
  scope: 'register' | 'login' | 'step-up' | 'join-pairing';
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
  scope: 'register' | 'login' | 'step-up' | 'join-pairing',
  sessionId: string,
): Promise<Record<string, string> | null> {
  const redis = createRedis();
  const raw = await redis.get(`opaque:${scope}:${sessionId}`);
  if (!raw) return null;
  await redis.del(`opaque:${scope}:${sessionId}`);
  return JSON.parse(raw) as Record<string, string>;
}
