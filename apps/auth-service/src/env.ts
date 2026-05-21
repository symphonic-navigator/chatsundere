// SPDX-License-Identifier: AGPL-3.0-only

import {
  url,
  array,
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
  CORS_ALLOWED_ORIGINS: string[];
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
    CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS ?? '',
  });
}
