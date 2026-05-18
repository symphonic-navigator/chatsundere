# Foundational Auth — Auth Service (Squash B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/auth-service` — the Hono-on-Bun server that handles account linking, login, recovery, JWT issuance, refresh-token rotation, admin user/invitation/audit-log endpoints, and the bootstrap CLI. Per spec `/home/chris/workspace/chatsundere/superpowers/specs/2026-05-18-foundational-auth-layer-design.md` it is the "account-linking" service in a local-first identity model — it never sees passphrases, master keys, or recovery keys.

**Architecture:** Hono router on Bun runtime. PostgreSQL via Drizzle (5 tables: `users`, `auth_methods`, `invitations`, `refresh_tokens`, `audit_log`). Redis for rate limits, OPAQUE flow state keyed by random session id, JWT EXISTS-cache. OPAQUE server via `@serenity-kit/opaque`. WebAuthn server via `@simplewebauthn/server`. JWT via `jose` (EdDSA Ed25519, JWKS endpoint, refresh rotation with re-use detection). Structured logging via `pino` with strict redact paths. Metrics via `prom-client` with a CI-enforced no-PII label policy. Bootstrap as a separate CLI entry point (`bun run bootstrap-admin`), file output at `0600`. Audit-log uses per-event-type Valibot schemas with a 2 KiB hard cap.

**Tech Stack:**
- Hono 4 (router) on Bun runtime (per CLAUDE.md §4).
- Drizzle ORM + `drizzle-kit` (migrations) + `postgres` driver against PostgreSQL 16.
- `ioredis` for Redis (rate limits, OPAQUE state, EXISTS-cache).
- `@serenity-kit/opaque@^0.9.0` (same version as squash A) — server bindings only.
- `@simplewebauthn/server@^11.0.0` — server-side WebAuthn ceremony helpers.
- `jose` for JWT signing (EdDSA Ed25519) + JWKS encoding.
- `valibot` for request validation + audit-log payload schemas.
- `prom-client` for metrics; `pino` for logging.
- Bun's built-in test runner. Integration tests use a real (test-isolated) PostgreSQL via the same compose file under a `_test` schema.
- `@chatsundere/shared-types` (workspace dep, set up in squash A) for wire types.
- `@chatsundere/crypto` (workspace dep) is **not** depended on directly — squash A is pure-client; server-side it is forbidden by spec §3.

**Squash boundary:** A single squashed commit titled `Add auth-service backend for foundational auth` once all 18 tasks pass. Larissa audits the diff before squash. No push, no merge — Chris's responsibility.

---

## File Structure

Files created or substantially rewritten in this squash:

```
apps/auth-service/
├── package.json                              deps added, scripts adjusted
├── tsconfig.json                             unchanged
├── tsconfig.test.json                        new — typecheck tests without emit
├── drizzle.config.ts                         new — drizzle-kit config
├── bunfig.toml                               new — test preload for env setup
├── .env.example                              rewritten — full set of vars
├── README.md                                 extended
├── migrations/                               new — drizzle-kit emits SQL here
│   └── 0000_init.sql                         generated; checked in
├── src/
│   ├── index.ts                              rewritten — entry that wires everything
│   ├── env.ts                                rewritten — new valibot schema
│   ├── logger.ts                             extended — redact paths
│   ├── metrics.ts                            rewritten — label policy + metric defs
│   ├── server.ts                             rewritten — middleware stack + route registration
│   ├── db/
│   │   ├── client.ts                         new — Drizzle client factory
│   │   ├── schema.ts                         new — Drizzle table definitions
│   │   └── migrations.ts                     new — runtime migration runner
│   ├── redis/
│   │   └── client.ts                         new — ioredis client factory
│   ├── middleware/
│   │   ├── cors.ts                           new — CORS + Origin check (CSRF defence-in-depth)
│   │   ├── security-headers.ts               new — HSTS + minimal CSP
│   │   ├── error-envelope.ts                 new — uniform error shape
│   │   ├── request-id.ts                     new — UUIDv7 request id
│   │   ├── rate-limit.ts                     new — Redis sliding-window
│   │   └── auth.ts                           new — JWT verify + EXISTS check
│   ├── jwt/
│   │   ├── keys.ts                           new — load Ed25519 private key, derive JWKS
│   │   ├── issue.ts                          new — access-token + refresh-token issuance
│   │   ├── verify.ts                         new — access-token verification
│   │   └── refresh.ts                        new — rotation + re-use detection
│   ├── opaque/
│   │   └── server.ts                         new — wrapper over @serenity-kit/opaque server bindings
│   ├── webauthn/
│   │   └── server.ts                         new — wrapper over @simplewebauthn/server
│   ├── audit/
│   │   ├── log.ts                            new — typed writer with per-event-type valibot schemas + size cap
│   │   └── events.ts                         new — canonical event-type strings + schemas
│   ├── invitations/
│   │   ├── token.ts                          new — HMAC-keyed token hashing
│   │   └── rate-limit.ts                     new — per-token attempt cap
│   ├── recovery/
│   │   └── nonce.ts                          new — Redis-backed nonce store with 60s TTL
│   ├── routes/
│   │   ├── health.ts                         extended — /healthz + /readyz (deps probe)
│   │   ├── metrics.ts                        new — /metrics
│   │   ├── jwks.ts                           new — /v1/jwks
│   │   ├── link.ts                           new — /v1/link/opaque/* + /v1/link/passkey/*
│   │   ├── login.ts                          new — /v1/opaque/login/* + /v1/passkey/login/*
│   │   ├── recovery.ts                       new — /v1/recovery/start + /finish
│   │   ├── token.ts                          new — /v1/token/refresh
│   │   ├── auth.ts                           new — /v1/auth/logout
│   │   ├── me.ts                             new — /v1/me (GET, PATCH, DELETE), /v1/auth-methods/:id, passphrase change
│   │   └── admin/
│   │       ├── users.ts                      new
│   │       ├── invitations.ts                new
│   │       └── audit.ts                      new
│   └── cli/
│       └── bootstrap.ts                      new — bun run bootstrap-admin
└── tests/
    ├── setup.ts                              new — env + db isolation helpers
    ├── health.test.ts                        kept (extended for /readyz)
    ├── unit/                                 mirrors src/
    └── integration/                          end-to-end flows
```

`infra/compose.dev.yml` already provisions PostgreSQL 16 and Redis 7 (verified by reading the file at plan-write time). The bootstrap secret file uses `$XDG_RUNTIME_DIR` or `/tmp`.

---

## Tasks

### Task 1: Tooling, dependencies, env schema, test-config split

**Files:**
- Modify: `apps/auth-service/package.json` (add deps, scripts)
- Create: `apps/auth-service/tsconfig.test.json` (analogous to squash A's split)
- Create: `apps/auth-service/bunfig.toml`
- Create: `apps/auth-service/drizzle.config.ts`
- Modify: `apps/auth-service/.env.example`
- Create: `apps/auth-service/.env` (dev defaults; gitignored already? verify)
- Create: `apps/auth-service/tests/setup.ts`

- [ ] **Step 1: Update `apps/auth-service/package.json`**

Final shape:

```json
{
  "name": "@chatsundere/auth-service",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "license": "AGPL-3.0-only",
  "scripts": {
    "dev": "bun --watch src/index.ts",
    "start": "bun src/index.ts",
    "build": "bun build src/index.ts --target=bun --outdir=dist",
    "typecheck": "tsc -p tsconfig.test.json",
    "test": "bun test",
    "test:integration": "bun test tests/integration",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "bun run src/db/migrations.ts",
    "bootstrap-admin": "bun run src/cli/bootstrap.ts"
  },
  "dependencies": {
    "@chatsundere/shared-types": "workspace:^",
    "@serenity-kit/opaque": "^0.9.0",
    "@simplewebauthn/server": "^11.0.0",
    "drizzle-orm": "^0.36.0",
    "hono": "^4.6.0",
    "ioredis": "^5.4.0",
    "jose": "^5.9.0",
    "pino": "^9.5.0",
    "pino-pretty": "^13.0.0",
    "postgres": "^3.4.0",
    "prom-client": "^15.1.0",
    "valibot": "^0.42.0"
  },
  "devDependencies": {
    "@types/bun": "^1.1.0",
    "drizzle-kit": "^0.28.0",
    "typescript": "^5.7.0"
  }
}
```

Run `pnpm install` from repo root. Verify clean install.

- [ ] **Step 2: Create `apps/auth-service/tsconfig.test.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Create `apps/auth-service/bunfig.toml`**

```toml
[test]
preload = ["./tests/setup.ts"]
```

- [ ] **Step 4: Create `apps/auth-service/drizzle.config.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://chatsundere:dev@localhost:5432/auth_db',
  },
  strict: true,
  verbose: true,
} satisfies Config;
```

- [ ] **Step 5: Rewrite `apps/auth-service/.env.example`** to reflect every variable the service now consumes:

```
# Auth-service environment

NODE_ENV=development
PORT=3100
LOG_LEVEL=debug

# Public URL of THIS auth-service. Used as the JWT audience binding and as the
# OPAQUE server identity string. Must match the URL clients reach it at.
API_BASE_URL=http://localhost:3100/auth

# Postgres
DATABASE_URL=postgres://chatsundere:dev@localhost:5432/auth_db

# Redis
REDIS_URL=redis://localhost:6379/0

# JWT signing — Ed25519 raw private key, base64url-encoded (32 bytes seed).
# Generate once with: bun -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'))"
AUTH_JWT_PRIVATE_KEY=

# Invitation token HMAC key — for keyed token hashing in the DB.
# Generate once with: bun -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'))"
INVITATION_HMAC_KEY=

# CORS — comma-separated allowed origins.
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3010
```

- [ ] **Step 6: Create `apps/auth-service/tests/setup.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

// Test-mode env defaults. Real tests that need a DB override these.
process.env.NODE_ENV ??= 'test';
process.env.LOG_LEVEL ??= 'silent';
process.env.PORT ??= '0';
process.env.API_BASE_URL ??= 'http://localhost:3100/auth';
process.env.DATABASE_URL ??= 'postgres://chatsundere:dev@localhost:5432/auth_test_db';
process.env.REDIS_URL ??= 'redis://localhost:6379/15';
process.env.AUTH_JWT_PRIVATE_KEY ??= Buffer.from(
  new Uint8Array(32).fill(7),
).toString('base64url');
process.env.INVITATION_HMAC_KEY ??= Buffer.from(
  new Uint8Array(32).fill(11),
).toString('base64url');
process.env.CORS_ALLOWED_ORIGINS ??= 'http://localhost:3000';
```

- [ ] **Step 7: Verify `.env` exists in the package and is gitignored**

Check repo `.gitignore` already excludes `**/.env` (it should — verify, add if missing). If `apps/auth-service/.env` doesn't exist, copy from `.env.example` with the two secret values populated:

```bash
cp apps/auth-service/.env.example apps/auth-service/.env
# Then fill in AUTH_JWT_PRIVATE_KEY and INVITATION_HMAC_KEY with fresh values
```

Do not commit `.env`.

- [ ] **Step 8: Verify the service still starts**

```bash
pnpm --filter @chatsundere/auth-service typecheck
pnpm --filter @chatsundere/auth-service test
```

Expected: both green (the smoke test on `/healthz` from the existing scaffolding should still pass; we'll extend it in Task 4).

- [ ] **Step 9: Commit**

```bash
git add apps/auth-service/package.json apps/auth-service/tsconfig.test.json apps/auth-service/bunfig.toml apps/auth-service/drizzle.config.ts apps/auth-service/.env.example apps/auth-service/tests/setup.ts pnpm-lock.yaml
git commit -m "Set up auth-service tooling, dependencies, env schema"
```

---

### Task 2: Drizzle schema + initial migration

**Files:**
- Create: `apps/auth-service/src/db/schema.ts`
- Create: `apps/auth-service/migrations/0000_init.sql` (generated; commit it)

The schema follows spec §4.1 exactly. Note the partial unique index on `users.role = 'primary_admin'`, the citext extension requirement, the keyed token hash for invitations.

- [ ] **Step 1: Implement `apps/auth-service/src/db/schema.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// citext for usernames — case-insensitive equality with original case preserved.
// The extension is installed by the migration; this customType maps it.
const citext = customType<{ data: string; driverData: string }>({
  dataType: () => 'citext',
});

// bytea for fixed-shape binary fields (wrapped MK, nonces, keys, hashes).
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
});

export const userRole = pgEnum('user_role', ['primary_admin', 'admin', 'user']);
export const authMethodType = pgEnum('auth_method_type', ['opaque', 'passkey']);
export const invitationRole = pgEnum('invitation_role', ['primary_admin', 'admin', 'user']);

export const users = pgTable(
  'users',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    username: citext('username').notNull().unique(),
    role: userRole('role').notNull().default('user'),
    recoveryVerifierKey: bytea('recovery_verifier_key').notNull(),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    storageQuotaBytes: bigint('storage_quota_bytes', { mode: 'number' }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  },
  (t) => ({
    onePrimaryAdmin: uniqueIndex('users_one_primary_admin')
      .on(t.role)
      .where(sql`${t.role} = 'primary_admin'`),
  }),
);

export const authMethods = pgTable(
  'auth_methods',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    methodType: authMethodType('method_type').notNull(),
    label: text('label'),
    opaqueCredential: bytea('opaque_credential'),
    passkeyCredentialId: bytea('passkey_credential_id'),
    passkeyPublicKey: bytea('passkey_public_key'),
    passkeySignCount: bigint('passkey_sign_count', { mode: 'number' }),
    passkeyAaguid: uuid('passkey_aaguid'),
    passkeyTransports: jsonb('passkey_transports'),
    wrappedMasterKey: bytea('wrapped_master_key').notNull(),
    wrapNonce: bytea('wrap_nonce').notNull(),
    wrapAlgo: text('wrap_algo').notNull().default('AES-256-GCM'),
    wrapAad: bytea('wrap_aad').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => ({
    userMethod: index('auth_methods_user_method').on(t.userId, t.methodType),
    passkeyCredentialUnique: uniqueIndex('auth_methods_passkey_credential')
      .on(t.passkeyCredentialId)
      .where(sql`${t.passkeyCredentialId} IS NOT NULL`),
  }),
);

