// SPDX-License-Identifier: AGPL-3.0-only

import * as v from 'valibot';

const num = (fallback: string) =>
  v.optional(v.pipe(v.string(), v.transform(Number), v.number()), fallback);

const EnvSchema = v.object({
  NODE_ENV: v.optional(v.picklist(['development', 'production', 'test']), 'development'),
  PORT: num('8080'),
  OPS_PORT: num('9090'),
  LOG_LEVEL: v.optional(v.picklist(['trace', 'debug', 'info', 'warn', 'error', 'fatal']), 'info'),
  REDIS_URL: v.string(),
  // Load-bearing: aud is ignored, so the issuer is the only claim binding a token
  // to this auth domain. Must match the auth-service issuer exactly.
  JWT_ISSUER: v.optional(v.string(), 'chatsundere-auth-v1'),
  JWT_AUDIENCE: v.optional(v.string(), 'chatsundere-services'), // declared but ignored (variant a)
  AUTH_JWKS_URL: v.string(),
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
  MAX_BODY_BYTES: num('52428800'),
  MAX_CONCURRENT_PER_USER: num('6'),
  PROXY_IDLE_TIMEOUT_S: num('120'),
});

export type Env = v.InferOutput<typeof EnvSchema>;

/** Parses and validates the proxy-service environment. Throws on invalid config. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  return v.parse(EnvSchema, source);
}
