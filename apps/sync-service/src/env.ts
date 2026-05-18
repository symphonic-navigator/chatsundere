// SPDX-License-Identifier: AGPL-3.0-only

import * as v from 'valibot';

const EnvSchema = v.object({
  NODE_ENV: v.optional(v.picklist(['development', 'production', 'test']), 'development'),
  PORT: v.optional(v.pipe(v.string(), v.transform(Number), v.number()), '3200'),
  LOG_LEVEL: v.optional(v.picklist(['trace', 'debug', 'info', 'warn', 'error', 'fatal']), 'info'),
  DATABASE_URL: v.string(),
  REDIS_URL: v.string(),
  JWT_ISSUER: v.optional(v.string(), 'chatsundere-auth'),
  JWT_AUDIENCE: v.optional(v.string(), 'chatsundere-services'),
  AUTH_JWKS_URL: v.string(),
});

export type Env = v.InferOutput<typeof EnvSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  return v.parse(EnvSchema, source);
}