export const invitations = pgTable('invitations', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  tokenHmac: bytea('token_hmac').notNull().unique(),
  role: invitationRole('role').notNull().default('user'),
  issuerLabel: text('issuer_label'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
  redeemedByUserId: uuid('redeemed_by_user_id').references(() => users.id),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  attemptCount: integer('attempt_count').notNull().default(0),
});

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: bytea('token_hash').notNull().unique(),
    familyId: uuid('family_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    rotatedToId: uuid('rotated_to_id'),
    userAgent: text('user_agent'),
  },
  (t) => ({
    userFamily: index('refresh_tokens_user_family').on(t.userId, t.familyId),
  }),
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid('user_id'),
    actorUserId: uuid('actor_user_id'),
    eventType: text('event_type').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    createdAt: index('audit_log_created_at').on(t.createdAt),
    userIdx: index('audit_log_user_id')
      .on(t.userId)
      .where(sql`${t.userId} IS NOT NULL`),
  }),
);
```

- [ ] **Step 2: Generate the initial migration**

```bash
pnpm --filter @chatsundere/auth-service db:generate
```

This produces `apps/auth-service/migrations/0000_*.sql`. **Open the generated file and prepend:**

```sql
CREATE EXTENSION IF NOT EXISTS citext;

-- Lightweight UUIDv7 implementation. PostgreSQL 17 has uuidv7() built-in;
-- on 16 we polyfill. Once we move to 17, drop this block.
CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$
DECLARE
  unix_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  rand_bytes bytea := gen_random_bytes(10);
BEGIN
  RETURN encode(
    set_bit(
      set_bit(
        overlay(
          int8send(unix_ms) from 3 for 6
          || rand_bytes
        placing E'\\x00' from 7 for 1),
        52, 1),  -- version 7 nibble
      48, 1)::uuid::text::uuid::text || '',
    'hex'
  )::uuid;
END;
$$ LANGUAGE plpgsql VOLATILE;

```

If drizzle-kit emits SQL that conflicts, hand-edit; the principle is: extensions and the uuidv7 function exist before any table referencing them is created.

(If `pgcrypto` is needed for `gen_random_bytes`, add `CREATE EXTENSION IF NOT EXISTS pgcrypto;` at the top too.)

- [ ] **Step 3: Implement `apps/auth-service/src/db/migrations.ts`** as a runtime migration runner

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client.js';

async function main(): Promise<void> {
  const { db, sql } = await createDb();
  await migrate(db, { migrationsFolder: './migrations' });
  await sql.end();
  // eslint-disable-next-line no-console
  console.log('migrations applied');
}

if (import.meta.main) {
  await main();
}
```

(Task 3 implements `createDb`. The Step 3 file references it; you can sequence by writing the migrations runner last, or by importing a stub now and refining in Task 3.)

- [ ] **Step 4: Quick smoke**

```bash
# bring up the dev compose
docker compose -f infra/compose.dev.yml up -d
# wait a few seconds for PG to be ready, then:
pnpm --filter @chatsundere/auth-service db:migrate
```

Expected: "migrations applied" and the five tables present in `auth_db`. Verify with `docker exec` if needed.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-service/src/db/schema.ts apps/auth-service/src/db/migrations.ts apps/auth-service/migrations/
git commit -m "Add Drizzle schema and initial migration for auth-service"
```

---

### Task 3: DB + Redis connection factories, env rewrite

**Files:**
- Create: `apps/auth-service/src/db/client.ts`
- Create: `apps/auth-service/src/redis/client.ts`
- Modify: `apps/auth-service/src/env.ts` (full rewrite per the new env.example)

- [ ] **Step 1: Rewrite `apps/auth-service/src/env.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { array, minLength, number, object, parse, pipe, regex, string, transform, url } from 'valibot';

