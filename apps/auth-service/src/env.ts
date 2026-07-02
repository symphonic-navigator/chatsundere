// SPDX-License-Identifier: AGPL-3.0-only

import {
  url,
  array,
  check,
  minLength,
  number,
  object,
  optional,
  parse,
  pipe,
  regex,
  string,
  transform,
} from 'valibot';

const envSchema = object({
  NODE_ENV: string(),
  PORT: pipe(
    string(),
    transform((s) => Number.parseInt(s, 10) || 3100),
    number(),
  ),
  LOG_LEVEL: string(),
  API_BASE_URL: pipe(string(), url()),
  DATABASE_URL: pipe(string(), regex(/^postgres:\/\//)),
  TEST_DATABASE_URL: optional(pipe(string(), regex(/^postgres:\/\//))),
  REDIS_URL: pipe(string(), regex(/^redis:\/\//)),
  AUTH_JWT_PRIVATE_KEY: pipe(string(), minLength(40)),
  INVITATION_HMAC_KEY: pipe(string(), minLength(40)),
  REFRESH_TOKEN_HMAC_KEY: pipe(string(), minLength(40)),
  HMAC_KEY_PENDING_CODES: pipe(string(), minLength(40)),
  CORS_ALLOWED_ORIGINS: pipe(
    string(),
    transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),
    array(string()),
  ),
  // Public URLs surfaced by GET /api/v1/config so the client never hard-codes
  // topology. Both are OPTIONAL absolute https URLs — an operator may run any
  // subset (auth+proxy, auth+sync, or all three); the client drives "disabled
  // over hidden" from the features array (spec §7 / sync spec §11).
  PROXY_PUBLIC_URL: optional(
    pipe(
      string(),
      url(),
      check((u) => u.startsWith('https://'), 'PROXY_PUBLIC_URL must be an absolute https URL'),
    ),
  ),
  SYNC_PUBLIC_URL: optional(
    pipe(
      string(),
      url(),
      check((u) => u.startsWith('https://'), 'SYNC_PUBLIC_URL must be an absolute https URL'),
    ),
  ),
  // Mirrors the sync-service's S3 presence for the /api/v1/config "blobs" flag
  // (blob spec §10/§14). A manual pairing — DEPLOYMENT ch.4 names it a congruence
  // checkpoint. 'true' enables; anything else (incl. unset) disables.
  SYNC_BLOBS_ENABLED: optional(
    pipe(
      string(),
      transform((s) => s === 'true'),
    ),
    'false',
  ),
});

export type Env = ReturnType<typeof loadEnv>;

export function loadEnv(): {
  NODE_ENV: string;
  PORT: number;
  LOG_LEVEL: string;
  API_BASE_URL: string;
  DATABASE_URL: string;
  TEST_DATABASE_URL?: string;
  REDIS_URL: string;
  AUTH_JWT_PRIVATE_KEY: string;
  INVITATION_HMAC_KEY: string;
  REFRESH_TOKEN_HMAC_KEY: string;
  HMAC_KEY_PENDING_CODES: string;
  CORS_ALLOWED_ORIGINS: string[];
  PROXY_PUBLIC_URL?: string;
  SYNC_PUBLIC_URL?: string;
  SYNC_BLOBS_ENABLED: boolean;
} {
  return parse(envSchema, {
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    PORT: process.env.PORT ?? '3100',
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
    API_BASE_URL: process.env.API_BASE_URL,
    DATABASE_URL: process.env.DATABASE_URL,
    TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    AUTH_JWT_PRIVATE_KEY: process.env.AUTH_JWT_PRIVATE_KEY,
    INVITATION_HMAC_KEY: process.env.INVITATION_HMAC_KEY,
    REFRESH_TOKEN_HMAC_KEY: process.env.REFRESH_TOKEN_HMAC_KEY,
    HMAC_KEY_PENDING_CODES: process.env.HMAC_KEY_PENDING_CODES,
    CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS ?? '',
    PROXY_PUBLIC_URL: process.env.PROXY_PUBLIC_URL,
    SYNC_PUBLIC_URL: process.env.SYNC_PUBLIC_URL,
    SYNC_BLOBS_ENABLED: process.env.SYNC_BLOBS_ENABLED,
  });
}
