// SPDX-License-Identifier: AGPL-3.0-only

import * as v from 'valibot';

const num = (fallback: string) =>
  v.optional(v.pipe(v.string(), v.transform(Number), v.number()), fallback);

const BaseEnvSchema = v.object({
  NODE_ENV: v.optional(v.picklist(['development', 'production', 'test']), 'development'),
  PORT: num('3200'),
  OPS_PORT: num('9091'),
  LOG_LEVEL: v.optional(
    v.picklist(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']),
    'info',
  ),
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
      v.transform((s) =>
        s
          .split(',')
          .map((o) => o.trim().toLowerCase())
          .filter(Boolean),
      ),
    ),
    'https://app.chatsundere.me',
  ),
  TRUST_PROXY_HOPS: num('1'),
  RATE_LIMIT_USER_PER_MIN: num('120'),
  RATE_LIMIT_IP_PER_MIN: num('600'),
  RATE_LIMIT_DELETE_PER_MIN: num('60'),
  MAX_RECORD_BYTES: num('2097152'), // 2 MiB ciphertext
  // Blob spec §2.3/§14: shared records+blobs quota, default raised to 2 GiB.
  ACCOUNT_QUOTA_BYTES: num('2147483648'), // 2 GiB
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

  // --- Blob transport (S3/MinIO), blob spec §14 ---------------------------
  // Unset ⇒ blobs disabled; the service runs records-only. The client uses
  // path-style addressing ONLY (MinIO, Garage, Hetzner Object Storage);
  // virtual-host-style-only endpoints are not supported.
  S3_ENDPOINT: v.optional(v.string()),
  S3_REGION: v.optional(v.string(), 'us-east-1'),
  S3_BUCKET: v.optional(v.string(), 'chatsundere-blobs'),
  S3_ACCESS_KEY_ID: v.optional(v.string()),
  S3_SECRET_ACCESS_KEY: v.optional(v.string()),
  MAX_BLOB_BYTES: num('33554432'), // 32 MiB ciphertext body
  BLOB_QUOTA_FLOOR_BYTES: num('65536'), // 64 KiB accounting floor per blob (§4)
  BLOB_UPLOAD_IDLE_TIMEOUT_S: num('30'), // body-progress timeout (§8)
});

// Cross-field: a configured S3 endpoint must carry credentials. Without them the
// bucket bootstrap and every blob request would fail confusingly at runtime;
// fail fast at boot instead (blob spec §14).
const EnvSchema = v.pipe(
  BaseEnvSchema,
  v.check(
    (env) => !env.S3_ENDPOINT || (!!env.S3_ACCESS_KEY_ID && !!env.S3_SECRET_ACCESS_KEY),
    'S3_ENDPOINT requires S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY',
  ),
);

export type Env = v.InferOutput<typeof EnvSchema>;

/** Parses and validates the sync-service environment. Throws on invalid config. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  return v.parse(EnvSchema, source);
}

/** True iff an S3 backend is configured — the blob endpoints are live (§3). */
export function blobsEnabled(env: Env): boolean {
  return Boolean(env.S3_ENDPOINT);
}