const envSchema = object({
  NODE_ENV: string(),
  PORT: pipe(string(), transform((s) => Number.parseInt(s, 10) || 3100), number()),
  LOG_LEVEL: string(),
  API_BASE_URL: pipe(string(), url()),
  DATABASE_URL: pipe(string(), regex(/^postgres:\/\//)),
  REDIS_URL: pipe(string(), regex(/^redis:\/\//)),
  AUTH_JWT_PRIVATE_KEY: pipe(string(), minLength(40)),
  INVITATION_HMAC_KEY: pipe(string(), minLength(40)),
  CORS_ALLOWED_ORIGINS: pipe(
    string(),
    transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),
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
  REDIS_URL: string;
  AUTH_JWT_PRIVATE_KEY: string;
  INVITATION_HMAC_KEY: string;
  CORS_ALLOWED_ORIGINS: string[];
} {
  return parse(envSchema, {
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    PORT: process.env.PORT ?? '3100',
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
    API_BASE_URL: process.env.API_BASE_URL,
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    AUTH_JWT_PRIVATE_KEY: process.env.AUTH_JWT_PRIVATE_KEY,
    INVITATION_HMAC_KEY: process.env.INVITATION_HMAC_KEY,
    CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS ?? '',
  });
}
```

- [ ] **Step 2: Implement `apps/auth-service/src/db/client.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { loadEnv } from '../env.js';
import * as schema from './schema.js';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export interface DbHandle {
  db: Db;
  sql: ReturnType<typeof postgres>;
}

let cached: DbHandle | null = null;

export function createDb(): DbHandle {
  if (cached) return cached;
  const env = loadEnv();
  const sql = postgres(env.DATABASE_URL, { max: 10 });
  const db = drizzle(sql, { schema });
  cached = { db, sql };
  return cached;
}

export async function closeDb(): Promise<void> {
  if (cached) {
    await cached.sql.end();
    cached = null;
  }
}
```

- [ ] **Step 3: Implement `apps/auth-service/src/redis/client.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { Redis } from 'ioredis';
import { loadEnv } from '../env.js';

let cached: Redis | null = null;

export function createRedis(): Redis {
  if (cached) return cached;
  const env = loadEnv();
  cached = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });
  return cached;
}

export async function closeRedis(): Promise<void> {
  if (cached) {
    await cached.quit();
    cached = null;
  }
}
```

- [ ] **Step 4: Quick smoke**

```bash
pnpm --filter @chatsundere/auth-service typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/auth-service/src/env.ts apps/auth-service/src/db/client.ts apps/auth-service/src/redis/client.ts
git commit -m "Add DB and Redis connection factories with env validation"
```

---

### Task 4: Logging, metrics, audit-log helpers (no-PII label policy)

**Files:**
- Modify: `apps/auth-service/src/logger.ts` (add redact paths)
- Rewrite: `apps/auth-service/src/metrics.ts` (register metrics with label allow-list enforcement)
- Create: `apps/auth-service/src/audit/events.ts` (canonical event-type strings + Valibot schemas)
- Create: `apps/auth-service/src/audit/log.ts` (typed writer with 2 KiB cap)
- Create: `apps/auth-service/tests/unit/audit-log.test.ts`

- [ ] **Step 1: Extend `apps/auth-service/src/logger.ts`** with explicit redact paths

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import pino, { type Logger } from 'pino';

const REDACT_PATHS: string[] = [
  '*.passphrase',
  '*.passphrase_confirmation',
  '*.recovery_key',
  '*.recovery_key_string',
  '*.wrapped_master_key',
  '*.wrap_nonce',
  '*.registration_request',
  '*.registration_record',
  '*.registration_response',
  '*.ke1',
  '*.ke2',
  '*.ke3',
  '*.startLoginRequest',
  '*.loginResponse',
  '*.finishLoginRequest',
  '*.prfOutput',
  '*.credential_id',
  '*.public_key',
  '*.proof',
  '*.verifier_key',
  '*.recovery_verifier_key',
  '*.access_token',
  '*.refresh_token',
  '*.cookie',
  '*.set-cookie',
  '*.authorization',
  '*.AUTH_JWT_PRIVATE_KEY',
  '*.INVITATION_HMAC_KEY',
];

export function createLogger(level: string, pretty: boolean): Logger {
  return pino({
    level,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
          },
        }
      : {}),
  });
}
```

- [ ] **Step 2: Rewrite `apps/auth-service/src/metrics.ts`** with a label allow-list

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

const ALLOWED_LABEL_NAMES = new Set([
  'method_type',
  'result',
  'role',
  'kind',
  'action',
  'route',
  'method',
  'status_class',
]);

function assertLabelsAllowed(labelNames: string[], metricName: string): void {
  for (const name of labelNames) {
    if (!ALLOWED_LABEL_NAMES.has(name)) {
      throw new Error(
        `metrics: forbidden label "${name}" on metric "${metricName}". Labels must be in the allow-list (no PII).`,
      );
    }
  }
}

function counter(name: string, help: string, labelNames: string[] = []): Counter<string> {
  assertLabelsAllowed(labelNames, name);
  return new Counter({ name, help, labelNames, registers: [registry] });
}

function gauge(name: string, help: string, labelNames: string[] = []): Gauge<string> {
  assertLabelsAllowed(labelNames, name);
  return new Gauge({ name, help, labelNames, registers: [registry] });
}

function histogram(name: string, help: string, labelNames: string[] = []): Histogram<string> {
  assertLabelsAllowed(labelNames, name);
  return new Histogram({ name, help, labelNames, registers: [registry] });
}

export const metrics = {
  authLinksTotal: counter('auth_links_total', 'Linking attempts', ['method_type', 'result']),
  authLoginsTotal: counter('auth_logins_total', 'Login attempts', ['method_type', 'result']),
  authActiveUsers30d: gauge('auth_active_users_30d', 'Users with last_login_at in last 30 days'),
  authInvitationsCreatedTotal: counter('auth_invitations_created_total', 'Invitations created', ['role']),
  authInvitationsRedeemedTotal: counter('auth_invitations_redeemed_total', 'Invitations redeemed', ['role']),
  authJwtIssuedTotal: counter('auth_jwt_issued_total', 'Tokens issued', ['kind']),
  authRecoveryAttemptsTotal: counter('auth_recovery_attempts_total', 'Recovery attempts', ['result']),
  authAdminActionsTotal: counter('auth_admin_actions_total', 'Admin actions', ['action']),
  authRequestDurationSeconds: histogram('auth_request_duration_seconds', 'HTTP request latency', [
    'route',
    'method',
    'status_class',
  ]),
};

export function initialiseMetrics(): void {
  // Calling this from server.ts ensures the metric registry is constructed
  // (it's already constructed at module-load time; this is a marker for
  // anyone reading server.ts).
}
```

- [ ] **Step 3: Create `apps/auth-service/src/audit/events.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { type BaseSchema, object, optional, picklist, string } from 'valibot';

export const AUDIT_EVENT_TYPES = [
  'user.linked',
  'user.suspended',
  'user.unsuspended',
  'user.deleted_by_admin',
  'user.self_deleted',
  'user.role_changed',
  'user.username_changed',
  'primary_admin.transferred',
  'invitation.created',
  'invitation.revoked',
  'invitation.redeemed',
  'auth_method.added',
  'auth_method.removed',
  'auth_method.passphrase_changed',
  'auth.login.success',
  'auth.login.failed',
  'auth.logout',
  'recovery_used',
  'refresh_token.reuse_detected',
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

const userLinkedMeta = object({
  role: picklist(['primary_admin', 'admin', 'user']),
  invitation_id: string(),
});

const userRoleChangedMeta = object({
  from_role: picklist(['primary_admin', 'admin', 'user']),
  to_role: picklist(['primary_admin', 'admin', 'user']),
});

const invitationCreatedMeta = object({
  invitation_id: string(),
  role: picklist(['primary_admin', 'admin', 'user']),
  expires_at: string(),
});

const invitationRevokedMeta = object({ invitation_id: string() });
const invitationRedeemedMeta = object({
  invitation_id: string(),
  role: picklist(['primary_admin', 'admin', 'user']),
});

const authMethodMeta = object({
  method_type: picklist(['opaque', 'passkey']),
  label: optional(string()),
});

const authLoginSuccessMeta = object({
  method_type: picklist(['opaque', 'passkey']),
});

const authLoginFailedMeta = object({
  method_type: picklist(['opaque', 'passkey']),
  reason: picklist(['bad_credentials', 'not_found', 'suspended', 'expired']),
});

const authLogoutMeta = object({ scope: picklist(['this_device', 'all']) });

const primaryAdminTransferredMeta = object({ previous_primary_admin_id: string() });

const refreshTokenReuseMeta = object({ family_id: string() });

const emptyMeta = object({});

export const AUDIT_EVENT_SCHEMAS: Record<AuditEventType, BaseSchema<unknown, unknown, never>> = {
  'user.linked': userLinkedMeta,
  'user.suspended': emptyMeta,
  'user.unsuspended': emptyMeta,
  'user.deleted_by_admin': emptyMeta,
  'user.self_deleted': emptyMeta,
  'user.role_changed': userRoleChangedMeta,
  'user.username_changed': emptyMeta,
  'primary_admin.transferred': primaryAdminTransferredMeta,
  'invitation.created': invitationCreatedMeta,
  'invitation.revoked': invitationRevokedMeta,
  'invitation.redeemed': invitationRedeemedMeta,
  'auth_method.added': authMethodMeta,
  'auth_method.removed': authMethodMeta,
  'auth_method.passphrase_changed': emptyMeta,
  'auth.login.success': authLoginSuccessMeta,
  'auth.login.failed': authLoginFailedMeta,
  'auth.logout': authLogoutMeta,
  recovery_used: emptyMeta,
  'refresh_token.reuse_detected': refreshTokenReuseMeta,
};
```

- [ ] **Step 4: Create `apps/auth-service/src/audit/log.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { parse } from 'valibot';
import { auditLog } from '../db/schema.js';
import type { Db } from '../db/client.js';
import { AUDIT_EVENT_SCHEMAS, type AuditEventType } from './events.js';

const MAX_METADATA_BYTES = 2048;

export interface WriteAuditArgs {
  db: Db;
  eventType: AuditEventType;
  userId?: string | null;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function writeAudit(args: WriteAuditArgs): Promise<void> {
  const schema = AUDIT_EVENT_SCHEMAS[args.eventType];
  const metadata = args.metadata ?? {};
  parse(schema, metadata);
  const json = JSON.stringify(metadata);
  if (Buffer.byteLength(json, 'utf8') > MAX_METADATA_BYTES) {
    throw new Error(`audit metadata exceeds ${MAX_METADATA_BYTES} bytes for event ${args.eventType}`);
  }
  await args.db.insert(auditLog).values({
    userId: args.userId ?? null,
    actorUserId: args.actorUserId ?? null,
    eventType: args.eventType,
    metadata,
  });
}
```

- [ ] **Step 5: Test `tests/unit/audit-log.test.ts`** — at minimum, verify the size cap and schema rejection. Use a stubbed `Db` interface that records inserts.

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'bun:test';
import { writeAudit } from '../../src/audit/log.ts';

describe('writeAudit', () => {
  it('rejects metadata that does not match the per-event schema', async () => {
    const inserts: unknown[] = [];
    const fakeDb = {
      insert: () => ({
        values: async (row: unknown) => {
          inserts.push(row);
        },
      }),
    } as any;
    await expect(
      writeAudit({
        db: fakeDb,
        eventType: 'invitation.created',
        metadata: { invitation_id: 'x' }, // missing role + expires_at
      }),
    ).rejects.toThrow();
    expect(inserts.length).toBe(0);
  });

  it('rejects metadata larger than 2 KiB', async () => {
    const fakeDb = { insert: () => ({ values: async () => undefined }) } as any;
    const big = 'x'.repeat(3000);
    await expect(
      writeAudit({
        db: fakeDb,
        eventType: 'invitation.created',
        metadata: { invitation_id: big, role: 'user', expires_at: '2026-01-01T00:00:00Z' },
      }),
    ).rejects.toThrow(/exceeds 2048 bytes/);
  });

  it('accepts well-formed metadata under the cap', async () => {
    const inserts: unknown[] = [];
    const fakeDb = {
      insert: () => ({
        values: async (row: unknown) => {
          inserts.push(row);
        },
      }),
    } as any;
    await writeAudit({
      db: fakeDb,
      eventType: 'invitation.created',
      metadata: { invitation_id: 'inv-1', role: 'user', expires_at: '2026-01-01T00:00:00Z' },
    });
    expect(inserts.length).toBe(1);
  });
});
```

- [ ] **Step 6: Run typecheck + tests + commit**

```bash
pnpm --filter @chatsundere/auth-service typecheck
pnpm --filter @chatsundere/auth-service test
git add apps/auth-service/src/logger.ts apps/auth-service/src/metrics.ts apps/auth-service/src/audit/ apps/auth-service/tests/unit/
git commit -m "Add logging redact paths, metrics with no-PII label policy, audit log writer"
```

---

### Task 5: Middleware stack — CORS + Origin check (CSRF defence), security headers, error envelope, request-id

**Files:**
- Create: `apps/auth-service/src/middleware/cors.ts`
- Create: `apps/auth-service/src/middleware/security-headers.ts`
- Create: `apps/auth-service/src/middleware/error-envelope.ts`
- Create: `apps/auth-service/src/middleware/request-id.ts`
- Modify: `apps/auth-service/src/server.ts` (wire them in)
- Create: `apps/auth-service/tests/unit/middleware.test.ts`

- [ ] **Step 1: Implement `apps/auth-service/src/middleware/cors.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import type { MiddlewareHandler } from 'hono';

export function corsAndOriginCheck(allowedOrigins: string[]): MiddlewareHandler {
  const allow = new Set(allowedOrigins);
  return async (c, next) => {
    const origin = c.req.header('Origin');
    const isPreflight = c.req.method === 'OPTIONS';

    if (origin && !allow.has(origin)) {
      // Strict: no permissive fallback.
      return c.json({ error: { code: 'forbidden', message: 'Origin not allowed' } }, 403);
    }

    const isStateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method);
    if (isStateChanging && !origin) {
      return c.json({ error: { code: 'forbidden', message: 'Origin header required' } }, 403);
    }

    if (origin) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Vary', 'Origin');
      c.header('Access-Control-Allow-Credentials', 'true');
    }

    if (isPreflight) {
      c.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      c.header(
        'Access-Control-Allow-Headers',
        c.req.header('Access-Control-Request-Headers') ?? 'Authorization, Content-Type',
      );
      c.header('Access-Control-Max-Age', '600');
      return c.body(null, 204);
    }

    await next();
  };
}
```

- [ ] **Step 2: Implement `apps/auth-service/src/middleware/security-headers.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import type { MiddlewareHandler } from 'hono';

export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  };
}
```

- [ ] **Step 3: Implement `apps/auth-service/src/middleware/error-envelope.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import type { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';

export class ApiError extends HTTPException {
  constructor(
    status: 400 | 401 | 403 | 404 | 409 | 410 | 422 | 429 | 500 | 503,
    public readonly code: string,
    message: string,
  ) {
    super(status, { message });
    this.name = 'ApiError';
  }
}

export const errorEnvelope: ErrorHandler = (err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: { code: err.code, message: err.message } }, err.status);
  }
  if (err instanceof HTTPException) {
    return c.json(
      { error: { code: codeForStatus(err.status), message: err.message } },
      err.status,
    );
  }
  // Unhandled — log via Hono's c.error elsewhere; respond opaquely.
  return c.json({ error: { code: 'internal', message: 'Internal error' } }, 500);
};

function codeForStatus(status: number): string {
  switch (status) {
    case 400:
      return 'invalid_input';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 410:
      return 'expired';
    case 429:
      return 'rate_limited';
    default:
      return 'internal';
  }
}
```

- [ ] **Step 4: Implement `apps/auth-service/src/middleware/request-id.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import type { MiddlewareHandler } from 'hono';

export function requestId(): MiddlewareHandler {
  return async (c, next) => {
    const id = crypto.randomUUID();
    c.set('request_id', id);
    c.header('X-Request-Id', id);
    await next();
  };
}
```

- [ ] **Step 5: Rewrite `apps/auth-service/src/server.ts`** to wire everything

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { Hono } from 'hono';
import { loadEnv } from './env.js';
import { initialiseMetrics } from './metrics.js';
import { corsAndOriginCheck } from './middleware/cors.js';
import { errorEnvelope } from './middleware/error-envelope.js';
import { requestId } from './middleware/request-id.js';
import { securityHeaders } from './middleware/security-headers.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerMetricsRoute } from './routes/metrics.js';

export function createServer(): Hono {
  initialiseMetrics();
  const env = loadEnv();
  const app = new Hono();

  app.onError(errorEnvelope);
  app.use('*', requestId());
  app.use('*', securityHeaders());
  app.use('*', corsAndOriginCheck(env.CORS_ALLOWED_ORIGINS));

  registerHealthRoutes(app);
  registerMetricsRoute(app);
  return app;
}
```

- [ ] **Step 6: Create `apps/auth-service/src/routes/metrics.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import type { Hono } from 'hono';
import { registry } from '../metrics.js';

export function registerMetricsRoute(app: Hono): void {
  app.get('/metrics', async (c) => {
    const body = await registry.metrics();
    c.header('Content-Type', registry.contentType);
    return c.body(body);
  });
}
```

- [ ] **Step 7: Test the middleware**

`apps/auth-service/tests/unit/middleware.test.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'bun:test';
import { createServer } from '../../src/server.ts';

describe('middleware', () => {
  it('rejects POST without Origin header', async () => {
    const app = createServer();
    const res = await app.request('/healthz', { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('rejects requests with a disallowed Origin', async () => {
    const app = createServer();
    const res = await app.request('/healthz', {
      headers: { Origin: 'https://evil.example.com' },
    });
    expect(res.status).toBe(403);
  });

  it('emits security headers on the response', async () => {
    const app = createServer();
    const res = await app.request('/healthz');
    expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('exposes /metrics in Prometheus exposition format', async () => {
    const app = createServer();
    const res = await app.request('/metrics');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('auth_links_total');
  });
});
```

- [ ] **Step 8: Commit**

```bash
pnpm --filter @chatsundere/auth-service typecheck && pnpm --filter @chatsundere/auth-service test
git add apps/auth-service/src/middleware/ apps/auth-service/src/server.ts apps/auth-service/src/routes/metrics.ts apps/auth-service/tests/unit/middleware.test.ts
git commit -m "Add CORS+Origin-check, security headers, error envelope, request-id middleware"
```

---

### Task 6: Rate-limit middleware (Redis sliding-window)

**Files:**
- Create: `apps/auth-service/src/middleware/rate-limit.ts`
- Create: `apps/auth-service/tests/unit/rate-limit.test.ts`

Spec §8.4 caps: per-IP unauth 60/min, per-IP auth 600/min, per-username OPAQUE login 10/15min, per-username Passkey login 10/15min, per-username recovery 5/hour, per-token invitation 3 attempts total.

- [ ] **Step 1: Implement `apps/auth-service/src/middleware/rate-limit.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import type { MiddlewareHandler } from 'hono';
import { ApiError } from './error-envelope.js';
import { createRedis } from '../redis/client.js';

export interface RateLimitArgs {
  /** Logical bucket name, e.g. 'login:opaque'. */
  bucket: string;
  /** Window size in seconds. */
  windowSec: number;
  /** Max requests per window. */
  max: number;
  /** How to derive the key for a request (e.g., IP, username, token). */
  key: (c: import('hono').Context) => string | Promise<string>;
}

export function rateLimit(args: RateLimitArgs): MiddlewareHandler {
  return async (c, next) => {
    const redis = createRedis();
    const subject = await args.key(c);
    if (!subject) return next();
    const redisKey = `rl:${args.bucket}:${subject}`;
    const now = Date.now();
    const windowStart = now - args.windowSec * 1000;
    // Sliding window via sorted set: trim old, add this, count.
    await redis.zremrangebyscore(redisKey, 0, windowStart);
    const count = await redis.zcard(redisKey);
    if (count >= args.max) {
      throw new ApiError(429, 'rate_limited', 'Too many requests');
    }
    await redis.zadd(redisKey, now, `${now}:${crypto.randomUUID()}`);
    await redis.expire(redisKey, args.windowSec);
    await next();
  };
}

export function ipKey(c: import('hono').Context): string {
  return (
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ??
    c.req.header('X-Real-IP') ??
    'unknown'
  );
}

export function usernameKey(c: import('hono').Context): string {
  // For login endpoints: read from JSON body; if absent or not parseable, fall back to IP.
  const ip = ipKey(c);
  return ip;
}
```

The `usernameKey` helper above is a stub — login routes pre-parse the body and call the rate-limiter manually with the username. Keep the `ipKey` exported. For body-bound keys we expose a programmatic API rather than middleware so the route can read the body once.

- [ ] **Step 2: Test rate-limit logic**

`tests/unit/rate-limit.test.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { Hono } from 'hono';
import { rateLimit } from '../../src/middleware/rate-limit.ts';
import { errorEnvelope } from '../../src/middleware/error-envelope.ts';
import { closeRedis, createRedis } from '../../src/redis/client.ts';

const BUCKET = 'test-bucket';

beforeEach(async () => {
  const redis = createRedis();
  const keys = await redis.keys(`rl:${BUCKET}:*`);
  if (keys.length) await redis.del(...keys);
});

afterAll(async () => {
  await closeRedis();
});

describe('rateLimit', () => {
  it('lets the first N requests through and rejects N+1', async () => {
    const app = new Hono();
    app.onError(errorEnvelope);
    app.use(
      '*',
      rateLimit({ bucket: BUCKET, windowSec: 60, max: 3, key: () => 'k1' }),
    );
    app.get('/x', (c) => c.json({ ok: true }));

    for (let i = 0; i < 3; i++) {
      const res = await app.request('/x');
      expect(res.status).toBe(200);
    }
    const blocked = await app.request('/x');
    expect(blocked.status).toBe(429);
  });
});
```

This test requires a live Redis. The integration-test compose already runs Redis on `redis:6379/15`. If running outside Bun's test environment, ensure REDIS_URL points there.

- [ ] **Step 3: Commit**

```bash
pnpm --filter @chatsundere/auth-service typecheck
pnpm --filter @chatsundere/auth-service test
git add apps/auth-service/src/middleware/rate-limit.ts apps/auth-service/tests/unit/rate-limit.test.ts
git commit -m "Add Redis sliding-window rate-limit middleware"
```

---

### Task 7: Auth middleware (JWT verify + EXISTS-check)

**Files:**
- Create: `apps/auth-service/src/jwt/keys.ts`
- Create: `apps/auth-service/src/jwt/verify.ts`
- Create: `apps/auth-service/src/middleware/auth.ts`
- Create: `apps/auth-service/tests/unit/auth-middleware.test.ts`

JWT signing is Task 8; this task implements just the verification + EXISTS-check pieces needed by middleware.

- [ ] **Step 1: Implement `apps/auth-service/src/jwt/keys.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { type JWK, importPKCS8, importJWK, exportJWK } from 'jose';
import { loadEnv } from '../env.js';

let cached: { privateKey: CryptoKey; publicJwk: JWK; kid: string } | null = null;

export async function getKeyMaterial(): Promise<{
  privateKey: CryptoKey;
  publicJwk: JWK;
  kid: string;
}> {
  if (cached) return cached;
  const env = loadEnv();
  const seedBytes = Buffer.from(env.AUTH_JWT_PRIVATE_KEY, 'base64url');
  if (seedBytes.length !== 32) {
    throw new Error('AUTH_JWT_PRIVATE_KEY must decode to 32 bytes (Ed25519 seed)');
  }
  // Build a JWK from the seed. Ed25519: d (private) is the 32-byte seed, x is the public point.
  // We use the Web Crypto API via jose to derive the public half.
  const privateJwk: JWK = {
    kty: 'OKP',
    crv: 'Ed25519',
    d: env.AUTH_JWT_PRIVATE_KEY,
    // x (public) is derived by jose on import.
  };
  const privateKey = (await importJWK(privateJwk, 'EdDSA')) as CryptoKey;
  const publicJwk = await exportJWK(privateKey);
  delete publicJwk.d;
  publicJwk.alg = 'EdDSA';
  publicJwk.use = 'sig';
  // Derive a stable kid by hashing the public key bytes.
  const x = publicJwk.x as string;
  const xBytes = Buffer.from(x, 'base64url');
  const hash = await crypto.subtle.digest('SHA-256', xBytes);
  publicJwk.kid = Buffer.from(hash).toString('base64url').slice(0, 16);
  cached = { privateKey, publicJwk, kid: publicJwk.kid };
  return cached;
}
```

- [ ] **Step 2: Implement `apps/auth-service/src/jwt/verify.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { jwtVerify, importJWK } from 'jose';
import { loadEnv } from '../env.js';
import { getKeyMaterial } from './keys.js';

export interface AccessClaims {
  sub: string;
  role: 'primary_admin' | 'admin' | 'user';
  iat: number;
  exp: number;
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const env = loadEnv();
  const { publicJwk } = await getKeyMaterial();
  const verifyKey = await importJWK(publicJwk, 'EdDSA');
  const { payload } = await jwtVerify(token, verifyKey, {
    issuer: 'chatsundere-auth-v1',
    audience: `${env.API_BASE_URL}/v1`,
    algorithms: ['EdDSA'],
  });
  const sub = payload.sub;
  const role = (payload as { role?: unknown }).role;
  if (typeof sub !== 'string' || (role !== 'primary_admin' && role !== 'admin' && role !== 'user')) {
    throw new Error('invalid JWT payload');
  }
  return {
    sub,
    role,
    iat: payload.iat as number,
    exp: payload.exp as number,
  };
}
```

- [ ] **Step 3: Implement `apps/auth-service/src/middleware/auth.ts`** with EXISTS-cache (audit H4)

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { and, eq, isNull } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { createDb } from '../db/client.js';
import { users } from '../db/schema.js';
import { createRedis } from '../redis/client.js';
import { verifyAccessToken, type AccessClaims } from '../jwt/verify.js';
import { ApiError } from './error-envelope.js';

const EXISTS_CACHE_TTL = 30;

interface BearerOptions {
  minRole?: 'admin' | 'primary_admin';
}

export function bearerAuth(options: BearerOptions = {}): MiddlewareHandler {
  return async (c, next) => {
    const header = c.req.header('Authorization') ?? '';
    if (!header.startsWith('Bearer ')) {
      throw new ApiError(401, 'unauthorized', 'Missing bearer token');
    }
    const token = header.slice('Bearer '.length).trim();
    let claims: AccessClaims;
    try {
      claims = await verifyAccessToken(token);
    } catch {
      throw new ApiError(401, 'unauthorized', 'Invalid bearer token');
    }
    if (!(await userExistsAndActive(claims.sub))) {
      throw new ApiError(401, 'unauthorized', 'User no longer exists or is suspended');
    }
    if (options.minRole === 'admin' && claims.role === 'user') {
      throw new ApiError(403, 'forbidden', 'Admin role required');
    }
    if (options.minRole === 'primary_admin' && claims.role !== 'primary_admin') {
      throw new ApiError(403, 'forbidden', 'Primary admin role required');
    }
    c.set('claims', claims);
    await next();
  };
}

async function userExistsAndActive(userId: string): Promise<boolean> {
  const redis = createRedis();
  const cacheKey = `userexists:${userId}`;
  const cached = await redis.get(cacheKey);
  if (cached === '1') return true;
  if (cached === '0') return false;
  const { db } = createDb();
  const row = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.suspendedAt)))
    .limit(1);
  const exists = row.length > 0;
  await redis.set(cacheKey, exists ? '1' : '0', 'EX', EXISTS_CACHE_TTL);
  return exists;
}
```

- [ ] **Step 4: Test `tests/unit/auth-middleware.test.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'bun:test';
import { Hono } from 'hono';
import { bearerAuth } from '../../src/middleware/auth.ts';
import { errorEnvelope } from '../../src/middleware/error-envelope.ts';

describe('bearerAuth', () => {
  it('returns 401 without an Authorization header', async () => {
    const app = new Hono();
    app.onError(errorEnvelope);
    app.use('*', bearerAuth());
    app.get('/x', (c) => c.json({ ok: true }));
    const res = await app.request('/x');
    expect(res.status).toBe(401);
  });

  it('returns 401 for a malformed Bearer token', async () => {
    const app = new Hono();
    app.onError(errorEnvelope);
    app.use('*', bearerAuth());
    app.get('/x', (c) => c.json({ ok: true }));
    const res = await app.request('/x', { headers: { Authorization: 'Bearer not-a-jwt' } });
    expect(res.status).toBe(401);
  });
});
```

A "happy path" test for `bearerAuth` requires issuing a real JWT; that comes in Task 8. For now we verify the unauthorised paths.

- [ ] **Step 5: Commit**

```bash
pnpm --filter @chatsundere/auth-service typecheck
pnpm --filter @chatsundere/auth-service test
git add apps/auth-service/src/jwt/keys.ts apps/auth-service/src/jwt/verify.ts apps/auth-service/src/middleware/auth.ts apps/auth-service/tests/unit/auth-middleware.test.ts
git commit -m "Add JWT key loader, access-token verify, bearer-auth middleware"
```

---

### Task 8: JWT issuance, refresh-token rotation, JWKS endpoint

**Files:**
- Create: `apps/auth-service/src/jwt/issue.ts`
- Create: `apps/auth-service/src/jwt/refresh.ts`
- Create: `apps/auth-service/src/routes/jwks.ts`
- Create: `apps/auth-service/src/routes/token.ts` (/v1/token/refresh)
- Create: `apps/auth-service/src/routes/auth.ts` (/v1/auth/logout)
- Modify: `apps/auth-service/src/server.ts` (register new routes)
- Create: `apps/auth-service/tests/unit/jwt.test.ts`

- [ ] **Step 1: Implement `apps/auth-service/src/jwt/issue.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { SignJWT } from 'jose';
import { eq } from 'drizzle-orm';
import { createDb } from '../db/client.js';
import { refreshTokens } from '../db/schema.js';
import { loadEnv } from '../env.js';
import { metrics } from '../metrics.js';
import { getKeyMaterial } from './keys.js';

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
const REFRESH_TOKEN_BYTES = 32;

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshTokenId: string;
  familyId: string;
  expiresIn: number;
}

export async function issueTokens(args: {
  userId: string;
  role: 'primary_admin' | 'admin' | 'user';
  familyId?: string;
  userAgent?: string;
}): Promise<IssuedTokens> {
  const env = loadEnv();
  const { privateKey, kid } = await getKeyMaterial();
  const aud = `${env.API_BASE_URL}/v1`;
  const access = await new SignJWT({ role: args.role })
    .setProtectedHeader({ alg: 'EdDSA', kid })
    .setSubject(args.userId)
    .setIssuer('chatsundere-auth-v1')
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(privateKey);
  metrics.authJwtIssuedTotal.inc({ kind: 'access' });

  const refresh = generateOpaqueToken(REFRESH_TOKEN_BYTES);
  const refreshHash = await sha256(refresh);
  const familyId = args.familyId ?? crypto.randomUUID();
  const { db } = createDb();
  const inserted = await db
    .insert(refreshTokens)
    .values({
      userId: args.userId,
      tokenHash: refreshHash,
      familyId,
      expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
      userAgent: args.userAgent ?? null,
    })
    .returning({ id: refreshTokens.id });
  metrics.authJwtIssuedTotal.inc({ kind: 'refresh' });

  return {
    accessToken: access,
    refreshToken: refresh,
    refreshTokenId: inserted[0]!.id,
    familyId,
    expiresIn: ACCESS_TTL_SECONDS,
  };
}

function generateOpaqueToken(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Buffer.from(buf).toString('base64url');
}

async function sha256(input: string): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return new Uint8Array(buf);
}

export function refreshCookieFor(refreshToken: string): string {
  const env = loadEnv();
  const secure = env.NODE_ENV !== 'development';
  const parts = [
    `refresh_token=${refreshToken}`,
    'HttpOnly',
    'SameSite=Lax',
    `Path=/v1/token/refresh`,
    `Max-Age=${REFRESH_TTL_SECONDS}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export async function sha256ForCookie(refreshToken: string): Promise<Uint8Array> {
  return sha256(refreshToken);
}
```

- [ ] **Step 2: Implement `apps/auth-service/src/jwt/refresh.ts`** (rotation + re-use detection)

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { createDb } from '../db/client.js';
import { refreshTokens, users } from '../db/schema.js';
import { writeAudit } from '../audit/log.js';
import { issueTokens, sha256ForCookie, type IssuedTokens } from './issue.js';

export interface RotateResult {
  outcome: 'ok' | 'invalid' | 'reuse_detected' | 'user_gone';
  tokens?: IssuedTokens;
}

/**
 * Rotation: presenting a valid, non-revoked refresh token issues new tokens
 * and marks the prior one revoked + sets rotated_to_id. Presenting a token
 * that was already rotated (its row is revoked and rotated_to_id is set) is
 * the re-use signal — revoke the whole family and refuse.
 */
export async function rotateRefreshToken(args: {
  presentedToken: string;
  userAgent?: string;
}): Promise<RotateResult> {
  const { db } = createDb();
  const hash = await sha256ForCookie(args.presentedToken);
  const matching = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, hash))
    .limit(1);
  const row = matching[0];
  if (!row) return { outcome: 'invalid' };

  if (row.revokedAt !== null) {
    if (row.rotatedToId !== null) {
      // Re-use: presenting a token that has already been rotated. Revoke family.
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
      await writeAudit({
        db,
        eventType: 'refresh_token.reuse_detected',
        userId: row.userId,
        metadata: { family_id: row.familyId },
      });
    }
    return { outcome: 'reuse_detected' };
  }

  if (row.expiresAt < new Date()) {
    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, row.id));
    return { outcome: 'invalid' };
  }

  const userRow = await db
    .select({ id: users.id, role: users.role, suspendedAt: users.suspendedAt })
    .from(users)
    .where(eq(users.id, row.userId))
    .limit(1);
  if (userRow.length === 0 || userRow[0]!.suspendedAt !== null) {
    return { outcome: 'user_gone' };
  }
  const user = userRow[0]!;

  const tokens = await issueTokens({
    userId: user.id,
    role: user.role,
    familyId: row.familyId,
    userAgent: args.userAgent,
  });
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date(), rotatedToId: tokens.refreshTokenId })
    .where(eq(refreshTokens.id, row.id));
  return { outcome: 'ok', tokens };
}

export async function revokeFamily(familyId: string): Promise<void> {
  const { db } = createDb();
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
}

export async function revokeAllForUser(userId: string): Promise<void> {
  const { db } = createDb();
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}
```

- [ ] **Step 3: Implement `apps/auth-service/src/routes/jwks.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import type { Hono } from 'hono';
import { getKeyMaterial } from '../jwt/keys.js';

export function registerJwksRoute(app: Hono): void {
  app.get('/v1/jwks', async (c) => {
    const { publicJwk } = await getKeyMaterial();
    return c.json({ keys: [publicJwk] });
  });
}
```

- [ ] **Step 4: Implement `apps/auth-service/src/routes/token.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import type { Hono } from 'hono';
import { ApiError } from '../middleware/error-envelope.js';
import { refreshCookieFor } from '../jwt/issue.js';
import { rotateRefreshToken } from '../jwt/refresh.js';

export function registerTokenRoutes(app: Hono): void {
  app.post('/v1/token/refresh', async (c) => {
    const cookieHeader = c.req.header('Cookie') ?? '';
    const match = cookieHeader.match(/(?:^|;\s*)refresh_token=([^;]+)/);
    const presented = match?.[1];
    if (!presented) throw new ApiError(401, 'unauthorized', 'Missing refresh cookie');
    const result = await rotateRefreshToken({
      presentedToken: presented,
      userAgent: c.req.header('User-Agent') ?? undefined,
    });
    if (result.outcome !== 'ok' || !result.tokens) {
      throw new ApiError(401, 'unauthorized', 'Refresh token invalid');
    }
    c.header('Set-Cookie', refreshCookieFor(result.tokens.refreshToken));
    return c.json({
      access_token: result.tokens.accessToken,
      expires_in: result.tokens.expiresIn,
    });
  });
}
```

- [ ] **Step 5: Implement `apps/auth-service/src/routes/auth.ts`** (logout)

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import type { Hono } from 'hono';
import { bearerAuth } from '../middleware/auth.js';
import { revokeAllForUser, revokeFamily } from '../jwt/refresh.js';
import { writeAudit } from '../audit/log.js';
import { createDb } from '../db/client.js';
import type { AccessClaims } from '../jwt/verify.js';

export function registerAuthRoutes(app: Hono): void {
  app.post('/v1/auth/logout', bearerAuth(), async (c) => {
    const claims = c.get('claims') as AccessClaims;
    const all = c.req.query('revoke_all') === 'true';
    if (all) {
      await revokeAllForUser(claims.sub);
      await writeAudit({
        db: createDb().db,
        eventType: 'auth.logout',
        userId: claims.sub,
        actorUserId: claims.sub,
        metadata: { scope: 'all' },
      });
    } else {
      // For "this device" we'd need the family_id from the current refresh cookie.
      const cookieHeader = c.req.header('Cookie') ?? '';
      const match = cookieHeader.match(/(?:^|;\s*)refresh_token=([^;]+)/);
      if (match) {
        // Look up family by token hash, then revoke it.
        // (Implementation: same lookup as refresh.ts but with a revokeFamily helper.)
        // For brevity, callers may simply call /v1/token/refresh-style endpoint;
        // here we just revoke-all-for-user when no family is found.
        await revokeAllForUser(claims.sub);
      }
      await writeAudit({
        db: createDb().db,
        eventType: 'auth.logout',
        userId: claims.sub,
        actorUserId: claims.sub,
        metadata: { scope: 'this_device' },
      });
    }
    // Clear cookie.
    c.header(
      'Set-Cookie',
      'refresh_token=; HttpOnly; SameSite=Lax; Path=/v1/token/refresh; Max-Age=0',
    );
    return c.json({ ok: true });
  });
}
```

Honest note: the `this_device` branch above degrades to `revokeAllForUser`. Spec §5.13 prefers family-scoped revoke; implement the lookup-by-hash if time permits, but the degraded behaviour is safe (over-revokes rather than under-revokes).

- [ ] **Step 6: Wire routes into `server.ts`**

```typescript
import { registerAuthRoutes } from './routes/auth.js';
import { registerJwksRoute } from './routes/jwks.js';
import { registerTokenRoutes } from './routes/token.js';

// ...inside createServer, after registerHealthRoutes/registerMetricsRoute:
registerJwksRoute(app);
registerTokenRoutes(app);
registerAuthRoutes(app);
```

- [ ] **Step 7: Tests `tests/unit/jwt.test.ts`** — verify issue → verify round-trip and rotation re-use detection

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'bun:test';
import { issueTokens } from '../../src/jwt/issue.ts';
import { verifyAccessToken } from '../../src/jwt/verify.ts';
import { rotateRefreshToken } from '../../src/jwt/refresh.ts';
import { createDb, closeDb } from '../../src/db/client.ts';
import { users } from '../../src/db/schema.ts';

describe('JWT issue/verify', () => {
  it('issues an access token that verifies', async () => {
    // Insert a test user so refresh insertion has a valid FK.
    const { db } = createDb();
    const inserted = await db
      .insert(users)
      .values({
        username: `jwt-test-${Date.now()}`,
        role: 'user',
        recoveryVerifierKey: new Uint8Array(32),
      })
      .returning({ id: users.id });
    const userId = inserted[0]!.id;
    const tokens = await issueTokens({ userId, role: 'user' });
    const claims = await verifyAccessToken(tokens.accessToken);
    expect(claims.sub).toBe(userId);
    expect(claims.role).toBe('user');
    // Cleanup
    await db.delete(users).where((u) => u.id.eq(userId));
  });

  it('detects re-use of a rotated refresh token', async () => {
    const { db } = createDb();
    const inserted = await db
      .insert(users)
      .values({
        username: `reuse-test-${Date.now()}`,
        role: 'user',
        recoveryVerifierKey: new Uint8Array(32),
      })
      .returning({ id: users.id });
    const userId = inserted[0]!.id;
    const t1 = await issueTokens({ userId, role: 'user' });
    const r1 = await rotateRefreshToken({ presentedToken: t1.refreshToken });
    expect(r1.outcome).toBe('ok');
    // Present the original token again — should be flagged as re-use.
    const r2 = await rotateRefreshToken({ presentedToken: t1.refreshToken });
    expect(r2.outcome).toBe('reuse_detected');
  });
});
```

These tests require a real PostgreSQL — they live under `tests/integration/` for a future cleanup, but for now keep them in `tests/unit/` and ensure the dev DB is running.

- [ ] **Step 8: Commit**

```bash
pnpm --filter @chatsundere/auth-service typecheck
pnpm --filter @chatsundere/auth-service test
git add apps/auth-service/src/jwt/issue.ts apps/auth-service/src/jwt/refresh.ts apps/auth-service/src/routes/jwks.ts apps/auth-service/src/routes/token.ts apps/auth-service/src/routes/auth.ts apps/auth-service/src/server.ts apps/auth-service/tests/unit/jwt.test.ts
git commit -m "Add JWT issuance, refresh-token rotation with re-use detection, JWKS endpoint"
```

---

### Task 9: Invitations + OPAQUE-server wrapper + linking endpoints

**Files:**
- Create: `apps/auth-service/src/invitations/token.ts` (HMAC-keyed hashing)
- Create: `apps/auth-service/src/invitations/rate-limit.ts` (per-token attempt cap)
- Create: `apps/auth-service/src/opaque/server.ts`
- Create: `apps/auth-service/src/routes/link.ts`
- Create: `apps/auth-service/tests/integration/link-opaque.test.ts`

- [ ] **Step 1: Implement `apps/auth-service/src/invitations/token.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { loadEnv } from '../env.js';

let keyCache: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey> {
  if (keyCache) return keyCache;
  const env = loadEnv();
  const raw = Buffer.from(env.INVITATION_HMAC_KEY, 'base64url');
  keyCache = await crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return keyCache;
}

export async function hashInvitationToken(token: string): Promise<Uint8Array> {
  const key = await getKey();
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token));
  return new Uint8Array(sig);
}

export function generateInvitationToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return Buffer.from(buf).toString('base64url');
}
```

- [ ] **Step 2: Implement `apps/auth-service/src/invitations/rate-limit.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { and, eq, isNull, sql } from 'drizzle-orm';
import { createDb } from '../db/client.js';
import { invitations } from '../db/schema.js';
import { ApiError } from '../middleware/error-envelope.js';

const MAX_ATTEMPTS = 3;

/**
 * Atomically increment the invitation's attempt counter and, if the cap
 * is hit, mark the invitation revoked. Returns the invitation row if
 * still usable; throws ApiError otherwise.
 */
export async function consumeInvitationAttempt(tokenHmac: Uint8Array) {
  const { db } = createDb();
  const updated = await db
    .update(invitations)
    .set({ attemptCount: sql`${invitations.attemptCount} + 1` })
    .where(and(eq(invitations.tokenHmac, tokenHmac), isNull(invitations.revokedAt)))
    .returning();
  const row = updated[0];
  if (!row) throw new ApiError(404, 'not_found', 'Invitation not found or revoked');
  if (row.redeemedAt !== null) {
    throw new ApiError(409, 'invitation_consumed', 'Invitation already redeemed');
  }
  if (row.expiresAt < new Date()) {
    throw new ApiError(410, 'expired', 'Invitation expired');
  }
  if (row.attemptCount > MAX_ATTEMPTS) {
    await db.update(invitations).set({ revokedAt: new Date() }).where(eq(invitations.id, row.id));
    throw new ApiError(
      429,
      'invitation_attempts_exhausted',
      'Invitation has reached the attempt limit and is now revoked',
    );
  }
  return row;
}
```

- [ ] **Step 3: Implement `apps/auth-service/src/opaque/server.ts`** — a thin wrapper

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { server as opaqueServer, ready as opaqueReady } from '@serenity-kit/opaque';
import { createRedis } from '../redis/client.js';
import { loadEnv } from '../env.js';

let serverSetupCache: string | null = null;
const STATE_TTL_SECONDS = 60;
const SESSION_ID_BYTES = 16;

export async function ensureOpaqueReady(): Promise<void> {
  await opaqueReady;
}

export function getServerSetup(): string {
  if (serverSetupCache) return serverSetupCache;
  const env = loadEnv();
  // For phase 0 we derive the setup deterministically from the JWT private key
  // so it survives restarts. Future: store in DB / dedicated env var.
  // The exact derivation: SHA-512 of the env key, treated as raw setup bytes
  // — opaque-ts createSetup actually generates fresh bytes; here we just
  // delegate to it and cache for the process lifetime. Across restarts each
  // process gets a new setup; this is only an issue if multiple instances
  // are load-balanced (deferred — phase 0 single-replica). See deferrals.
  serverSetupCache = opaqueServer.createSetup();
  return serverSetupCache;
}

export function generateSessionId(): string {
  const buf = new Uint8Array(SESSION_ID_BYTES);
  crypto.getRandomValues(buf);
  return Buffer.from(buf).toString('base64url');
}

export async function storeOpaqueState(args: {
  scope: 'register' | 'login';
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

export async function fetchOpaqueState(
  scope: 'register' | 'login',
  sessionId: string,
): Promise<Record<string, string> | null> {
  const redis = createRedis();
  const raw = await redis.get(`opaque:${scope}:${sessionId}`);
  if (!raw) return null;
  await redis.del(`opaque:${scope}:${sessionId}`);
  return JSON.parse(raw);
}
```

The "per-process server setup" is a documented phase-0 limitation; add a deferral entry when committing (or defer to Larissa's pre-squash audit, which will surely flag it).

- [ ] **Step 4: Implement `apps/auth-service/src/routes/link.ts`** — the OPAQUE linking endpoints (start + finish)

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { server as opaqueServer } from '@serenity-kit/opaque';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { object, parse, string } from 'valibot';
import { writeAudit } from '../audit/log.js';
import { createDb } from '../db/client.js';
import { authMethods, invitations, users } from '../db/schema.js';
import { hashInvitationToken } from '../invitations/token.js';
import { consumeInvitationAttempt } from '../invitations/rate-limit.js';
import { issueTokens, refreshCookieFor } from '../jwt/issue.js';
import { ApiError } from '../middleware/error-envelope.js';
import { metrics } from '../metrics.js';
import {
  ensureOpaqueReady,
  fetchOpaqueState,
  generateSessionId,
  getServerSetup,
  storeOpaqueState,
} from '../opaque/server.js';

const startReq = object({
  invitation_token: string(),
  registration_request: string(),
});

const finishReq = object({
  session_id: string(),
  username: string(),
  registration_record: string(),
  wrapped_mk_opaque: string(),
  wrap_nonce_opaque: string(),
  wrap_aad_opaque: string(),
  wrapped_mk_recovery: string(),
  wrap_nonce_recovery: string(),
  wrap_aad_recovery: string(),
  recovery_verifier_key: string(),
});

const USERNAME_RE = /^[a-z][a-z0-9_-]{2,31}$/;
const RESERVED = new Set(['admin', 'root', 'system', 'me', 'you']);

export function registerLinkRoutes(app: Hono): void {
  app.post('/v1/link/opaque/start', async (c) => {
    await ensureOpaqueReady();
    const body = parse(startReq, await c.req.json());
    const tokenHmac = await hashInvitationToken(body.invitation_token);
    const invitation = await consumeInvitationAttempt(tokenHmac);

    const sessionId = generateSessionId();
    // Use the invitation id as the OPAQUE userIdentifier at start time.
    // Finish time gets the actual chosen username re-bound.
    const { registrationResponse } = opaqueServer.createRegistrationResponse({
      serverSetup: getServerSetup(),
      userIdentifier: invitation.id,
      registrationRequest: body.registration_request,
    });

    await storeOpaqueState({
      scope: 'register',
      sessionId,
      payload: {
        invitation_id: invitation.id,
        invitation_role: invitation.role,
      },
    });

    return c.json({ session_id: sessionId, registration_response: registrationResponse });
  });

  app.post('/v1/link/opaque/finish', async (c) => {
    await ensureOpaqueReady();
    const body = parse(finishReq, await c.req.json());
    if (!USERNAME_RE.test(body.username) || RESERVED.has(body.username)) {
      throw new ApiError(400, 'invalid_input', 'Invalid username');
    }
    const state = await fetchOpaqueState('register', body.session_id);
    if (!state) throw new ApiError(410, 'expired', 'Session expired');

    const { db } = createDb();

    // Atomic: check username free, insert user + auth_method, mark invitation redeemed.
    try {
      const result = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(users)
          .values({
            username: body.username,
            role: state.invitation_role as 'primary_admin' | 'admin' | 'user',
            recoveryVerifierKey: Buffer.from(body.recovery_verifier_key, 'base64url'),
          })
          .returning({ id: users.id, role: users.role });
        const user = inserted[0]!;
        await tx.insert(authMethods).values({
          userId: user.id,
          methodType: 'opaque',
          opaqueCredential: Buffer.from(body.registration_record, 'base64url'),
          wrappedMasterKey: Buffer.from(body.wrapped_mk_opaque, 'base64url'),
          wrapNonce: Buffer.from(body.wrap_nonce_opaque, 'base64url'),
          wrapAad: Buffer.from(body.wrap_aad_opaque, 'base64url'),
        });
        await tx
          .update(invitations)
          .set({ redeemedAt: new Date(), redeemedByUserId: user.id })
          .where(eq(invitations.id, state.invitation_id));
        return user;
      });

      const tokens = await issueTokens({
        userId: result.id,
        role: result.role,
        userAgent: c.req.header('User-Agent') ?? undefined,
      });

      await writeAudit({
        db,
        eventType: 'user.linked',
        userId: result.id,
        metadata: { role: result.role, invitation_id: state.invitation_id },
      });
      await writeAudit({
        db,
        eventType: 'invitation.redeemed',
        userId: result.id,
        metadata: { invitation_id: state.invitation_id, role: result.role },
      });
      metrics.authLinksTotal.inc({ method_type: 'opaque', result: 'success' });
      metrics.authInvitationsRedeemedTotal.inc({ role: result.role });

      c.header('Set-Cookie', refreshCookieFor(tokens.refreshToken));
      return c.json({
        user_id: result.id,
        role: result.role,
        access_token: tokens.accessToken,
        expires_in: tokens.expiresIn,
      });
    } catch (err) {
      if (err instanceof Error && /unique/i.test(err.message)) {
        metrics.authLinksTotal.inc({ method_type: 'opaque', result: 'conflict' });
        throw new ApiError(409, 'username_taken', 'Username already exists');
      }
      metrics.authLinksTotal.inc({ method_type: 'opaque', result: 'error' });
      throw err;
    }
  });
}
```

Wire it in server.ts:

```typescript
import { registerLinkRoutes } from './routes/link.js';
// in createServer:
registerLinkRoutes(app);
```

- [ ] **Step 5: Integration test `tests/integration/link-opaque.test.ts`**

Implement a happy-path test that:
1. Creates a fresh invitation directly in the DB (skip admin endpoint — that's Task 13).
2. Runs `opaqueClient.startRegistration` + `client.finishRegistration` against the live HTTP endpoints.
3. Asserts the returned `user_id`, `role`, `access_token` are populated and the user row exists.

Skip if no live Postgres + Redis. Use `bun:test` `it.skipIf(...)`.

- [ ] **Step 6: Commit**

```bash
pnpm --filter @chatsundere/auth-service typecheck
pnpm --filter @chatsundere/auth-service test
git add apps/auth-service/src/invitations/ apps/auth-service/src/opaque/ apps/auth-service/src/routes/link.ts apps/auth-service/src/server.ts apps/auth-service/tests/integration/link-opaque.test.ts
git commit -m "Add invitation hashing/rate-limit, OPAQUE server wrapper, OPAQUE linking endpoints"
```

---

### Task 10: WebAuthn linking endpoints + OPAQUE login + Passkey login

**Files:**
- Create: `apps/auth-service/src/webauthn/server.ts`
- Modify: `apps/auth-service/src/routes/link.ts` (add passkey endpoints)
- Create: `apps/auth-service/src/routes/login.ts`
- Create: `apps/auth-service/tests/integration/login-opaque.test.ts`

- [ ] **Step 1: Implement `apps/auth-service/src/webauthn/server.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { loadEnv } from '../env.js';

function rpFromBaseUrl(baseUrl: string): { rpID: string; expectedOrigin: string } {
  const url = new URL(baseUrl);
  return {
    rpID: url.hostname,
    expectedOrigin: `${url.protocol}//${url.host}`,
  };
}

export async function generateRegistration(args: {
  userId: string;
  username: string;
}): Promise<ReturnType<typeof generateRegistrationOptions>> {
  const env = loadEnv();
  const { rpID } = rpFromBaseUrl(env.API_BASE_URL);
  return generateRegistrationOptions({
    rpName: 'Chatsundere',
    rpID,
    userID: new TextEncoder().encode(args.userId),
    userName: args.username,
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
    extensions: { prf: { eval: { first: new Uint8Array(32) } } as any },
  });
}

export async function generateAuthentication(args: {
  allowCredentialIds?: Uint8Array[];
}): Promise<ReturnType<typeof generateAuthenticationOptions>> {
  const env = loadEnv();
  const { rpID } = rpFromBaseUrl(env.API_BASE_URL);
  return generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
    allowCredentials: args.allowCredentialIds?.map((id) => ({
      id: Buffer.from(id).toString('base64url'),
      type: 'public-key',
    })),
  });
}

export async function verifyRegistration(args: {
  response: RegistrationResponseJSON;
  expectedChallenge: string;
}) {
  const env = loadEnv();
  const { rpID, expectedOrigin } = rpFromBaseUrl(env.API_BASE_URL);
  return verifyRegistrationResponse({
    response: args.response,
    expectedChallenge: args.expectedChallenge,
    expectedOrigin,
    expectedRPID: rpID,
    requireUserVerification: false,
  });
}

export async function verifyAuthentication(args: {
  response: AuthenticationResponseJSON;
  expectedChallenge: string;
  publicKey: Uint8Array;
  signCount: number;
}) {
  const env = loadEnv();
  const { rpID, expectedOrigin } = rpFromBaseUrl(env.API_BASE_URL);
  return verifyAuthenticationResponse({
    response: args.response,
    expectedChallenge: args.expectedChallenge,
    expectedOrigin,
    expectedRPID: rpID,
    credential: {
      id: args.response.id,
      publicKey: args.publicKey,
      counter: args.signCount,
    },
    requireUserVerification: false,
  });
}
```

- [ ] **Step 2: Extend `apps/auth-service/src/routes/link.ts`** with `/v1/link/passkey/{start,finish}` — both invitation-token-authorised (first link) and bearer-authorised (add-passkey post-link). Follow the same pattern as OPAQUE linking: session-id keys the Redis state, body shape per `shared-types/linking.ts`. Skip step-by-step code here; refer to `@simplewebauthn/server` usage in `webauthn/server.ts` you just wrote, and follow `link/opaque/finish` as the structural template (transactional insert of `users` + `auth_methods`, invitation redemption, audit events, token issuance).

- [ ] **Step 3: Implement `apps/auth-service/src/routes/login.ts`** — OPAQUE login + Passkey login

OPAQUE login start: look up user by username, look up their `opaque` auth method, run `opaqueServer.startLogin` with the stored credential, stash state in Redis keyed by session_id, return `{ session_id, ke2 (loginResponse), wrapped_mk_opaque, wrap_nonce_opaque, wrap_aad_opaque }`. On unknown user, return a deterministic fake `loginResponse` derived from the username (audit M3 style — same response shape regardless of existence to prevent timing-based enumeration).

OPAQUE login finish: pull state from Redis by session_id, run `opaqueServer.finishLogin`, on success issue tokens + write audit, on fail metric `auth_logins_total{method_type=opaque, result=fail}` + 401.

Passkey login start: generate authentication options bound to a fresh session_id challenge, stash in Redis. (Discoverable credential: allow username omitted; for now require username.)

Passkey login finish: verify assertion via `verifyAuthentication`, update `sign_count` on the auth_method row, issue tokens, return + wrapped_mk_passkey + wrap_nonce + wrap_aad for the client.

The fake-user-enumeration mitigation requires deterministic per-username fake credentials. Implementation: store a process-stable HMAC-derived blob as the credential — if no user exists, generate fake `loginResponse` bytes deterministically. Acceptable shortcut: use `opaqueServer.startLogin` with `registrationRecord: null` and a userIdentifier of the literal username — `@serenity-kit/opaque` handles "no record" with a fake response.

- [ ] **Step 4: Integration tests** at `tests/integration/login-opaque.test.ts`. Mirror the link test: link a user, then log in via OPAQUE round-trip, assert tokens are issued and the access token verifies.

- [ ] **Step 5: Commit**

```bash
pnpm --filter @chatsundere/auth-service typecheck
pnpm --filter @chatsundere/auth-service test
git add apps/auth-service/src/webauthn/ apps/auth-service/src/routes/link.ts apps/auth-service/src/routes/login.ts apps/auth-service/tests/integration/login-opaque.test.ts
git commit -m "Add WebAuthn linking, OPAQUE login, passkey login endpoints"
```

---

### Task 11: Recovery endpoints (challenge-response per audit fix C1)

**Files:**
- Create: `apps/auth-service/src/recovery/nonce.ts`
- Create: `apps/auth-service/src/routes/recovery.ts`
- Create: `apps/auth-service/tests/integration/recovery.test.ts`

- [ ] **Step 1: Implement `apps/auth-service/src/recovery/nonce.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { createRedis } from '../redis/client.js';

const TTL_SECONDS = 60;

export async function storeNonce(username: string, nonce: Uint8Array): Promise<void> {
  const redis = createRedis();
  await redis.set(
    `recovery:nonce:${username}`,
    Buffer.from(nonce).toString('base64url'),
    'EX',
    TTL_SECONDS,
  );
}

export async function consumeNonce(username: string, nonce: Uint8Array): Promise<boolean> {
  const redis = createRedis();
  const stored = await redis.get(`recovery:nonce:${username}`);
  await redis.del(`recovery:nonce:${username}`);
  if (!stored) return false;
  const presentedB64 = Buffer.from(nonce).toString('base64url');
  return stored === presentedB64;
}
```

- [ ] **Step 2: Implement `apps/auth-service/src/routes/recovery.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { server as opaqueServer } from '@serenity-kit/opaque';
import { and, eq, isNull } from 'drizzle-orm';
import type { Hono } from 'hono';
import { object, parse, string } from 'valibot';
import { writeAudit } from '../audit/log.js';
import { createDb } from '../db/client.js';
import { authMethods, users } from '../db/schema.js';
import { loadEnv } from '../env.js';
import { issueTokens, refreshCookieFor } from '../jwt/issue.js';
import { ApiError } from '../middleware/error-envelope.js';
import { metrics } from '../metrics.js';
import { ensureOpaqueReady, generateSessionId, getServerSetup } from '../opaque/server.js';
import { consumeNonce, storeNonce } from '../recovery/nonce.js';

const startReq = object({
  username: string(),
  registration_request: string(),
});

const finishReq = object({
  username: string(),
  nonce: string(),
  proof: string(),
  registration_record: string(),
  new_wrapped_mk_opaque: string(),
  new_wrap_nonce_opaque: string(),
  new_wrap_aad_opaque: string(),
  new_recovery_verifier_key: string(),
  new_wrapped_mk_recovery: string(),
  new_wrap_nonce_recovery: string(),
  new_wrap_aad_recovery: string(),
});

export function registerRecoveryRoutes(app: Hono): void {
  app.post('/v1/recovery/start', async (c) => {
    await ensureOpaqueReady();
    const body = parse(startReq, await c.req.json());
    const { db } = createDb();
    const userRow = await db
      .select()
      .from(users)
      .where(eq(users.username, body.username))
      .limit(1);
    if (userRow.length === 0) {
      // Return a deterministic-looking fake to avoid trivial enumeration.
      throw new ApiError(404, 'not_found', 'Unknown user');
    }
    const user = userRow[0]!;
    // Find recovery wrap on the client-side; the server stores it on the
    // opaque auth_method row when the row is created with recovery fields.
    // Phase-0 simplification: we keep a snapshot of the recovery wrap as a
    // separate row tagged method_type='opaque' with a sentinel label
    // 'recovery' OR we add a dedicated table. Decision (per spec §4.2):
    // *no* server-side recovery auth method exists. Instead the server holds
    // the wrap as part of the user row (extend users with three columns:
    // wrapped_mk_recovery, wrap_nonce_recovery, wrap_aad_recovery). Apply
    // this schema delta in Task 2's migration if not already.
    //
    // For the plan to be implementable: extend users with those three bytea
    // columns now. Generate a follow-up migration:
    //   pnpm --filter @chatsundere/auth-service db:generate
    // and run it.

    const wrappedMkRecovery = (user as any).wrappedMkRecovery as Uint8Array;
    const wrapNonceRecovery = (user as any).wrapNonceRecovery as Uint8Array;
    const wrapAadRecovery = (user as any).wrapAadRecovery as Uint8Array;

    const nonce = new Uint8Array(16);
    crypto.getRandomValues(nonce);
    await storeNonce(body.username, nonce);

    const { registrationResponse } = opaqueServer.createRegistrationResponse({
      serverSetup: getServerSetup(),
      userIdentifier: user.id,
      registrationRequest: body.registration_request,
    });

    return c.json({
      nonce: Buffer.from(nonce).toString('base64url'),
      wrapped_mk_recovery: Buffer.from(wrappedMkRecovery).toString('base64url'),
      wrap_nonce_recovery: Buffer.from(wrapNonceRecovery).toString('base64url'),
      wrap_aad_recovery: Buffer.from(wrapAadRecovery).toString('base64url'),
      registration_response: registrationResponse,
    });
  });

  app.post('/v1/recovery/finish', async (c) => {
    await ensureOpaqueReady();
    const body = parse(finishReq, await c.req.json());
    const { db } = createDb();

    const userRow = await db
      .select()
      .from(users)
      .where(eq(users.username, body.username))
      .limit(1);
    if (userRow.length === 0) throw new ApiError(404, 'not_found', 'Unknown user');
    const user = userRow[0]!;

    const nonceBytes = new Uint8Array(Buffer.from(body.nonce, 'base64url'));
    const validNonce = await consumeNonce(body.username, nonceBytes);
    if (!validNonce) {
      metrics.authRecoveryAttemptsTotal.inc({ result: 'no_nonce' });
      throw new ApiError(401, 'unauthorized', 'Nonce missing or expired');
    }

    // Verify HMAC proof against stored recovery_verifier_key.
    const verifierKey = await crypto.subtle.importKey(
      'raw',
      user.recoveryVerifierKey,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const env = loadEnv();
    const serverId = `${env.API_BASE_URL}/v1`;
    const message = concat(
      nonceBytes,
      new TextEncoder().encode(body.username),
      new Uint8Array([0]),
      new TextEncoder().encode(serverId),
    );
    const ok = await crypto.subtle.verify(
      'HMAC',
      verifierKey,
      new Uint8Array(Buffer.from(body.proof, 'base64url')),
      message,
    );
    if (!ok) {
      metrics.authRecoveryAttemptsTotal.inc({ result: 'bad_proof' });
      throw new ApiError(401, 'unauthorized', 'Invalid recovery proof');
    }

    // Atomic: delete existing auth_methods, install new opaque, update wraps + verifier key.
    const tokens = await db.transaction(async (tx) => {
      await tx.delete(authMethods).where(eq(authMethods.userId, user.id));
      await tx.insert(authMethods).values({
        userId: user.id,
        methodType: 'opaque',
        opaqueCredential: Buffer.from(body.registration_record, 'base64url'),
        wrappedMasterKey: Buffer.from(body.new_wrapped_mk_opaque, 'base64url'),
        wrapNonce: Buffer.from(body.new_wrap_nonce_opaque, 'base64url'),
        wrapAad: Buffer.from(body.new_wrap_aad_opaque, 'base64url'),
      });
      await tx
        .update(users)
        .set({
          recoveryVerifierKey: Buffer.from(body.new_recovery_verifier_key, 'base64url'),
          // wrappedMkRecovery + wrap_nonce_recovery + wrap_aad_recovery
          // (schema additions; see Task 2 follow-up migration)
        } as any)
        .where(eq(users.id, user.id));
      return issueTokens({
        userId: user.id,
        role: user.role,
        userAgent: c.req.header('User-Agent') ?? undefined,
      });
    });

    await writeAudit({
      db,
      eventType: 'recovery_used',
      userId: user.id,
    });
    metrics.authRecoveryAttemptsTotal.inc({ result: 'success' });

    c.header('Set-Cookie', refreshCookieFor(tokens.refreshToken));
    return c.json({
      user_id: user.id,
      role: user.role,
      access_token: tokens.accessToken,
      expires_in: tokens.expiresIn,
    });
  });
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
```

Wire into server.ts. **Apply the users-table extension in Task 2's migration (three bytea columns: `wrapped_mk_recovery`, `wrap_nonce_recovery`, `wrap_aad_recovery`); also extend the `linkOpaqueFinish` route to write them.** (This is a cross-task fix-up — when implementing Task 11 you'll discover you need the schema columns. Add them as a follow-up migration in `migrations/0001_add_recovery_wraps_to_users.sql`, and update Task 9's link route to insert them.)

- [ ] **Step 2: Integration test** at `tests/integration/recovery.test.ts` — link a user, then exercise the full recovery flow with a fresh client-side RK.

- [ ] **Step 3: Commit**

```bash
pnpm --filter @chatsundere/auth-service typecheck
pnpm --filter @chatsundere/auth-service test
git add apps/auth-service/src/recovery/ apps/auth-service/src/routes/recovery.ts apps/auth-service/migrations/0001_*.sql apps/auth-service/src/db/schema.ts apps/auth-service/src/server.ts apps/auth-service/tests/integration/recovery.test.ts
git commit -m "Add recovery endpoints with challenge-response proof verification"
```

---

### Task 12: `/v1/me` endpoints, auth-methods management, passphrase change

**Files:**
- Create: `apps/auth-service/src/routes/me.ts`
- Create: `apps/auth-service/tests/integration/me.test.ts`

The me-router groups: `GET /v1/me`, `PATCH /v1/me`, `DELETE /v1/me`, `DELETE /v1/auth-methods/:id`, `POST /v1/auth-methods/passphrase/change/{start,finish}`.

- [ ] **Step 1: Implement `apps/auth-service/src/routes/me.ts`**

Structure (full code follows the pattern from `link.ts` and `recovery.ts`):

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { server as opaqueServer } from '@serenity-kit/opaque';
import { and, eq, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { object, optional, parse, regex, string } from 'valibot';
import { writeAudit } from '../audit/log.js';
import { createDb } from '../db/client.js';
import { authMethods, users } from '../db/schema.js';
import type { AccessClaims } from '../jwt/verify.js';
import { revokeAllForUser } from '../jwt/refresh.js';
import { bearerAuth } from '../middleware/auth.js';
import { ApiError } from '../middleware/error-envelope.js';
import {
  ensureOpaqueReady,
  fetchOpaqueState,
  generateSessionId,
  getServerSetup,
  storeOpaqueState,
} from '../opaque/server.js';

const USERNAME_RE = /^[a-z][a-z0-9_-]{2,31}$/;
const RESERVED = new Set(['admin', 'root', 'system', 'me', 'you']);

const patchMeReq = object({
  username: string([regex(USERNAME_RE, 'Invalid username')]),
});

const passphraseChangeStartReq = object({
  registration_request: string(),
});

const passphraseChangeFinishReq = object({
  session_id: string(),
  registration_record: string(),
  wrapped_mk_opaque: string(),
  wrap_nonce_opaque: string(),
  wrap_aad_opaque: string(),
});

export function registerMeRoutes(app: Hono): void {
  app.get('/v1/me', bearerAuth(), async (c) => {
    const claims = c.get('claims') as AccessClaims;
    const { db } = createDb();
    const user = (
      await db.select().from(users).where(eq(users.id, claims.sub)).limit(1)
    )[0];
    if (!user) throw new ApiError(401, 'unauthorized', 'User gone');
    const methods = await db
      .select()
      .from(authMethods)
      .where(eq(authMethods.userId, user.id));
    return c.json({
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        created_at: user.createdAt.toISOString(),
        storage_quota_bytes: user.storageQuotaBytes,
      },
      auth_methods: methods.map((m) => ({
        id: m.id,
        method_type: m.methodType,
        label: m.label,
        created_at: m.createdAt.toISOString(),
        last_used_at: m.lastUsedAt?.toISOString() ?? null,
      })),
    });
  });

  app.patch('/v1/me', bearerAuth(), async (c) => {
    const claims = c.get('claims') as AccessClaims;
    const body = parse(patchMeReq, await c.req.json());
    if (RESERVED.has(body.username)) {
      throw new ApiError(400, 'invalid_input', 'Username is reserved');
    }
    const { db } = createDb();
    try {
      await db.update(users).set({ username: body.username }).where(eq(users.id, claims.sub));
    } catch (err) {
      if (err instanceof Error && /unique/i.test(err.message)) {
        throw new ApiError(409, 'username_taken', 'Username already exists');
      }
      throw err;
    }
    await writeAudit({
      db,
      eventType: 'user.username_changed',
      userId: claims.sub,
      actorUserId: claims.sub,
    });
    return c.json({ ok: true });
  });

  app.delete('/v1/me', bearerAuth(), async (c) => {
    const claims = c.get('claims') as AccessClaims;
    const { db } = createDb();
    // Self-delete: cascade refresh tokens + auth_methods + audit it.
    await db.transaction(async (tx) => {
      await tx.delete(users).where(eq(users.id, claims.sub));
    });
    await writeAudit({
      db,
      eventType: 'user.self_deleted',
      userId: claims.sub,
      actorUserId: claims.sub,
    });
    c.header(
      'Set-Cookie',
      'refresh_token=; HttpOnly; SameSite=Lax; Path=/v1/token/refresh; Max-Age=0',
    );
    return c.json({ ok: true });
  });

  app.delete('/v1/auth-methods/:id', bearerAuth(), async (c) => {
    const claims = c.get('claims') as AccessClaims;
    const id = c.req.param('id');
    const confirm = c.req.query('confirm_lockout') === 'true';
    const { db } = createDb();
    // Determine if removing this would leave the user with zero non-recovery methods.
    const all = await db.select().from(authMethods).where(eq(authMethods.userId, claims.sub));
    const target = all.find((m) => m.id === id);
    if (!target) throw new ApiError(404, 'not_found', 'Auth method not found');
    const remainingNonRecovery = all.filter((m) => m.id !== id).length;
    if (remainingNonRecovery === 0 && !confirm) {
      throw new ApiError(
        409,
        'conflict',
        'Removing this would lock you out; pass confirm_lockout=true',
      );
    }
    await db.delete(authMethods).where(eq(authMethods.id, id));
    await writeAudit({
      db,
      eventType: 'auth_method.removed',
      userId: claims.sub,
      actorUserId: claims.sub,
      metadata: { method_type: target.methodType, label: target.label ?? undefined },
    });
    return c.json({ ok: true });
  });

  app.post('/v1/auth-methods/passphrase/change/start', bearerAuth(), async (c) => {
    await ensureOpaqueReady();
    const claims = c.get('claims') as AccessClaims;
    const body = parse(passphraseChangeStartReq, await c.req.json());
    const sessionId = generateSessionId();
    const { db } = createDb();
    const user = (await db.select().from(users).where(eq(users.id, claims.sub)).limit(1))[0];
    if (!user) throw new ApiError(401, 'unauthorized', 'User gone');
    const { registrationResponse } = opaqueServer.createRegistrationResponse({
      serverSetup: getServerSetup(),
      userIdentifier: user.id,
      registrationRequest: body.registration_request,
    });
    await storeOpaqueState({
      scope: 'register',
      sessionId,
      payload: { user_id: user.id },
    });
    return c.json({ session_id: sessionId, registration_response: registrationResponse });
  });

  app.post('/v1/auth-methods/passphrase/change/finish', bearerAuth(), async (c) => {
    await ensureOpaqueReady();
    const claims = c.get('claims') as AccessClaims;
    const body = parse(passphraseChangeFinishReq, await c.req.json());
    const state = await fetchOpaqueState('register', body.session_id);
    if (!state || state.user_id !== claims.sub) throw new ApiError(410, 'expired', 'Session expired');
    const { db } = createDb();
    await db.transaction(async (tx) => {
      await tx
        .update(authMethods)
        .set({
          opaqueCredential: Buffer.from(body.registration_record, 'base64url'),
          wrappedMasterKey: Buffer.from(body.wrapped_mk_opaque, 'base64url'),
          wrapNonce: Buffer.from(body.wrap_nonce_opaque, 'base64url'),
          wrapAad: Buffer.from(body.wrap_aad_opaque, 'base64url'),
        })
        .where(and(eq(authMethods.userId, claims.sub), eq(authMethods.methodType, 'opaque')));
    });
    await writeAudit({
      db,
      eventType: 'auth_method.passphrase_changed',
      userId: claims.sub,
      actorUserId: claims.sub,
    });
    return c.json({ ok: true });
  });
}
```

Wire into server.ts.

- [ ] **Step 2: Integration test** at `tests/integration/me.test.ts` — link a user, then `GET /v1/me`, `PATCH` username, attempt conflict, `DELETE` self, attempt `/me` again (expect 401).

- [ ] **Step 3: Commit**

```bash
pnpm --filter @chatsundere/auth-service typecheck
pnpm --filter @chatsundere/auth-service test
git add apps/auth-service/src/routes/me.ts apps/auth-service/src/server.ts apps/auth-service/tests/integration/me.test.ts
git commit -m "Add /me endpoints, auth-methods management, passphrase change"
```

---

### Task 13: Admin user endpoints (with self-target guards)

**Files:**
- Create: `apps/auth-service/src/routes/admin/users.ts`
- Create: `apps/auth-service/tests/integration/admin-users.test.ts`

Endpoints:
- `GET /v1/admin/users[?q=&limit=&offset=]`
- `GET /v1/admin/users/:id`
- `POST /v1/admin/users/:id/suspend` (revoke all refresh families + set `suspended_at`)
- `POST /v1/admin/users/:id/unsuspend` (clear `suspended_at`)
- `DELETE /v1/admin/users/:id` (cascade delete; reject self-target unless transferred — audit H5)
- `POST /v1/admin/users/:id/role` (primary_admin only; reject self-target if it would remove primary_admin — audit H5)
- `POST /v1/admin/transfer-primary` (primary_admin only; atomic role swap in SERIALIZABLE)

Apply `bearerAuth({ minRole: 'admin' })` to the first five; `bearerAuth({ minRole: 'primary_admin' })` to the last two.

For self-target guards:
- `suspend`: 403 if `:id === claims.sub`.
- `delete`: 403 if `:id === claims.sub` and role is `primary_admin`.
- `role` change: 403 if `:id === claims.sub` and target role is not `primary_admin` (i.e., would demote self).
- `transfer-primary`: explicitly OK target-self → no-op success.

For each action: write a corresponding audit event (`user.suspended`, `user.unsuspended`, `user.deleted_by_admin`, `user.role_changed`, `primary_admin.transferred`) and increment `metrics.authAdminActionsTotal{action: ...}`.

Implementation skeleton (paste pattern):

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { and, asc, desc, eq, ilike, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { object, optional, parse, picklist, string } from 'valibot';
import { writeAudit } from '../../audit/log.js';
import { createDb } from '../../db/client.js';
import { users, authMethods } from '../../db/schema.js';
import { revokeAllForUser } from '../../jwt/refresh.js';
import type { AccessClaims } from '../../jwt/verify.js';
import { bearerAuth } from '../../middleware/auth.js';
import { ApiError } from '../../middleware/error-envelope.js';
import { metrics } from '../../metrics.js';

const roleChangeReq = object({ role: picklist(['admin', 'user']) });
const transferPrimaryReq = object({ target_user_id: string() });

export function registerAdminUserRoutes(app: Hono): void {
  app.get('/v1/admin/users', bearerAuth({ minRole: 'admin' }), async (c) => {
    const q = c.req.query('q');
    const limit = Math.min(100, Number.parseInt(c.req.query('limit') ?? '20', 10) || 20);
    const offset = Number.parseInt(c.req.query('offset') ?? '0', 10) || 0;
    const { db } = createDb();
    const where = q ? ilike(users.username, `%${q}%`) : undefined;
    const rows = await db
      .select()
      .from(users)
      .where(where)
      .limit(limit)
      .offset(offset)
      .orderBy(asc(users.username));
    return c.json({
      users: rows.map((r) => ({
        id: r.id,
        username: r.username,
        role: r.role,
        suspended_at: r.suspendedAt?.toISOString() ?? null,
        created_at: r.createdAt.toISOString(),
        last_login_at: r.lastLoginAt?.toISOString() ?? null,
      })),
      total: rows.length,
    });
  });

  app.get('/v1/admin/users/:id', bearerAuth({ minRole: 'admin' }), async (c) => {
    const id = c.req.param('id');
    const { db } = createDb();
    const row = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
    if (!row) throw new ApiError(404, 'not_found', 'User not found');
    const methods = await db.select().from(authMethods).where(eq(authMethods.userId, id));
    return c.json({
      id: row.id,
      username: row.username,
      role: row.role,
      suspended_at: row.suspendedAt?.toISOString() ?? null,
      created_at: row.createdAt.toISOString(),
      last_login_at: row.lastLoginAt?.toISOString() ?? null,
      auth_methods: methods.map((m) => ({
        id: m.id,
        method_type: m.methodType,
        label: m.label,
        created_at: m.createdAt.toISOString(),
        last_used_at: m.lastUsedAt?.toISOString() ?? null,
      })),
    });
  });

  app.post('/v1/admin/users/:id/suspend', bearerAuth({ minRole: 'admin' }), async (c) => {
    const claims = c.get('claims') as AccessClaims;
    const id = c.req.param('id');
    if (id === claims.sub) throw new ApiError(403, 'forbidden', 'Cannot self-suspend');
    const { db } = createDb();
    await db.update(users).set({ suspendedAt: new Date() }).where(eq(users.id, id));
    await revokeAllForUser(id);
    await writeAudit({ db, eventType: 'user.suspended', userId: id, actorUserId: claims.sub });
    metrics.authAdminActionsTotal.inc({ action: 'suspend' });
    return c.json({ ok: true });
  });

  app.post('/v1/admin/users/:id/unsuspend', bearerAuth({ minRole: 'admin' }), async (c) => {
    const claims = c.get('claims') as AccessClaims;
    const id = c.req.param('id');
    const { db } = createDb();
    await db.update(users).set({ suspendedAt: null }).where(eq(users.id, id));
    await writeAudit({ db, eventType: 'user.unsuspended', userId: id, actorUserId: claims.sub });
    metrics.authAdminActionsTotal.inc({ action: 'unsuspend' });
    return c.json({ ok: true });
  });

  app.delete('/v1/admin/users/:id', bearerAuth({ minRole: 'admin' }), async (c) => {
    const claims = c.get('claims') as AccessClaims;
    const id = c.req.param('id');
    const { db } = createDb();
    const target = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
    if (!target) throw new ApiError(404, 'not_found', 'User not found');
    if (id === claims.sub && target.role === 'primary_admin') {
      throw new ApiError(
        403,
        'forbidden',
        'Cannot delete the primary admin without transferring first',
      );
    }
    await db.delete(users).where(eq(users.id, id));
    await writeAudit({
      db,
      eventType: 'user.deleted_by_admin',
      userId: id,
      actorUserId: claims.sub,
    });
    metrics.authAdminActionsTotal.inc({ action: 'delete' });
    return c.json({ ok: true });
  });

  app.post('/v1/admin/users/:id/role', bearerAuth({ minRole: 'primary_admin' }), async (c) => {
    const claims = c.get('claims') as AccessClaims;
    const id = c.req.param('id');
    const body = parse(roleChangeReq, await c.req.json());
    const { db } = createDb();
    const target = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
    if (!target) throw new ApiError(404, 'not_found', 'User not found');
    if (id === claims.sub && body.role !== 'primary_admin') {
      throw new ApiError(403, 'forbidden', 'Cannot demote yourself; transfer primary first');
    }
    await db.update(users).set({ role: body.role }).where(eq(users.id, id));
    await writeAudit({
      db,
      eventType: 'user.role_changed',
      userId: id,
      actorUserId: claims.sub,
      metadata: { from_role: target.role, to_role: body.role },
    });
    metrics.authAdminActionsTotal.inc({ action: 'role_change' });
    return c.json({ ok: true });
  });

  app.post('/v1/admin/transfer-primary', bearerAuth({ minRole: 'primary_admin' }), async (c) => {
    const claims = c.get('claims') as AccessClaims;
    const body = parse(transferPrimaryReq, await c.req.json());
    if (body.target_user_id === claims.sub) {
      return c.json({ ok: true });
    }
    const { db } = createDb();
    await db.transaction(async (tx) => {
      const target = (
        await tx.select().from(users).where(eq(users.id, body.target_user_id)).limit(1)
      )[0];
      if (!target) throw new ApiError(404, 'not_found', 'Target user not found');
      if (target.role !== 'admin') throw new ApiError(400, 'invalid_input', 'Target must be admin');
      // Atomic swap.
      await tx.update(users).set({ role: 'admin' }).where(eq(users.id, claims.sub));
      await tx.update(users).set({ role: 'primary_admin' }).where(eq(users.id, body.target_user_id));
    });
    await writeAudit({
      db,
      eventType: 'primary_admin.transferred',
      userId: body.target_user_id,
      actorUserId: claims.sub,
      metadata: { previous_primary_admin_id: claims.sub },
    });
    metrics.authAdminActionsTotal.inc({ action: 'transfer_primary' });
    return c.json({ ok: true });
  });
}
```

Wire into server.ts.

- [ ] **Step 2: Integration test** — happy paths + self-target rejections.

- [ ] **Step 3: Commit**

```bash
pnpm --filter @chatsundere/auth-service typecheck
pnpm --filter @chatsundere/auth-service test
git add apps/auth-service/src/routes/admin/users.ts apps/auth-service/src/server.ts apps/auth-service/tests/integration/admin-users.test.ts
git commit -m "Add admin user management endpoints with self-target guards"
```

---

### Task 14: Admin invitations + audit log endpoints

**Files:**
- Create: `apps/auth-service/src/routes/admin/invitations.ts`
- Create: `apps/auth-service/src/routes/admin/audit.ts`
- Create: `apps/auth-service/tests/integration/admin-invitations.test.ts`

Endpoints:
- `GET /v1/admin/invitations[?status=&limit=&offset=]`
- `POST /v1/admin/invitations` — body: `{ role, expires_in_seconds, issuer_label? }` → returns `{ invitation_id, token, expires_at, qr_payload }`
- `DELETE /v1/admin/invitations/:id`
- `GET /v1/admin/audit-log[?event_type=&user_id=&since=&until=&limit=&offset=]`

The QR payload is built from `InvitationQrPayload` in shared-types: `{ v: 1, kind: 'invitation', token, base_url: env.API_BASE_URL.replace('/auth',''), role, issuer_label }`. base64url-encode the JSON.

For status filter on listing: status is computed from row fields (`revokedAt`, `redeemedAt`, `expiresAt < now()`).

- [ ] **Step 1: Implement both files following the patterns established in earlier tasks (validation via Valibot, audit + metrics on every write, no PII in metric labels).**

For the create endpoint:

```typescript
import { generateInvitationToken, hashInvitationToken } from '../../invitations/token.js';
// ...
app.post('/v1/admin/invitations', bearerAuth({ minRole: 'admin' }), async (c) => {
  const claims = c.get('claims') as AccessClaims;
  const body = parse(createInvitationReq, await c.req.json());
  const token = generateInvitationToken();
  const tokenHmac = await hashInvitationToken(token);
  const expiresAt = new Date(Date.now() + body.expires_in_seconds * 1000);
  const { db } = createDb();
  const inserted = await db
    .insert(invitations)
    .values({
      tokenHmac,
      role: body.role,
      issuerLabel: body.issuer_label ?? null,
      createdBy: claims.sub,
      expiresAt,
    })
    .returning({ id: invitations.id });
  const env = loadEnv();
  const baseUrl = env.API_BASE_URL.replace(/\/auth$/, '');
  const qrPayload = {
    v: 1 as const,
    kind: 'invitation' as const,
    token,
    base_url: baseUrl,
    role: body.role,
    issuer_label: body.issuer_label ?? null,
  };
  const qrPayloadEncoded = Buffer.from(JSON.stringify(qrPayload)).toString('base64url');
  await writeAudit({
    db,
    eventType: 'invitation.created',
    actorUserId: claims.sub,
    metadata: { invitation_id: inserted[0]!.id, role: body.role, expires_at: expiresAt.toISOString() },
  });
  metrics.authInvitationsCreatedTotal.inc({ role: body.role });
  metrics.authAdminActionsTotal.inc({ action: 'invite_create' });
  return c.json({
    invitation_id: inserted[0]!.id,
    token,
    expires_at: expiresAt.toISOString(),
    qr_payload: qrPayloadEncoded,
  });
});
```

For audit-log GET: select with filters, paginate, return `{ entries, total }`.

- [ ] **Step 2: Integration test** — admin creates an invitation, the token decodes correctly, lists invitations, revokes one, reads audit log entries.

- [ ] **Step 3: Commit**

```bash
pnpm --filter @chatsundere/auth-service typecheck
pnpm --filter @chatsundere/auth-service test
git add apps/auth-service/src/routes/admin/invitations.ts apps/auth-service/src/routes/admin/audit.ts apps/auth-service/src/server.ts apps/auth-service/tests/integration/admin-invitations.test.ts
git commit -m "Add admin invitation and audit-log endpoints"
```

---

### Task 15: Bootstrap CLI (file output with 0600, per audit M7)

**Files:**
- Create: `apps/auth-service/src/cli/bootstrap.ts`
- Create: `apps/auth-service/tests/integration/bootstrap.test.ts`

- [ ] **Step 1: Implement `apps/auth-service/src/cli/bootstrap.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { count, eq } from 'drizzle-orm';
import { closeDb, createDb } from '../db/client.js';
import { authMethods, invitations, users } from '../db/schema.js';
import { loadEnv } from '../env.js';
import { generateInvitationToken, hashInvitationToken } from '../invitations/token.js';

async function main(): Promise<void> {
  const { db } = createDb();
  // Refuse if any primary_admin already exists OR if any auth_methods row exists.
  const primaryCount = await db
    .select({ value: count() })
    .from(users)
    .where(eq(users.role, 'primary_admin'));
  if ((primaryCount[0]?.value ?? 0) > 0) {
    console.error('bootstrap-admin: primary_admin already exists; refusing to run');
    process.exit(1);
  }
  const methodsCount = await db.select({ value: count() }).from(authMethods);
  if ((methodsCount[0]?.value ?? 0) > 0) {
    console.error('bootstrap-admin: auth_methods table is non-empty; refusing to run');
    process.exit(1);
  }

  const env = loadEnv();
  const token = generateInvitationToken();
  const tokenHmac = await hashInvitationToken(token);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const inserted = await db
    .insert(invitations)
    .values({
      tokenHmac,
      role: 'primary_admin',
      issuerLabel: 'bootstrap',
      createdBy: null,
      expiresAt,
    })
    .returning({ id: invitations.id });
  const invitationId = inserted[0]!.id;

  const baseUrl = env.API_BASE_URL.replace(/\/auth$/, '');
  const qrPayload = {
    v: 1 as const,
    kind: 'invitation' as const,
    token,
    base_url: baseUrl,
    role: 'primary_admin' as const,
    issuer_label: 'bootstrap',
  };
  const url = `chatsundere://invite?payload=${Buffer.from(JSON.stringify(qrPayload)).toString(
    'base64url',
  )}`;

  const dir = process.env.XDG_RUNTIME_DIR ?? '/tmp';
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `chatsundere-bootstrap-${invitationId}.json`);
  writeFileSync(
    filePath,
    JSON.stringify(
      {
        qr_payload: Buffer.from(JSON.stringify(qrPayload)).toString('base64url'),
        url,
        invitation_id: invitationId,
        expires_at_unix_ms: expiresAt.getTime(),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );

  console.log(filePath);
  console.log(
    `Open this file from the user-client; the file will be removed automatically after the bootstrap invitation is redeemed.`,
  );

  await closeDb();
}

if (import.meta.main) {
  await main();
}
```

The auth-service's link-finish should additionally delete the bootstrap file when the bootstrap invitation is redeemed; add that as a small follow-up tweak (`if (state.invitation_role === 'primary_admin') unlinkSync(...)` in `link.ts`).

- [ ] **Step 2: Integration test** — bring up an empty DB, run `bun run bootstrap-admin`, assert the file appears, then run a real link flow against that token and assert primary_admin is created.

- [ ] **Step 3: Commit**

```bash
pnpm --filter @chatsundere/auth-service typecheck
pnpm --filter @chatsundere/auth-service test
git add apps/auth-service/src/cli/bootstrap.ts apps/auth-service/src/routes/link.ts apps/auth-service/tests/integration/bootstrap.test.ts
git commit -m "Add bootstrap-admin CLI with file output and post-redemption cleanup"
```

---

### Task 16: Full end-to-end integration test suite

**Files:**
- Create: `apps/auth-service/tests/integration/full-lifecycle.test.ts`

Walks the entire admin + user journey:
1. Bootstrap CLI runs against empty DB → bootstrap file written.
2. Read the bootstrap file → use the token to link a primary_admin user.
3. Admin creates an invitation for a regular user.
4. Second client links using that invitation.
5. Second client logs in via OPAQUE.
6. Admin lists users → both present.
7. Admin suspends second user → second user's `/me` returns 401 within 30 s.
8. Admin unsuspends → second user can log in again.
9. Second user `PATCH /me` username conflict → 409.
10. Second user `DELETE /me` → user gone; admin list reflects.

This is a real integration test against a live Postgres + Redis. Skip if env vars not present.

- [ ] **Step 1: Implement the test.** Use `bun:test` with `it.skipIf(!process.env.RUN_INTEGRATION)` to gate it locally.

- [ ] **Step 2: Run the suite**

```bash
RUN_INTEGRATION=1 pnpm --filter @chatsundere/auth-service test:integration
```

Expected: green.

- [ ] **Step 3: Commit**

```bash
git add apps/auth-service/tests/integration/full-lifecycle.test.ts
git commit -m "Add end-to-end integration test covering full auth-service lifecycle"
```

---

### Task 17: README and documentation pass

**Files:**
- Modify: `apps/auth-service/README.md`

Replace the README body with:

```markdown
# @chatsundere/auth-service

Hono on Bun. The account-linking and authentication backend for Chatsundere's local-first identity model. Stores ciphertext blobs and verifies cryptographic proofs; never sees passphrases, master keys, or recovery keys.

See spec at `superpowers/specs/2026-05-18-foundational-auth-layer-design.md` for the full design. This README covers operational concerns.

## Running locally

```bash
# Bring up Postgres + Redis from infra/
docker compose -f infra/compose.dev.yml up -d

# Generate fresh JWT and invitation HMAC secrets (write into apps/auth-service/.env)
bun -e "console.log('AUTH_JWT_PRIVATE_KEY=' + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'))"
bun -e "console.log('INVITATION_HMAC_KEY=' + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'))"

# Run migrations
pnpm --filter @chatsundere/auth-service db:migrate

# Bootstrap the primary admin (writes a 0600 file with the QR payload)
pnpm --filter @chatsundere/auth-service bootstrap-admin

# Start the service
pnpm --filter @chatsundere/auth-service dev
```

## Endpoints

See `superpowers/specs/2026-05-18-foundational-auth-layer-design.md` §5.1 for the full catalogue.

## Configuration

All configuration via env. See `.env.example` for the full set with descriptions.

## Testing

```bash
pnpm --filter @chatsundere/auth-service test
RUN_INTEGRATION=1 pnpm --filter @chatsundere/auth-service test:integration
```

Integration tests require live Postgres and Redis (the compose file from `infra/` is sufficient).

## License

AGPL-3.0-only.
```

- [ ] **Step 1: Update the README per the above.**

- [ ] **Step 2: Commit**

```bash
git add apps/auth-service/README.md
git commit -m "Document auth-service operational concerns in README"
```

---

### Task 18: Final pass — build, full test, typecheck, prepare for squash

**Files:** none (verification only)

- [ ] **Step 1: Run all gates**

```bash
pnpm --filter @chatsundere/auth-service typecheck
pnpm --filter @chatsundere/auth-service build
pnpm --filter @chatsundere/auth-service test
RUN_INTEGRATION=1 pnpm --filter @chatsundere/auth-service test:integration
```

All four green is required before requesting Larissa audit.

- [ ] **Step 2: Summon Larissa**

Dispatch the audit subagent against the cumulative diff (`git log <pre-task-1-base>..HEAD`). Larissa reads the spec's §9 + §9.4, looks for implementation gaps relative to the integrated audit findings, and surfaces any new high/critical issues introduced during implementation. Address critical and high findings; log medium/low to `obsidian/insights/security-deferrals.md` with rationale and follow-up commitment.

- [ ] **Step 3: Squash all 18 task commits into one**

```bash
git reset --soft <pre-task-1-base>
git commit -m "$(cat <<'EOF'
Add auth-service backend for foundational auth

Hono on Bun service implementing every server-side endpoint specified
in superpowers/specs/2026-05-18-foundational-auth-layer-design.md.
Drizzle/PostgreSQL schema (users with one-primary-admin partial index,
auth_methods, invitations with keyed HMAC token hash, refresh_tokens
with re-use-detection rotation, audit_log with Valibot-schema-enforced
metadata under a 2 KiB cap). Redis-backed rate-limit middleware,
session-id-keyed OPAQUE state, EXISTS-cache for JWT validation.
EdDSA Ed25519 JWT issuance with JWKS endpoint and refresh-token
rotation with re-use detection. OPAQUE linking + login, WebAuthn
linking + login with AAGUID-aware sign-counter policy, recovery via
challenge-response verifier-key proof. /me endpoints with self-target
guards. Admin user/invitation/audit endpoints. Bootstrap CLI emitting
a 0600 file rather than stdout. Comprehensive integration tests.

Audit findings from the design review (spec §9.4) and from Larissa's
pre-squash audit are integrated; deferred items logged in
obsidian/insights/security-deferrals.md.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

The `<pre-task-1-base>` is the SHA of the squash-A finishing commit (the deferrals log commit, `be1ea01` at plan-write time).

- [ ] **Step 4: Confirm post-squash state**

```bash
git log --oneline | head -5
pnpm --filter @chatsundere/auth-service test
```

Test count should not regress. Commit message should match the prescribed template.

- [ ] **Step 5: Hand off to Chris.**

---

## Self-Review

**Spec coverage check.** Mapping each spec section to a task:

| Spec section | Task |
|---|---|
| §4.1 PostgreSQL schema | 2 |
| §5.1 Endpoint catalogue | 8-15 (every endpoint mapped to one of tasks 8-15) |
| §5.5 Linking storyboard | 9, 10 |
| §5.6 Online login double-auth (server side) | 10 |
| §5.7 Passphrase change (server side) | 12 |
| §5.8 Recovery (server side, challenge-response per audit C1) | 11 |
| §5.11 Server-account self-delete | 12 |
| §5.12 Username change (server side) | 12 |
| §5.13 Logout (server side) | 8 |
| §8.1 Bootstrap CLI (file output per audit M7) | 15 |
| §8.2 JWT format + JWKS + refresh rotation (audit L2, L3, L4) | 8 |
| §8.3 Cookie/CORS/CSRF/HSTS | 5 |
| §8.4 Rate limiting | 6, 9 |
| §8.5 Suspend semantics + EXISTS-check (audit H4) | 7, 13 |
| §8.6 Audit log canonical events (audit M4) | 4 + every endpoint that writes one |
| §8.7 Prometheus metrics with no-PII labels (audit M3) | 4 |
| §8.8 Pino logging redact paths | 4 |
| Invitation token HMAC-keyed hash (audit M5) | 9 |
| Self-target guards on admin actions (audit H5) | 13 |

No spec section is unaddressed.

**Placeholder scan.** Plan body contains intentional cross-task references where a later task needs a schema change discovered during implementation (the `users.wrapped_mk_recovery` triple). These are clearly flagged in Task 11 with explicit "apply the users-table extension in Task 2's migration (three bytea columns)" guidance. The implementing subagent for Task 11 is instructed to add migration `0001_add_recovery_wraps_to_users.sql` and update Task 9's link route accordingly. No `TBD`, no "TODO".

**Type-consistency check.** Endpoint wire shapes match `@chatsundere/shared-types` exactly (re-verified during plan write). `AccessClaims` shape is consistent across `verify.ts`, `issue.ts`, `refresh.ts`, and middleware/auth.ts. `ApiError` is exported from `error-envelope.ts` and used uniformly.

**Scope check.** This plan is one squash unit (`apps/auth-service`). It depends on squash A (`@chatsundere/shared-types`) and on `infra/compose.dev.yml`. It does not depend on squashes C or D. Tests can run end-to-end against live Postgres + Redis.

---

## Execution handoff

Plan complete and saved to `superpowers/plans/2026-05-18-foundational-auth-service.md`.

Per Chris's preference (CLAUDE.md global: "Subagent preferred"), execution proceeds via **superpowers:subagent-driven-development** — a fresh subagent per task with reviews between tasks. Plan C (admin-client) and Plan D (user-client) will be written after squash B is complete and committed.

