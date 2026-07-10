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

/**
 * Mirrors the client discovery parser's acceptance rule (`isAcceptableUrl` in
 * ui-shared `server-config.ts`): https on any host, or http only on a loopback
 * host. Keep the two in sync — they define the same "valid public URL" contract
 * on opposite ends of the wire.
 */
function isHttpsOrLoopbackHttp(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol === 'https:') return true;
  if (parsed.protocol !== 'http:') return false;
  return ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
}

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
  // The persistent OPAQUE server setup. Every registration record is bound to
  // this value — losing or regenerating it permanently bricks every account's
  // passphrase auth. Optional only for tests and throwaway dev runs; when
  // unset, getServerSetup() refuses to boot unless NODE_ENV is 'test' or
  // ALLOW_EPHEMERAL_OPAQUE_SETUP is set (Finding #10b).
  OPAQUE_SERVER_SETUP: optional(pipe(string(), minLength(40))),
  // Escape hatch for throwaway local runs only: permits getServerSetup() to
  // fall back to a per-process ephemeral setup outside tests when
  // OPAQUE_SERVER_SETUP is unset. '1' enables; anything else (incl. unset)
  // leaves the hard-fail in place. Never set this in production.
  ALLOW_EPHEMERAL_OPAQUE_SETUP: optional(string()),
  INVITATION_HMAC_KEY: pipe(string(), minLength(40)),
  REFRESH_TOKEN_HMAC_KEY: pipe(string(), minLength(40)),
  HMAC_KEY_PENDING_CODES: pipe(string(), minLength(40)),
  // Decoy-wrap HMAC key — for deriving deterministic, realistic-shaped OPAQUE
  // wrap fields (wrapped_mk_opaque / wrap_nonce_opaque) returned for unknown
  // or suspended users at /api/v1/opaque/login/start, closing the account-
  // enumeration oracle a null-vs-present wrap would otherwise leak (Finding
  // #10a). Distinct from every other HMAC key here for leak-domain isolation.
  DECOY_WRAP_KEY: pipe(string(), minLength(40)),
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
  // topology. Each is OPTIONAL and independently configurable — an operator may
  // run any subset; the client drives "disabled over hidden" from the features
  // array (spec §7 / sync spec §11). Proxy and sync require absolute https.
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
  // Admin tolerates http on a loopback host as well as https, mirroring the
  // client parser's own rule (isHttpsOrLoopbackHttp). Unlike proxy/sync — which
  // the client reaches via fetch transports — the client OPENS adminUrl in a new
  // tab (a real browser navigation), so a dev admin-client served over
  // http://localhost must be advertisable. Non-loopback http is still refused.
  ADMIN_PUBLIC_URL: optional(
    pipe(
      string(),
      url(),
      check(
        isHttpsOrLoopbackHttp,
        'ADMIN_PUBLIC_URL must be an https URL, or http on a loopback host',
      ),
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
  // Gates the per-IP rate-limit backstop in applyLoginRateLimit (Finding M2).
  // The forwarded IP (ipKey()) is attacker-controlled until TRUST_PROXY_HOPS
  // lands (separately tracked, owed before backend go-live), so it must not
  // drive a lockout decision unless the operator affirms they sit behind a
  // trusted reverse proxy that sets X-Forwarded-For/X-Real-IP correctly. Off
  // by default: a naive self-host without such a proxy would otherwise either
  // collapse every login onto the single 'unknown' IP bucket (a global DoS
  // for all users) or let an attacker spoof a victim's IP to lock that victim
  // out specifically. 'true' enables; anything else (incl. unset) disables.
  RATE_LIMIT_TRUST_FORWARDED_IP: optional(
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
  OPAQUE_SERVER_SETUP?: string;
  ALLOW_EPHEMERAL_OPAQUE_SETUP?: string;
  INVITATION_HMAC_KEY: string;
  REFRESH_TOKEN_HMAC_KEY: string;
  HMAC_KEY_PENDING_CODES: string;
  DECOY_WRAP_KEY: string;
  CORS_ALLOWED_ORIGINS: string[];
  PROXY_PUBLIC_URL?: string;
  SYNC_PUBLIC_URL?: string;
  ADMIN_PUBLIC_URL?: string;
  SYNC_BLOBS_ENABLED: boolean;
  RATE_LIMIT_TRUST_FORWARDED_IP: boolean;
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
    OPAQUE_SERVER_SETUP: process.env.OPAQUE_SERVER_SETUP,
    ALLOW_EPHEMERAL_OPAQUE_SETUP: process.env.ALLOW_EPHEMERAL_OPAQUE_SETUP,
    INVITATION_HMAC_KEY: process.env.INVITATION_HMAC_KEY,
    REFRESH_TOKEN_HMAC_KEY: process.env.REFRESH_TOKEN_HMAC_KEY,
    HMAC_KEY_PENDING_CODES: process.env.HMAC_KEY_PENDING_CODES,
    DECOY_WRAP_KEY: process.env.DECOY_WRAP_KEY,
    CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS ?? '',
    PROXY_PUBLIC_URL: process.env.PROXY_PUBLIC_URL,
    SYNC_PUBLIC_URL: process.env.SYNC_PUBLIC_URL,
    ADMIN_PUBLIC_URL: process.env.ADMIN_PUBLIC_URL,
    SYNC_BLOBS_ENABLED: process.env.SYNC_BLOBS_ENABLED,
    RATE_LIMIT_TRUST_FORWARDED_IP: process.env.RATE_LIMIT_TRUST_FORWARDED_IP,
  });
}
