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
 * unset, this refuses to boot unless `NODE_ENV` is `test` or the
 * `ALLOW_EPHEMERAL_OPAQUE_SETUP` escape hatch is set — in either of those
 * cases a per-process setup is generated and a loud warning is printed,
 * because every restart then permanently invalidates all registered
 * accounts' passphrase auth.
 */
export function getServerSetup(): string {
  if (serverSetupCache) return serverSetupCache;
  const env = loadEnv();
  const configured = env.OPAQUE_SERVER_SETUP;
  if (configured) {
    serverSetupCache = configured;
    return serverSetupCache;
  }
  if (env.NODE_ENV !== 'test' && env.ALLOW_EPHEMERAL_OPAQUE_SETUP !== '1') {
    throw new Error(
      'OPAQUE_SERVER_SETUP is required outside tests — refusing to boot with an ' +
        'ephemeral setup that would invalidate all accounts on restart. Set it with ' +
        '`bun run generate-opaque-setup`, or set ALLOW_EPHEMERAL_OPAQUE_SETUP=1 for a ' +
        'throwaway run.',
    );
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
 * Fetches and atomically deletes the OPAQUE session state from Redis via
 * GETDEL — a single round-trip, so two concurrent /finish calls cannot both
 * pass the existence check before the delete lands. Returns null if the
 * session has expired or never existed.
 */
export async function fetchOpaqueState(
  scope: 'register' | 'login' | 'step-up' | 'join-pairing',
  sessionId: string,
): Promise<Record<string, string> | null> {
  const redis = createRedis();
  const raw = await redis.getdel(`opaque:${scope}:${sessionId}`);
  if (!raw) return null;
  return JSON.parse(raw) as Record<string, string>;
}
