// SPDX-License-Identifier: AGPL-3.0-only

import * as v from 'valibot';

const num = (fallback: string) =>
  v.optional(v.pipe(v.string(), v.transform(Number), v.number()), fallback);

const EnvSchema = v.object({
  NODE_ENV: v.optional(v.picklist(['development', 'production', 'test']), 'development'),
  PORT: num('3200'),
  OPS_PORT: num('9091'),
  LOG_LEVEL: v.optional(v.picklist(['trace', 'debug', 'info', 'warn', 'error', 'fatal']), 'info'),
  DATABASE_URL: v.string(),
  // Must point at the SAME Redis instance/db as the auth-service so the token
  // deny-list keys are visible (spec §9/§14).
  REDIS_URL: v.string(),
  AUTH_JWKS_URL: v.string(),
  // Load-bearing: aud is ignored, so the issuer is the only claim binding a token
  // to this domain. Must match the auth-service issuer exactly (spec §9).
  JWT_ISSUER: v.optional(v.string(), 'chatsundere-auth-v1'),
  JWT_AUDIENCE: v.optional(v.string(), 'chatsundere-services'), // declared but ignored (variant a)
  CORS_ALLOWED_ORIGINS: v.optional(
    v.pipe(
      v.string(),
      v.transform((s) => s.split(',').map((o) => o.trim().toLowerCase()).filter(Boolean)),
    ),
    'https://app.chatsundere.me',
  ),
  TRUST_PROXY_HOPS: num('1'),
  RATE_LIMIT_USER_PER_MIN: num('120'),
  RATE_LIMIT_IP_PER_MIN: num('600'),
  RATE_LIMIT_DELETE_PER_MIN: num('60'),
  MAX_RECORD_BYTES: num('2097152'), // 2 MiB ciphertext
  ACCOUNT_QUOTA_BYTES: num('1073741824'), // 1 GiB
  MAX_PUSH_RECORDS: num('100'), // backstop; clients batch by bytes
  MAX_BODY_BYTES: num('25165824'), // 24 MiB
  PULL_LIMIT_DEFAULT: num('200'),
  PULL_LIMIT_MAX: num('500'),
  PULL_BYTE_BUDGET: num('8388608'), // 8 MiB per page
  DOORBELL_TICKET_TTL_S: num('30'),
  WS_PING_INTERVAL_S: num('30'),
  // Probe B (2026-07-01): Bun 1.3.11 rejects idleTimeout > 255; the spec's 960
  // is unusable. 255 is the accepted max; liveness is carried by the 30 s ping.
  WS_IDLE_TIMEOUT_S: num('255'),
  MAX_SOCKETS_PER_ACCOUNT: num('8'),
});

export type Env = v.InferOutput<typeof EnvSchema>;

/** Parses and validates the sync-service environment. Throws on invalid config. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  return v.parse(EnvSchema, source);
}
