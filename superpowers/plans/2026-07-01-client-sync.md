# Client Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the `apps/sync-service` Phase-0 skeleton into the zero-knowledge
sync backend — a blind-indexed per-account ciphertext state store with a rev
watermark, CAS push/pull, terminal tombstones, quotas, and a contentless
doorbell WebSocket — plus the sync record envelope in `packages/crypto`, the
wire types in `packages/shared-types`, a token-revocation deny-list
(auth-service writes, sync-service reads), and the `GET /api/v1/config`
`syncUrl` extension.

**Architecture:** Hono-on-Bun on two ports (public sync API + internal ops).
Postgres (Drizzle) stores `sync_records`/`sync_accounts`/`sync_meta`; Redis
carries rate limits, the revocation deny-list, doorbell tickets, and doorbell
pub/sub. All crypto is client-side in `packages/crypto/src/sync-envelope.ts`
(pure functions); the server never sees plaintext, real ids, or content
timestamps. Per request: trusted-hop client IP → per-IP limit (pre-auth) →
JWKS JWT verify → deny-list check → per-user limit → handle.

**Tech Stack:** TypeScript (strict), Bun runtime + test runner, Hono,
`drizzle-orm` + `postgres`, `ioredis`, `jose`, `prom-client`, `valibot`,
`pino`. Crypto via WebCrypto (`crypto.subtle`).

**Design spec:** `superpowers/specs/2026-07-01-client-sync-design.md` — read
it first and in full; `[L]` = Larissa finding, `[P]` = protocol-lens finding.
Sections cited as §N below are spec sections.

---

## Operating rules for the overnight worker (READ FIRST)

You are executing this plan in a session that has **none** of this repo's
context. These rules are binding and override your defaults. Read them fully
before touching a file.

1. **Language — British English everywhere in the repo.** Code, comments,
   identifiers, log strings, error messages, commit messages, docs. Use
   `colour`, `behaviour`, `initialise`, `authorise`. **Never** write German or
   US spelling into the repo. (The repo has drifted on this before; it is a
   hard rule.)

2. **Branch.** Do all work on **`feat/backend-02-sync`** (create it from
   `master`). **Prerequisite: the proxy branch (`feat/backend-01-cors-proxy`)
   must already be merged into the `master` you branch from** — verify
   `apps/auth-service/src/routes/config.ts` exists before starting; if it does
   not, STOP and report. **Never switch the branch of the main working tree**;
   if you use worktrees, keep the main tree on `master`.

3. **TDD per task, no exceptions.** For every task: write the failing test →
   run it and confirm it **fails for the stated reason** → write the minimal
   implementation → run and confirm it **passes** → commit. Never write
   implementation before its test.

4. **Execution discipline — subagent-driven.** Use
   `superpowers:subagent-driven-development`: one fresh subagent per task, with
   a two-stage review (spec-conformance + code-quality) between tasks.
   **Subagents never merge, push, or switch branches** — say so in every
   subagent prompt.

5. **Commit granularity.** Commit per task. **Do NOT squash** — the human
   squashes at integration. Style: imperative, capitalised subject, no
   Conventional-Commits prefix. **These are code commits — no `[skip ci]`.**

6. **Co-author tag** on every commit, exactly:
   `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`

7. **Exact commands** (monorepo: pnpm + Turbo + Bun's test runner):
   - Sync tests: `cd apps/sync-service && bun test` — **needs Postgres + Redis**
     (rule 8).
   - Crypto tests: `pnpm --filter @chatsundere/crypto test` (vitest).
   - Auth tests: `cd apps/auth-service && bun test` — needs `TEST_DATABASE_URL`
     (+ Redis).
   - Typechecks: `pnpm --filter @chatsundere/sync-service typecheck` (likewise
     `crypto`, `shared-types`, `auth-service`).
   - Repo-wide gates: `pnpm typecheck` **and** `pnpm build`. Run both — they
     diverge subtly.

8. **Test infrastructure.** `infra/docker-compose.dev.yml` provides Postgres +
   Redis. The sync integration tests use **`TEST_DATABASE_URL`**
   (`postgres://chatsundere:dev@localhost:5432/sync_db_test` — create the
   database, mirror the auth-service isolation pattern: tests refuse to run
   against `DATABASE_URL`) and `REDIS_URL` db 15 for test keys. If the remote
   environment truly has no Postgres/Redis, the crypto + shared-types + env
   tasks are still fully runnable; for the rest run typecheck + build, mark
   each unrun suite clearly in your report, and Liz verifies at integration.

9. **Known-green baseline — confirm on `master` before you start.**
   - `apps/sync-service`: 3 pass / 0 fail (health tests) **before the proxy
     merge**; re-record the number on your actual base.
   - `packages/crypto`: record the vitest count on your base.
   - `apps/auth-service`: known pre-existing failures in
     `tests/integration/full-lifecycle.test.ts` (≈9). Record the exact number;
     your job is to **not increase it**.

10. **Task 1 (probes) gates everything.** Run the probes first and record the
    results in `apps/sync-service/PROBES.md` (committed). Three probes have
    **decision matrices** that change later tasks — follow them mechanically.

11. **Security gate — this IS a Larissa path** (`apps/sync-service/**`,
    `packages/crypto/**`, `apps/auth-service/**`). You do NOT run the security
    audit — Liz does, on the built diff, before merge. Your obligation: the
    security-critical tests are **non-negotiable** — the AAD tamper matrix and
    NSFW invariant (Task 5), tombstone terminality + delete-rate (Task 10),
    the anonymity invariants (Task 14), the revocation checks (Tasks 8/15).
    **If a security test fails, fix the code, never the test.**

12. **Do NOT touch the STATUS files** (`obsidian/STATUS-*.md`).

13. **Hand-off — do NOT push and do NOT merge.** Stop after the final task.
    Report: (a) every suite/typecheck/build number against baseline, (b) the
    commit list on `feat/backend-02-sync`, (c) the probe outcomes, (d) anything
    unverified per rule 8.

---

## Global Constraints

- **British English** in all code, comments, log strings, commit messages (CLAUDE.md §3.7).
- **TypeScript strict**, `noUncheckedIndexedAccess: true`, no `any` without an inline justification comment.
- **Zero-knowledge invariants (test-enforced):** no plaintext row field, no real uuid, no `adultPersona`/`nsfw` value ever appears outside `ciphertext` in any wire payload or DB column; no `account_id`/`sub`/`jti`/`blind_id` in any log line or metric label; **no `collection` metric label**.
- **The server stores no timestamp columns** (§4).
- Every package-public function carries a one-line JSDoc.
- SPDX headers: `// SPDX-License-Identifier: AGPL-3.0-only` (apps),
  `// SPDX-License-Identifier: LGPL-3.0-only` (`packages/crypto`),
  `// SPDX-License-Identifier: MIT` (`packages/shared-types`).
- Commit style: imperative, capitalised subject, co-author tag (rule 6). No `[skip ci]`.

---

## File structure

**`packages/crypto/src/`** (LGPL): `sync-envelope/codec.ts` (binary-aware
encode/decode), `sync-envelope/blind-index.ts`, `sync-envelope/padding.ts`,
`sync-envelope/seal.ts`, `sync-envelope/index.ts` (re-exports), wired into
`src/index.ts`. Tests in `packages/crypto/tests/sync-envelope/*.test.ts`
(vitest, mirroring the existing test layout).

**`packages/shared-types/src/`** (MIT): `sync.ts` — wire types, error codes,
collection list, revocation key builders; re-exported from `index.ts`.

**`apps/sync-service/src/`** (AGPL):
- `env.ts` — MODIFY: full §14 schema (fix `JWT_ISSUER`, add everything).
- `db/schema.ts`, `db/client.ts`, `db/migrations.ts` + `migrations/` — CREATE (mirror auth-service).
- `auth/verify-token.ts` — CREATE: JWKS verifier (adapt `apps/proxy-service/src/auth/verify-token.ts`, in-tree after the proxy merge).
- `auth/revocation.ts` — CREATE: deny-list read (`jti` + iat-aware `sub`).
- `net/client-ip.ts`, `ratelimit/limiter.ts` — CREATE: adapt the proxy-service files (same semantics; keep fail-closed).
- `records/collections.ts` — CREATE: allowlist + padded set (imported from shared-types).
- `records/store.ts` — CREATE: the transactional CAS write path + pull query + epoch.
- `routes/changes.ts` — CREATE: push + pull handlers.
- `routes/doorbell.ts` — CREATE: ticket mint + upgrade gate.
- `doorbell/hub.ts` — CREATE: socket registry, Redis subscriber, ping loop.
- `cors.ts`, `error.ts`, `ops.ts` — CREATE: adapt proxy-service equivalents.
- `metrics.ts` — MODIFY: §10.2 metric set.
- `server.ts`, `index.ts` — MODIFY: public app + ops app + Bun.serve with WebSocket handler.
- `tools/seal-cli.ts` — CREATE.
- `PROBES.md` — CREATE (Task 1).

**`apps/auth-service/src/`** (AGPL): `auth/deny-list.ts` — CREATE (write
helpers); MODIFY `routes/auth.ts` (logout), `routes/admin/users.ts` (suspend),
`routes/me.ts` (account deletion), `env.ts` + `routes/config.ts` (add
`SYNC_PUBLIC_URL` → `syncUrl`, `"sync"` feature).

---

## Task 1: Probes (§20) — run first, record, decide

**Files:**
- Create: `apps/sync-service/PROBES.md`
- Create: `apps/sync-service/probes/` (throwaway scripts, committed for audit)

No TDD here — these are empirical probes. Write each script, run it, paste the
observed output into `PROBES.md`, and apply the decision matrix.

- [ ] **Probe A — Bun.serve + WebSocket + Hono composition.** Script
  `probes/ws-compose.ts`: a `Bun.serve({ fetch(req, server) { if (new URL(req.url).pathname === '/ws') { const ok = server.upgrade(req, { data: { accountId: 'test' } }); return ok ? undefined : new Response('upgrade failed', { status: 400 }); } return app.fetch(req); }, websocket: { open(ws) { ws.send('hello'); }, message() {}, close() {} } })`
  with a plain Hono `app`. Connect with a WS client, confirm `hello` arrives,
  confirm a non-`/ws` route still hits Hono. Then refuse the upgrade with
  `return new Response(null, { status: 401 })` and confirm the client sees it.
  **Decision:** the wrapper-in-`fetch` pattern is the canonical composition for
  Tasks 13/14. If `server.upgrade` misbehaves under Bun's current version,
  STOP and report — do not improvise a different WS stack.
- [ ] **Probe B — Bun WS `idleTimeout` + ping.** Serve with
  `websocket: { idleTimeout: 960, ... }`. If Bun rejects 960 (documented max
  16 min? verify), record the accepted max. Hold a silent socket 3 min with a
  30 s server `ws.ping()` loop; confirm it survives. **Decision matrix:** 960
  accepted → use `WS_IDLE_TIMEOUT_S=960`; max lower than 960 but > 60 → set
  the default to that max and rely on the 30 s ping loop; ping frames not
  supported → send an application-level `{"ping":true}` frame instead and
  document in `PROBES.md` (the client contract §12 tolerates unknown fields).
- [ ] **Probe C — Drizzle + postgres-js `bytea` at 2 MiB + `FOR UPDATE`.**
  Script inserts a 2 MiB `Uint8Array` via the auth-service's `bytea`
  customType pattern into a scratch table, reads it back byte-identical, and
  runs `db.transaction(async (tx) => { await tx.execute(sql`SELECT head_rev FROM t WHERE id=${x} FOR UPDATE`); ... })`
  from two connections to confirm the second blocks. **Decision:** pass → Task
  7 proceeds as written; Buffer/Uint8Array mismatch → adjust `fromDriver` and
  record.
- [ ] **Probe D — batch transaction latency.** 100 records × ~10 KiB through
  the Task-10 write shape (or a simplified stand-in) in one transaction;
  record ms. Informational only (no decision, but report it).
- [ ] **Probe E — ioredis subscriber churn.** `duplicate()` a client,
  SUBSCRIBE/UNSUBSCRIBE 50 channels while publishing; confirm no message for
  an unsubscribed channel, ordering preserved per channel.
- [ ] **Probe F — 24 MiB JSON body.** POST 24 MiB to a Hono route with
  `bodyLimit`; confirm bounded memory and a clean `413` over the cap.
- [ ] **Probe G — WebCrypto parity.** Run the exact seal call shapes
  (HMAC-SHA256 sign, AES-GCM encrypt with `additionalData`, SHA-256 digest)
  under `bun test` AND note that `packages/crypto` vitest runs them under
  Node — both must pass with identical vectors (Task 5's tests are the
  durable form of this probe).
- [ ] **Commit** `Add sync-service probe results (Task 1)`.

*(Traefik WSS idle — spec §20.3 — cannot run headless; it is listed in the
spec's §18 manual verification for Chris. Note it as "deferred to manual" in
`PROBES.md`.)*

---

## Task 2: sync-service env schema

**Files:**
- Modify: `apps/sync-service/src/env.ts`
- Modify: `apps/sync-service/.env.example`
- Test: `apps/sync-service/tests/env.test.ts`

**Interfaces:**
- Produces: `loadEnv(source?): Env` with `NODE_ENV, PORT, OPS_PORT, LOG_LEVEL,
  DATABASE_URL, REDIS_URL, JWT_ISSUER, JWT_AUDIENCE, AUTH_JWKS_URL,
  CORS_ALLOWED_ORIGINS (string[]), TRUST_PROXY_HOPS (number),
  RATE_LIMIT_USER_PER_MIN, RATE_LIMIT_IP_PER_MIN, RATE_LIMIT_DELETE_PER_MIN,
  MAX_RECORD_BYTES, ACCOUNT_QUOTA_BYTES, MAX_PUSH_RECORDS, MAX_BODY_BYTES,
  PULL_LIMIT_DEFAULT, PULL_LIMIT_MAX, PULL_BYTE_BUDGET, DOORBELL_TICKET_TTL_S,
  WS_PING_INTERVAL_S, WS_IDLE_TIMEOUT_S, MAX_SOCKETS_PER_ACCOUNT (all number)`.

- [ ] **Step 1: Write the failing test** (`tests/env.test.ts`)

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { loadEnv } from '../src/env.js';

const base = {
  DATABASE_URL: 'postgres://chatsundere:dev@localhost:5432/sync_db',
  REDIS_URL: 'redis://localhost:6379',
  AUTH_JWKS_URL: 'https://auth.example/api/v1/jwks',
};

describe('sync env', () => {
  test('JWT_ISSUER defaults to chatsundere-auth-v1', () => {
    // The skeleton default (chatsundere-auth) was wrong — spec §9.
    expect(loadEnv(base).JWT_ISSUER).toBe('chatsundere-auth-v1');
  });
  test('quota and ceiling defaults match spec §14', () => {
    const env = loadEnv(base);
    expect(env.MAX_RECORD_BYTES).toBe(2097152);
    expect(env.ACCOUNT_QUOTA_BYTES).toBe(1073741824);
    expect(env.MAX_PUSH_RECORDS).toBe(100);
    expect(env.MAX_BODY_BYTES).toBe(25165824);
    expect(env.PULL_LIMIT_DEFAULT).toBe(200);
    expect(env.PULL_LIMIT_MAX).toBe(500);
    expect(env.PULL_BYTE_BUDGET).toBe(8388608);
    expect(env.RATE_LIMIT_DELETE_PER_MIN).toBe(60);
    expect(env.WS_PING_INTERVAL_S).toBe(30);
    expect(env.DOORBELL_TICKET_TTL_S).toBe(30);
    expect(env.MAX_SOCKETS_PER_ACCOUNT).toBe(8);
  });
  test('CORS_ALLOWED_ORIGINS parses a comma list, lowercased', () => {
    const env = loadEnv({ ...base, CORS_ALLOWED_ORIGINS: 'https://A.me, https://b.me' });
    expect(env.CORS_ALLOWED_ORIGINS).toEqual(['https://a.me', 'https://b.me']);
  });
});
```

- [ ] **Step 2: Run** `cd apps/sync-service && bun test tests/env.test.ts` — FAIL (wrong issuer default, missing fields).
- [ ] **Step 3: Rewrite `src/env.ts`** following the proxy-service `env.ts`
  house pattern exactly (the `num(fallback)` helper, valibot pipe transforms —
  see `apps/proxy-service/src/env.ts` in-tree). Add every field from the
  Interfaces block with the §14 defaults. `WS_IDLE_TIMEOUT_S` default: the
  Probe-B value.
- [ ] **Step 4: Update `.env.example`** — every variable, realistic
  placeholders, one-line comments; include the §14 note that `REDIS_URL` must
  point at the same Redis as the auth-service (deny-list visibility).
- [ ] **Step 5: Run** the test — PASS; `pnpm --filter @chatsundere/sync-service typecheck`.
- [ ] **Step 6: Commit** `Rework sync-service env schema for the sync backend`

---

## Task 3: Envelope codec (`packages/crypto`)

**Files:**
- Create: `packages/crypto/src/sync-envelope/codec.ts`
- Test: `packages/crypto/tests/sync-envelope/codec.test.ts`

**Interfaces:**
- Produces: `encodeRow(row: unknown): Uint8Array`,
  `decodeRow(bytes: Uint8Array): unknown`. `Uint8Array` values encode as
  `{ "$bytes": "<base64url>" }`; `Blob`/`ArrayBuffer` values throw
  `CryptoError('invalid_input', …)`; a genuine object key `"$bytes"` in input
  throws (reserved).

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { decodeRow, encodeRow } from '../../src/sync-envelope/codec.js';

describe('sync codec', () => {
  it('round-trips a row with nested Uint8Array fields (EncryptedBlob shape)', () => {
    const row = {
      id: 'p1',
      apiKey: { ciphertext: new Uint8Array([1, 2, 255]), nonce: new Uint8Array(12) },
      name: 'wafer',
      updatedAt: 1730000000000,
    };
    const out = decodeRow(encodeRow(row)) as typeof row;
    expect(out.apiKey.ciphertext).toBeInstanceOf(Uint8Array);
    expect([...out.apiKey.ciphertext]).toEqual([1, 2, 255]);
    expect(out).toEqual(row);
  });
  it('round-trips vectors-shaped rows (codes/scales/offsets)', () => {
    const row = { id: 'd1#0', codes: new Uint8Array(64), scales: new Uint8Array(8), tags: ['lib1'] };
    expect(decodeRow(encodeRow(row))).toEqual(row);
  });
  it('rejects a Blob value', () => {
    expect(() => encodeRow({ blob: new Blob(['x']) })).toThrow();
  });
  it('rejects a reserved $bytes key in input', () => {
    expect(() => encodeRow({ nested: { $bytes: 'sneaky' } })).toThrow();
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter @chatsundere/crypto test -- sync-envelope` — FAIL (module missing).
- [ ] **Step 3: Implement `codec.ts`**

```ts
// SPDX-License-Identifier: LGPL-3.0-only

import { fromBase64Url, toBase64Url } from '../encoding/base64url.js';
import { CryptoError } from '../errors.js';

const RESERVED = '$bytes';

/** Encodes a row to bytes: JSON with Uint8Array fields as {"$bytes": base64url}. */
export function encodeRow(row: unknown): Uint8Array {
  const json = JSON.stringify(row, (_key, value: unknown) => {
    if (value instanceof Uint8Array) return { [RESERVED]: toBase64Url(value) };
    if (typeof Blob !== 'undefined' && value instanceof Blob) {
      throw new CryptoError('invalid_input', 'Blob values are not representable (excluded collection?)');
    }
    if (value instanceof ArrayBuffer) {
      throw new CryptoError('invalid_input', 'ArrayBuffer values are not representable');
    }
    if (
      typeof value === 'object' && value !== null && !Array.isArray(value) &&
      !(value instanceof Uint8Array) && RESERVED in (value as Record<string, unknown>)
    ) {
      throw new CryptoError('invalid_input', 'the key "$bytes" is reserved by the sync codec');
    }
    return value;
  });
  return new TextEncoder().encode(json);
}

/** Decodes codec bytes back to a row, restoring Uint8Array fields. */
export function decodeRow(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(bytes), (_key, value: unknown) => {
    if (
      typeof value === 'object' && value !== null &&
      Object.keys(value).length === 1 && typeof (value as Record<string, unknown>)[RESERVED] === 'string'
    ) {
      return fromBase64Url((value as Record<string, string>)[RESERVED] as string);
    }
    return value;
  });
}
```

Note: `JSON.stringify` replacers receive the value **after** any `toJSON` —
Uint8Array has none, but the replacer also receives the *already-wrapped*
object on recursion; the reserved-key guard above must not fire on the codec's
own wrapper. Handle by wrapping via a distinct marker class or by checking
`value instanceof Uint8Array` **before** the reserved-key guard and returning
a plain object the guard skips (the code above does the latter — the wrapper
object is produced by the replacer and is not re-visited with `$bytes` as a
*user* key; verify with the tests, and if the runtime re-visits it, switch to
a pre-pass deep-transform instead of a replacer — the tests are the contract,
the technique is yours).

- [ ] **Step 4: Run** — PASS. `pnpm --filter @chatsundere/crypto typecheck`.
- [ ] **Step 5: Check** `CryptoError` codes: if `'invalid_input'` is not an
  existing `CryptoErrorCode`, add it to `src/errors.ts` (one union member).
- [ ] **Step 6: Commit** `Add binary-aware sync codec to packages/crypto`

---

## Task 4: Blind index + padding (`packages/crypto`)

**Files:**
- Create: `packages/crypto/src/sync-envelope/blind-index.ts`
- Create: `packages/crypto/src/sync-envelope/padding.ts`
- Test: `packages/crypto/tests/sync-envelope/blind-index.test.ts`, `.../padding.test.ts`

**Interfaces:**
- Produces: `computeBlindId(mk: MasterKey, collection: string, key: string): Promise<Uint8Array>`
  (16 bytes; HMAC-SHA256 over `utf8(collection) || 0x00 || utf8(key)` keyed by
  `deriveDek(mk, 'sync/blind-index-v1')`, truncated);
  `padPlaintext(encoded: Uint8Array, padded: boolean): Uint8Array`
  (u32-LE length prefix + payload + zeros to the §5.3 bucket when `padded`,
  no padding otherwise); `unpadPlaintext(padded: Uint8Array): Uint8Array`.

- [ ] **Step 1: Write the failing tests**

```ts
// blind-index.test.ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { asMasterKey } from '../../src/types.js';
import { computeBlindId } from '../../src/sync-envelope/blind-index.js';

const mkA = asMasterKey(new Uint8Array(32).fill(7));
const mkB = asMasterKey(new Uint8Array(32).fill(9));

describe('computeBlindId', () => {
  it('is 16 bytes and deterministic for the same mk/collection/key', async () => {
    const a = await computeBlindId(mkA, 'chats', 'uuid-1');
    const b = await computeBlindId(mkA, 'chats', 'uuid-1');
    expect(a).toHaveLength(16);
    expect([...a]).toEqual([...b]);
  });
  it('diverges across MKs, collections, and keys', async () => {
    const base = await computeBlindId(mkA, 'chats', 'uuid-1');
    for (const other of [
      await computeBlindId(mkB, 'chats', 'uuid-1'),
      await computeBlindId(mkA, 'messages', 'uuid-1'),
      await computeBlindId(mkA, 'chats', 'uuid-2'),
    ]) expect([...other]).not.toEqual([...base]);
  });
  it('separator prevents boundary shifts', async () => {
    const a = await computeBlindId(mkA, 'chat', 's123');
    const b = await computeBlindId(mkA, 'chats', '123');
    expect([...a]).not.toEqual([...b]);
  });
});
```

```ts
// padding.test.ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { padPlaintext, unpadPlaintext } from '../../src/sync-envelope/padding.js';

const bytes = (n: number) => new Uint8Array(n).fill(1);

describe('padding', () => {
  it('unpad inverts pad for both modes', () => {
    for (const padded of [true, false]) {
      const out = unpadPlaintext(padPlaintext(bytes(1000), padded));
      expect(out).toEqual(bytes(1000));
    }
  });
  it('bucket edges: 1023/1024/1025 payload bytes (incl. the 4-byte prefix)', () => {
    // total = 4 + n, padded to the next power-of-two bucket ≥ 1024
    expect(padPlaintext(bytes(1019), true)).toHaveLength(1024);  // 4+1019=1023 → 1024
    expect(padPlaintext(bytes(1020), true)).toHaveLength(1024);  // exactly 1024
    expect(padPlaintext(bytes(1021), true)).toHaveLength(2048);  // 1025 → 2048
  });
  it('caps at 1 MiB then steps by 256 KiB', () => {
    const oneMiB = 1_048_576;
    expect(padPlaintext(bytes(oneMiB - 4), true)).toHaveLength(oneMiB);
    expect(padPlaintext(bytes(oneMiB), true)).toHaveLength(oneMiB + 262_144);
  });
  it('unpadded mode adds only the prefix', () => {
    expect(padPlaintext(bytes(500), false)).toHaveLength(504);
  });
  it('rejects a corrupt length prefix', () => {
    const p = padPlaintext(bytes(10), true);
    new DataView(p.buffer).setUint32(0, 999999, true);
    expect(() => unpadPlaintext(p)).toThrow();
  });
});
```

- [ ] **Step 2: Run** — FAIL (modules missing).
- [ ] **Step 3: Implement.** `blind-index.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only

import { deriveDek } from '../dek.js';
import type { MasterKey } from '../types.js';

const CONTEXT = 'sync/blind-index-v1';
const SEPARATOR = 0x00;
const BLIND_ID_BYTES = 16;

/** Deterministic 16-byte blind index for a record: HMAC-SHA256(dek, collection || 0x00 || key), truncated. */
export async function computeBlindId(
  mk: MasterKey,
  collection: string,
  key: string,
): Promise<Uint8Array> {
  const dek = await deriveDek(mk, CONTEXT);
  const enc = new TextEncoder();
  const c = enc.encode(collection);
  const k = enc.encode(key);
  const input = new Uint8Array(c.length + 1 + k.length);
  input.set(c, 0);
  input[c.length] = SEPARATOR;
  input.set(k, c.length + 1);
  const hmacKey = await globalThis.crypto.subtle.importKey(
    'raw', dek as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', hmacKey, input as BufferSource));
  return mac.slice(0, BLIND_ID_BYTES);
}
```

`padding.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only

import { CryptoError } from '../errors.js';

const MIN_BUCKET = 1024;
const CAP = 1_048_576;          // 1 MiB — buckets stop doubling here (spec §5.3)
const STEP_ABOVE_CAP = 262_144; // 256 KiB

function bucketFor(total: number): number {
  if (total <= CAP) {
    let b = MIN_BUCKET;
    while (b < total) b *= 2;
    return b;
  }
  return Math.ceil(total / STEP_ABOVE_CAP) * STEP_ABOVE_CAP;
}

/** Frames `encoded` with a u32-LE length prefix; zero-pads to the §5.3 bucket when `padded`. */
export function padPlaintext(encoded: Uint8Array, padded: boolean): Uint8Array {
  const total = 4 + encoded.length;
  const target = padded ? bucketFor(total) : total;
  const out = new Uint8Array(target);
  new DataView(out.buffer).setUint32(0, encoded.length, true);
  out.set(encoded, 4);
  return out;
}

/** Inverts padPlaintext. Throws on an impossible length prefix. */
export function unpadPlaintext(framed: Uint8Array): Uint8Array {
  if (framed.length < 4) throw new CryptoError('corrupted_data', 'framed plaintext too short');
  const len = new DataView(framed.buffer, framed.byteOffset).getUint32(0, true);
  if (4 + len > framed.length) throw new CryptoError('corrupted_data', 'invalid plaintext length prefix');
  return framed.slice(4, 4 + len);
}
```

- [ ] **Step 4: Run** — PASS. Typecheck.
- [ ] **Step 5: Commit** `Add sync blind index and padding primitives`

---

## Task 5: sealRecord / openRecord (`packages/crypto`)

**Files:**
- Create: `packages/crypto/src/sync-envelope/seal.ts`, `packages/crypto/src/sync-envelope/index.ts`
- Modify: `packages/crypto/src/index.ts` (re-export the sync-envelope surface)
- Test: `packages/crypto/tests/sync-envelope/seal.test.ts`

**Interfaces:**
- Consumes: Tasks 3/4 (`encodeRow`/`decodeRow`, `computeBlindId`,
  `padPlaintext`/`unpadPlaintext`), `deriveDek`.
- Produces:
  `PADDED_COLLECTIONS: ReadonlySet<string>` (`personas`, `memoryBody`,
  `memoryJournal`, `seedTemplates`);
  `sealRecord(mk, collection, key, row): Promise<SealedRecord>` where
  `SealedRecord = { blindId: Uint8Array; envelopeVersion: 1; nonce: Uint8Array; ciphertext: Uint8Array; ciphertextHash: Uint8Array }`;
  `openRecord(mk, collection, blindId, sealed: { nonce; ciphertext }, extractKey: (row: unknown) => string): Promise<unknown>`.
  AAD = `utf8('chatsundere-sync-v1') || utf8(collection) || blindId`.
  `openRecord` re-computes the blind id from `extractKey(row)` and throws on
  mismatch.

- [ ] **Step 1: Write the failing tests** — cover, with real code (write each
  as a concrete `it(...)`, no placeholders):
  1. Round-trip per shape: an unpadded `chats` row, a padded `personas` row
     with `adultPersona: true`, a `providers` row with a nested
     `EncryptedBlob`-shaped Uint8Array field, a `vectors` row with the
     composite key `'d1#0'`.
  2. Nonce uniqueness: two seals of the same row differ in `nonce` and `ciphertext`.
  3. AAD tamper matrix: opening under a foreign `blindId`, a different
     `collection`, or ciphertext with one flipped byte each throws
     `CryptoError('corrupted_data')`.
  4. Key re-check: seal a row, then open it presenting a *different* record's
     valid blindId+ciphertext pair swapped at the storage layer — since AAD
     already fails that, additionally test the belt-and-braces path directly:
     seal row A whose inner id is `'a'`, open with `extractKey` returning
     `'b'` → throws (blind-id re-check).
  5. Padding is applied for padded collections only: `personas` ciphertext
     length ∈ {1024+16, 2048+16, …} (GCM tag 16 B); `chats` ciphertext length
     = 4 + json + 16.
  6. `ciphertextHash` equals `SHA-256(ciphertext)` (compute independently in
     the test via `crypto.subtle.digest`).
  7. **NSFW invariant (whole-wire scan):** seal a `personas` row with
     `adultPersona: true` and a `seedTemplates` row with `nsfw: true`; assert
     the strings `adultPersona`, `nsfw`, `true` do **not** occur in the
     concatenation of `collection`, base64url(blindId), base64url(nonce),
     base64url(ciphertextHash) — i.e. everything that goes on the wire except
     the ciphertext.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement `seal.ts`**

```ts
// SPDX-License-Identifier: LGPL-3.0-only

import { deriveDek } from '../dek.js';
import { CryptoError } from '../errors.js';
import { getRandomBytes } from '../primitives/random.js';
import type { MasterKey } from '../types.js';
import { decodeRow, encodeRow } from './codec.js';
import { computeBlindId } from './blind-index.js';
import { padPlaintext, unpadPlaintext } from './padding.js';

const VERSION_TAG = 'chatsundere-sync-v1';
const NONCE_BYTES = 12;

/** Collections whose plaintext is size-padded (spec §5.3). */
export const PADDED_COLLECTIONS: ReadonlySet<string> = new Set([
  'personas', 'memoryBody', 'memoryJournal', 'seedTemplates',
]);

export interface SealedRecord {
  blindId: Uint8Array;
  envelopeVersion: 1;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  ciphertextHash: Uint8Array;
}

function buildAad(collection: string, blindId: Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  const v = enc.encode(VERSION_TAG);
  const c = enc.encode(collection);
  const out = new Uint8Array(v.length + c.length + blindId.length);
  out.set(v, 0); out.set(c, v.length); out.set(blindId, v.length + c.length);
  return out;
}

async function collectionKey(mk: MasterKey, collection: string): Promise<CryptoKey> {
  const dek = await deriveDek(mk, `sync/collection/${collection}-v1`);
  return globalThis.crypto.subtle.importKey(
    'raw', dek as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'],
  );
}

/** Seals one row for sync: blind id, AES-256-GCM under the collection DEK, padding, hash. */
export async function sealRecord(
  mk: MasterKey, collection: string, key: string, row: unknown,
): Promise<SealedRecord> {
  const blindId = await computeBlindId(mk, collection, key);
  const plaintext = padPlaintext(encodeRow(row), PADDED_COLLECTIONS.has(collection));
  const nonce = getRandomBytes(NONCE_BYTES);
  const cryptoKey = await collectionKey(mk, collection);
  const ciphertext = new Uint8Array(await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as BufferSource, additionalData: buildAad(collection, blindId) as BufferSource },
    cryptoKey, plaintext as BufferSource,
  ));
  const ciphertextHash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', ciphertext as BufferSource));
  return { blindId, envelopeVersion: 1, nonce, ciphertext, ciphertextHash };
}

/** Opens a pulled record; verifies AAD binding and the inner-key/blind-id match. */
export async function openRecord(
  mk: MasterKey, collection: string, blindId: Uint8Array,
  sealed: { nonce: Uint8Array; ciphertext: Uint8Array },
  extractKey: (row: unknown) => string,
): Promise<unknown> {
  const cryptoKey = await collectionKey(mk, collection);
  let plainBuf: ArrayBuffer;
  try {
    plainBuf = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: sealed.nonce as BufferSource, additionalData: buildAad(collection, blindId) as BufferSource },
      cryptoKey, sealed.ciphertext as BufferSource,
    );
  } catch {
    throw new CryptoError('corrupted_data', 'sync record failed AEAD verification');
  }
  const row = decodeRow(unpadPlaintext(new Uint8Array(plainBuf)));
  const expected = await computeBlindId(mk, collection, extractKey(row));
  if (expected.length !== blindId.length || !expected.every((b, i) => b === blindId[i])) {
    throw new CryptoError('corrupted_data', 'sync record key does not match its blind id');
  }
  return row;
}
```

Create `sync-envelope/index.ts` re-exporting all of Tasks 3–5; add the
re-export block to `packages/crypto/src/index.ts`.

- [ ] **Step 4: Run** the full crypto suite (`pnpm --filter @chatsundere/crypto test`) — new tests PASS, no regressions. Typecheck.
- [ ] **Step 5: Commit** `Add sync record envelope (seal/open) to packages/crypto`

---

## Task 6: Wire types + error codes (`packages/shared-types`)

**Files:**
- Create: `packages/shared-types/src/sync.ts`
- Modify: `packages/shared-types/src/index.ts`
- Test: `packages/shared-types/tests/sync.test.ts` (mirror the package's existing test layout; if none exists, a type-level compile test file is sufficient plus runtime tests for the key builders)

**Interfaces (produces — the single source of truth both sides import):**

```ts
// SPDX-License-Identifier: MIT

/** Collections the sync server accepts (spec §5.4). */
export const SYNC_COLLECTIONS = [
  'settings', 'providers', 'mcpServers', 'mindspaces', 'personas', 'chats',
  'messages', 'pills', 'seedTemplates', 'libraries', 'documents', 'vectors',
  'memoryJournal', 'memoryBody', 'compactionCheckpoints',
] as const;
export type SyncCollection = (typeof SYNC_COLLECTIONS)[number];

/** One record on the push wire. Binary fields are base64url strings. */
export interface SyncPushRecord {
  blindId: string;
  collection: SyncCollection;
  envelopeVersion: number;
  baseRev: number;
  deleted: boolean;
  nonce?: string;
  ciphertext?: string;
  ciphertextHash?: string;
}

/** One record on the pull wire; tombstones omit the crypto fields. */
export interface SyncPulledRecord {
  blindId: string;
  collection: SyncCollection;
  envelopeVersion?: number;
  rev: number;
  deleted: boolean;
  nonce?: string;
  ciphertext?: string;
  ciphertextHash?: string;
}

export type SyncRecordErrorCode =
  | 'bad_collection' | 'collection_mismatch' | 'record_too_large'
  | 'quota_exceeded' | 'delete_rate_limited' | 'hash_mismatch';

export type SyncPushResult =
  | { status: 'ok'; rev: number }
  | { status: 'conflict'; current: SyncPulledRecord }
  | { status: 'tombstoned'; current: SyncPulledRecord }
  | { status: 'error'; code: SyncRecordErrorCode; usedBytes?: number; quotaBytes?: number };

export interface SyncPushRequest { records: SyncPushRecord[] }
export interface SyncPushResponse { head: number; epoch: string; results: SyncPushResult[] }
export interface SyncPullResponse { head: number; epoch: string; more: boolean; records: SyncPulledRecord[] }
export interface DoorbellTicketResponse { ticket: string }
export interface DoorbellPoke { rev: number; epoch: string }

/** Redis deny-list keys (spec §9) — written by auth-service, read by sync-service. */
export const revokedJtiKey = (jti: string): string => `revoked:jti:${jti}`;
export const revokedSubKey = (sub: string): string => `revoked:sub:${sub}`;
```

- [ ] **Steps:** failing test (key builders + a compile-level use of each
  type) → implement exactly the block above → export from `index.ts` → test +
  `pnpm --filter @chatsundere/shared-types typecheck` → **Commit**
  `Add sync wire types and revocation key builders to shared-types`.

---

## Task 7: sync-service DB schema + migrations + test harness

**Files:**
- Create: `apps/sync-service/src/db/schema.ts`, `src/db/client.ts`, `src/db/migrations.ts`, `drizzle.config.ts`, `migrations/0000_*.sql` (generated)
- Modify: `apps/sync-service/package.json` (add `drizzle-orm`, `postgres`, `ioredis`, `jose`; dev: `drizzle-kit`; scripts `db:generate`, `db:migrate` — copy the auth-service versions)
- Create: `apps/sync-service/tests/helpers/test-db.ts`
- Test: `apps/sync-service/tests/db.test.ts`

**Interfaces:**
- Produces: Drizzle tables `syncRecords`, `syncAccounts`, `syncMeta` matching
  spec §4 exactly (bytea via the auth-service `customType` pattern; **no
  timestamp columns**); `createDb(url)`; `getInstanceEpoch(db): Promise<string>`
  (reads the single `sync_meta` row); test helper `withTestDb()` that refuses
  to run unless `TEST_DATABASE_URL` is set (mirror
  `apps/auth-service/tests/` — read its helper first and copy the isolation
  discipline verbatim).

- [ ] **Step 1: Write the failing test** — `db.test.ts`: migrations apply
  cleanly on a fresh test DB; `sync_meta` contains exactly one row whose
  `instance_epoch` is a uuid; inserting and reading back a `sync_records` row
  with a 2 MiB ciphertext is byte-identical (Probe C made durable);
  `information_schema` query asserts `sync_records` has **no** column of type
  `timestamp`/`timestamptz` (the §4 invariant, test-enforced); dropping the
  schema and re-migrating yields a **different** `instance_epoch` (the §17
  simulated-restore case).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** `schema.ts` (copy the `bytea` customType from
  `apps/auth-service/src/db/schema.ts` lines 25–30):

```ts
// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from 'drizzle-orm';
import { bigint, boolean, customType, index, pgTable, primaryKey, smallint, text, uuid } from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
});

// Deliberately no timestamp columns anywhere (spec §4): receipt times are
// metadata the store simply does not have at rest.
export const syncRecords = pgTable('sync_records', {
  accountId: uuid('account_id').notNull(),
  blindId: bytea('blind_id').notNull(),
  collection: text('collection').notNull(),
  envelopeVersion: smallint('envelope_version').notNull().default(1),
  rev: bigint('rev', { mode: 'number' }).notNull(),
  deleted: boolean('deleted').notNull().default(false),
  nonce: bytea('nonce'),
  ciphertext: bytea('ciphertext'),
  ciphertextHash: bytea('ciphertext_hash'),
}, (t) => [
  primaryKey({ columns: [t.accountId, t.blindId] }),
  index('sync_records_account_rev_idx').on(t.accountId, t.rev),
]);

export const syncAccounts = pgTable('sync_accounts', {
  accountId: uuid('account_id').primaryKey(),
  headRev: bigint('head_rev', { mode: 'number' }).notNull().default(0),
  totalBytes: bigint('total_bytes', { mode: 'number' }).notNull().default(0),
});

export const syncMeta = pgTable('sync_meta', {
  instanceEpoch: uuid('instance_epoch').primaryKey().default(sql`gen_random_uuid()`),
});
```

Generate the migration (`pnpm --filter @chatsundere/sync-service db:generate`),
then **append to the generated SQL** a seed statement so the epoch exists from
first migration: `INSERT INTO sync_meta DEFAULT VALUES;`. `client.ts` and
`migrations.ts` mirror the auth-service files (postgres-js, `migrate()`).

- [ ] **Step 4: Run** — PASS. Typecheck. `pnpm install` ran cleanly for the new deps.
- [ ] **Step 5: Commit** `Add sync-service database schema, migrations, and test harness`

---

## Task 8: JWT verification + revocation check

**Files:**
- Create: `apps/sync-service/src/auth/verify-token.ts` — adapt
  `apps/proxy-service/src/auth/verify-token.ts` (in-tree post-merge) 1:1:
  pinned `algorithms: ['EdDSA']`, exact `issuer`, `clockTolerance: 5`,
  hardened `jose` fetch options, `aud` ignored. The verifier must return the
  payload's `sub`, `jti`, and `iat`.
- Create: `apps/sync-service/src/auth/revocation.ts`
- Test: `apps/sync-service/tests/verify-token.test.ts` (adapt the proxy's test
  approach — locally-generated Ed25519 key + injected JWKS), `tests/revocation.test.ts`

**Interfaces:**
- Produces: `createTokenVerifier(env) → verifyToken(token): Promise<{ sub: string; jti: string; iat: number } | null>`;
  `isRevoked(redis, claims: { sub: string; jti: string; iat: number }): Promise<boolean>`.

- [ ] **Step 1: Failing tests.** Verifier: valid → claims; expired /
  wrong-issuer / tampered / RS256-signed / absent → null; JWKS fetch failure →
  null (fail closed). Revocation (ioredis against the test Redis, or
  `ioredis-mock` if the proxy tests used a fake — mirror whichever the proxy
  suite uses): `revoked:jti:<jti>` set → true; `revoked:sub:<sub>` holding a
  unix-seconds string **greater than** the token's `iat` → true; **less than**
  `iat` → false (the §9 re-login rule); neither key → false; Redis error →
  throws (the route maps it to `503`).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** `revocation.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only

import type { Redis } from 'ioredis';
import { revokedJtiKey, revokedSubKey } from '@chatsundere/shared-types';

/** True when the token's session or subject was revoked after the token was issued (spec §9). */
export async function isRevoked(
  redis: Redis,
  claims: { sub: string; jti: string; iat: number },
): Promise<boolean> {
  const [jtiHit, subRevokedAt] = await redis.mget(
    revokedJtiKey(claims.jti),
    revokedSubKey(claims.sub),
  );
  if (jtiHit !== null) return true;
  if (subRevokedAt !== null && claims.iat < Number(subRevokedAt)) return true;
  return false;
}
```

- [ ] **Step 4: Run** — PASS. Typecheck.
- [ ] **Step 5: Commit** `Add JWT verification and revocation deny-list check to sync-service`

---

## Task 9: Client IP + rate limiter (incl. delete window)

**Files:**
- Create: `apps/sync-service/src/net/client-ip.ts`,
  `apps/sync-service/src/ratelimit/limiter.ts` — adapt the proxy-service
  equivalents 1:1 (trusted-hop derivation; Redis sliding window; **fail
  closed** on Redis error). Key prefixes: `sync:rl:user:`, `sync:rl:ip:`,
  `sync:rl:del:`.
- Test: `apps/sync-service/tests/limiter.test.ts`, `tests/client-ip.test.ts` —
  port the proxy's tests, add: the delete window is independent of the user
  window (59 tombstones + 100 ordinary writes in a minute → deletes pass,
  ordinary writes pass; the 61st tombstone → limited while ordinary writes
  still pass).
- [ ] **Steps:** failing tests → implement → PASS → typecheck → **Commit**
  `Add client-IP derivation and rate limiting to sync-service`

---

## Task 10: The records store — CAS, tombstones, quota, epoch

**Files:**
- Create: `apps/sync-service/src/records/collections.ts` (re-export
  `SYNC_COLLECTIONS` as a `Set` + `isSyncCollection()` guard)
- Create: `apps/sync-service/src/records/store.ts`
- Test: `apps/sync-service/tests/store.test.ts` (integration, `withTestDb()`)

**Interfaces:**
- Consumes: Task 7 tables, Task 6 types.
- Produces:
  `applyBatch(db, accountId, records: StoreWriteRecord[], limits): Promise<{ head: number; results: SyncPushResult[]; accepted: boolean }>`
  where `StoreWriteRecord` is the decoded-binary form of `SyncPushRecord`
  (`blindId: Uint8Array` etc.) and `limits = { maxRecordBytes: number; quotaBytes: number; deleteAllowance: (count: number) => Promise<number> }`
  (the limiter hook returns how many of `count` requested deletes are
  permitted); `pullSince(db, accountId, since, limit, byteBudget): Promise<{ head: number; more: boolean; records: StoredRecord[] }>`;
  `getHead(db, accountId): Promise<number>`.
- `accepted` is true when at least one record got a fresh rev (drives the
  doorbell publish in Task 11).

- [ ] **Step 1: Write the failing integration tests** — the spec §17 CAS
  matrix, each as a concrete test:
  - insert (`baseRev 0`) on absent → `ok`, rev 1; head 1.
  - insert on present → `conflict` carrying the current record.
  - update with matching `baseRev` → `ok`, fresh rev; with stale → `conflict`.
  - update whose `collection` differs from the stored tag → `collection_mismatch`.
  - delete with stale `baseRev` → still `ok` (deletes skip CAS); row now
    `deleted`, `nonce`/`ciphertext`/`ciphertext_hash` all NULL (assert via raw
    select).
  - delete of an absent blindId → creates a terminal tombstone (`ok`).
  - delete of a tombstone → `ok` with the **existing** rev; head unchanged;
    `accepted` false when the batch contained only such no-ops.
  - insert and update against a tombstone → `tombstoned` + tombstone record.
  - per-record atomicity: batch of [ok-insert, conflict, ok-insert] → results
    positionally aligned, both inserts persisted.
  - **two concurrent `applyBatch` calls inserting the same blindId** (run via
    `Promise.all` on two connections) → exactly one `ok`, one `conflict`,
    neither throws (the lock-at-batch-start discipline `[P]`).
  - revs contiguous within a batch; two accounts never see each other's revs.
  - `record_too_large` at `maxRecordBytes`+1; `quota_exceeded` (with
    used/quota numbers) when `total_bytes` would exceed; quota accounting:
    update replaces old byte count (delta), tombstone frees it.
  - `delete_rate_limited` when the `deleteAllowance` hook grants fewer than
    requested (grant order: first N tombstones in batch order).
  - `pullSince`: ascending, `since` boundaries, `limit` respected, byte budget
    ends a page early with `more: true`, tombstones carried with NULL crypto
    fields.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement `store.ts`.** Core shape (complete the branches per
  the tests):

```ts
// SPDX-License-Identifier: AGPL-3.0-only

import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { syncAccounts, syncRecords } from '../db/schema.js';

export async function applyBatch(db, accountId, records, limits) {
  return db.transaction(async (tx) => {
    // Account row lock FIRST, unconditionally — before any record is examined
    // (spec §4: per-record atomicity depends on batch-level serialisation).
    await tx.insert(syncAccounts).values({ accountId }).onConflictDoNothing();
    const [account] = await tx
      .select().from(syncAccounts)
      .where(eq(syncAccounts.accountId, accountId))
      .for('update');
    let head = account.headRev;
    let totalBytes = account.totalBytes;
    let accepted = false;

    const deletesRequested = records.filter((r) => r.deleted).length;
    let deleteAllowance = deletesRequested > 0 ? await limits.deleteAllowance(deletesRequested) : 0;

    const results = [];
    for (const record of records) {
      const existing = await tx.select().from(syncRecords).where(and(
        eq(syncRecords.accountId, accountId), eq(syncRecords.blindId, record.blindId),
      ));
      const current = existing[0];
      // … per-record branches, in this order:
      // 1. tombstoned current + !record.deleted   → { status: 'tombstoned', current }
      // 2. record.deleted:
      //      already tombstoned                   → { status: 'ok', rev: current.rev } (no head bump)
      //      delete allowance exhausted           → { status: 'error', code: 'delete_rate_limited' }
      //      else: upsert tombstone (NULL crypto fields), totalBytes -= old size,
      //            rev = ++head, accepted = true  → { status: 'ok', rev }
      // 3. bad collection                          → { status: 'error', code: 'bad_collection' }
      // 4. current && current.collection !== record.collection
      //                                            → { status: 'error', code: 'collection_mismatch' }
      // 5. ciphertext.length > limits.maxRecordBytes
      //                                            → { status: 'error', code: 'record_too_large' }
      // 6. sha256(ciphertext) !== ciphertextHash   → { status: 'error', code: 'hash_mismatch' }
      // 7. CAS: (record.baseRev === 0) !== (current === undefined) or
      //         current.rev !== record.baseRev     → { status: 'conflict', current }
      // 8. quota: totalBytes - oldSize + newSize > limits.quotaBytes
      //                                            → { status: 'error', code: 'quota_exceeded', usedBytes, quotaBytes }
      // 9. else upsert, totalBytes delta, rev = ++head, accepted = true → { status: 'ok', rev }
      results.push(/* branch result */);
    }
    await tx.update(syncAccounts)
      .set({ headRev: head, totalBytes })
      .where(eq(syncAccounts.accountId, accountId));
    return { head, results, accepted };
  });
}
```

(The commented branch list is the specification of the loop body — implement
every branch literally; the tests pin each one. `sha256` via
`crypto.subtle.digest`. Tombstone pushes skip branches 5/6/8 — they carry no
ciphertext.)

- [ ] **Step 4: Run** — PASS. Typecheck.
- [ ] **Step 5: Commit** `Add the sync records store with CAS, tombstone terminality, and quotas`

---

## Task 11: Push route

**Files:**
- Create: `apps/sync-service/src/routes/changes.ts` (push half)
- Create: `apps/sync-service/src/doorbell/publish.ts` — `publishPoke(redis, accountId, head, epoch)` publishing `JSON.stringify({ rev: head, epoch })` to `sync:<accountId>`.
- Test: `apps/sync-service/tests/push.test.ts` (route-level via `app.request()`, `withTestDb()` + test Redis)

**Interfaces:**
- Consumes: Tasks 6/8/9/10.
- Produces: `POST /api/v1/sync/changes` per spec §7.1.

- [ ] **Step 1: Failing tests:**
  - Auth: absent/invalid token → `401`; a `revoked:jti` token → `401`.
  - Shape: malformed JSON, unknown top-level field, a record with a 15-byte
    `blindId` or 11-byte `nonce`, `records.length > MAX_PUSH_RECORDS` → `400`;
    body over `MAX_BODY_BYTES` → `413` (use Hono's `bodyLimit`; Probe F).
  - Happy path: valid seal-shaped record (build binary fields with random
    bytes + a correct sha256 — the server never decrypts) → `200`, `ok`
    result, `head`/`epoch` present.
  - Per-record semantics surface through the route (one conflict + one ok in
    a batch).
  - **Doorbell publish fires post-commit, once per accepted batch**: subscribe
    a test Redis client to `sync:<account>` first; a batch with 3 accepted
    records → exactly one poke whose `rev` equals the response `head`, and a
    subsequent `pullSince` (fresh connection) at poke time sees the records
    (commit-before-publish); an all-idempotent batch (`accepted: false`) →
    no poke.
  - Rate limits: 429 shape with `Retry-After` (drive the limiter to its cap).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the route: valibot schema for the body
  (base64url-decode + length-validate the binary fields → `StoreWriteRecord`),
  the §3 middleware order (IP → per-IP limit → verify → revocation → per-user
  limit), `applyBatch`, **`await tx` completion then `publishPoke` only when
  `accepted`**, response `{ head, epoch, results }` with `epoch` from
  `getInstanceEpoch` (cached at boot). Metrics per outcome
  (`sync_push_records_total{outcome}`).
- [ ] **Step 4: Run** — PASS. Typecheck.
- [ ] **Step 5: Commit** `Add the sync push route with post-commit doorbell publish`

---

## Task 12: Pull route

**Files:**
- Modify: `apps/sync-service/src/routes/changes.ts` (pull half)
- Test: `apps/sync-service/tests/pull.test.ts`

**Interfaces:** `GET /api/v1/sync/changes?since=&limit=` per spec §7.2.

- [ ] **Step 1: Failing tests:** ascending records with `rev > since`;
  `head`/`epoch`/`more` fields; default and max `limit` (**over-max clamps,
  not 400**); `since` malformed or negative → `400`; `since > head` → `400`
  with `{ error: 'bad_since' }`; byte-budget page break (`more: true`);
  tombstones on the wire without crypto fields; auth + revocation as in push;
  account isolation (account B's token never sees account A's records).
- [ ] **Step 2–4:** implement, PASS, typecheck.
- [ ] **Step 5: Commit** `Add the sync pull route with paging and byte budget`

---

## Task 13: Doorbell — ticket + hub + WebSocket

**Files:**
- Create: `apps/sync-service/src/routes/doorbell.ts` — `POST
  /api/v1/sync/doorbell-ticket` (authed via the same middleware chain):
  32-byte random ticket → `SET sync:ticket:<ticket> <json {accountId, tokenExp}> EX <DOORBELL_TICKET_TTL_S>`;
  response `{ ticket }`. Upgrade gate: `consumeTicket(redis, ticket)` using
  **GETDEL** (single-use; the same atomicity as
  `auth-service/src/routes/step-up.ts:226`).
- Create: `apps/sync-service/src/doorbell/hub.ts` — per-account socket
  registry (cap `MAX_SOCKETS_PER_ACCOUNT`), one duplicated ioredis subscriber,
  `SUBSCRIBE sync:<account>` on first socket / `UNSUBSCRIBE` on last close,
  forward the poke payload verbatim, `ws.ping()` every `WS_PING_INTERVAL_S`
  (or the Probe-B fallback frame), close each socket at its `tokenExp`.
- Modify: `apps/sync-service/src/index.ts` — the Probe-A `fetch(req, server)`
  wrapper: doorbell path → ticket check → `server.upgrade(req, { data:
  { accountId, tokenExp } })`; everything else → Hono. `websocket:` handlers
  delegate to the hub; `idleTimeout` from env.
- Test: `apps/sync-service/tests/doorbell.test.ts` — run a real `Bun.serve` on
  an ephemeral port (the Probe-A pattern makes this hermetic-ish; needs test
  Redis).

- [ ] **Step 1: Failing tests:** ticket mint requires auth; a revoked token
  cannot mint; connect with a valid ticket → open; **same ticket twice →
  second refused**; expired ticket (TTL 1 s in test) → refused; poke on
  account A's channel reaches A's socket with exactly `{rev, epoch}` and
  **never** account B's; socket cap: the 9th concurrent socket for one
  account is refused; a socket whose `tokenExp` is 2 s away closes itself
  within ~3 s; ping frames observed at the configured interval (drop the
  interval to 100 ms in test).
- [ ] **Step 2–4:** implement, PASS, typecheck.
- [ ] **Step 5: Commit** `Add the doorbell WebSocket with single-use tickets and Redis pub/sub`

---

## Task 14: CORS, error handler, ops split, metrics, anonymity invariants

**Files:**
- Create: `apps/sync-service/src/cors.ts`, `src/error.ts`, `src/ops.ts` —
  adapt the proxy-service equivalents (exact-origin match + `Vary: Origin`,
  generic `onError` with no request-context interpolation, ops Hono app).
  Note the deviation from the proxy: sync CORS is **conventional** (only
  `/api/v1/sync/*` routes, only the configured origins, no wildcard
  reflection of request headers beyond `Authorization, Content-Type`).
- Modify: `src/server.ts` (public app: CORS + routes), `src/index.ts` (second
  `Bun.serve` on `OPS_PORT`), `src/metrics.ts` (the §10.2 set), `src/routes/health.ts` (readyz checks Postgres + Redis).
- Test: `apps/sync-service/tests/ops.test.ts`, `tests/anonymity.test.ts`

- [ ] **Step 1: Failing tests:**
  - `/metrics` + `/healthz` + `/readyz` served on the ops app; the public app
    returns `404` for them; `readyz` degrades to `503` when Postgres or Redis
    is unreachable.
  - CORS: allowed origin reflected + `Vary: Origin`, no
    `Access-Control-Allow-Credentials`; `evil.com` and `Origin: null` get no
    CORS headers.
  - **Anonymity invariant:** after driving one full push + pull + 401 + 429
    through the route with a captured pino stream and scraping `/metrics`:
    no log line and no metric output contains the test's `accountId`, `jti`,
    or any `blindId` base64url; the string `collection="` does not occur in
    the metrics output.
- [ ] **Step 2–4:** implement, PASS, typecheck.
- [ ] **Step 5: Commit** `Wire sync-service CORS, ops split, metrics, and anonymity invariants`

---

## Task 15: auth-service deny-list writes

**Files:**
- Create: `apps/auth-service/src/auth/deny-list.ts`
- Modify: `apps/auth-service/src/routes/auth.ts` (logout: after
  `revokeFamily`/`revokeAllForUser` succeed — current-session `jti` deny on
  single logout; `sub` deny on `revoke_all`),
  `apps/auth-service/src/routes/admin/users.ts` (suspend: `sub` deny),
  `apps/auth-service/src/routes/me.ts` (account deletion: `sub` deny).
- Test: `apps/auth-service/tests/deny-list.test.ts`

**Interfaces:**
- Produces: `denyJti(redis, jti): Promise<void>` (`SET revoked:jti:<jti> 1 EX 900`),
  `denySub(redis, sub, nowSeconds): Promise<void>` (`SET revoked:sub:<sub> <nowSeconds> EX 900`).
  900 = `ACCESS_TTL` seconds — import/derive from the existing constant in
  `src/jwt/issue.ts`, do not re-hardcode if it is exported; if it is not
  exported, export it there.

- [ ] **Step 1: Failing tests:** logout (single) writes the `jti` key with
  TTL ≤ 900; logout `revoke_all=true` writes the `sub` key holding a current
  unix-seconds value; suspend writes the `sub` key; account deletion writes
  the `sub` key; key names match the shared-types builders exactly (import
  them in the test).
- [ ] **Step 2: Run** — FAIL. **Baseline first:** run the full auth suite on
  your base and record the pre-existing failure count (operating rule 9).
- [ ] **Step 3: Implement** — thin helpers + one call site per flow, after
  the existing revocation logic, before the audit write. Add
  `@chatsundere/shared-types` to auth-service deps if not present.
- [ ] **Step 4: Run** the full auth suite — new tests PASS, pre-existing
  failure count unchanged. Typecheck.
- [ ] **Step 5: Commit** `Write token deny-list entries on logout, suspension, and account deletion`

---

## Task 16: `GET /api/v1/config` — `syncUrl` + `"sync"` feature

**Files:**
- Modify: `apps/auth-service/src/env.ts` (add optional `SYNC_PUBLIC_URL`,
  validated absolute `https` URL — mirror the `PROXY_PUBLIC_URL` validation
  the proxy task added; **also make `PROXY_PUBLIC_URL` optional if the proxy
  implementation made it required** — spec §11 mirror requirement `[P]`),
  `apps/auth-service/src/routes/config.ts`, `.env.example`.
- Test: extend the existing config route test file.

- [ ] **Step 1: Failing tests:** with `SYNC_PUBLIC_URL` set → response
  contains `syncUrl` and `"sync"` in `features` (alongside the proxy fields);
  unset → neither key present; malformed (`http://`, relative) → env-load
  throws. Both-unset topology still serves a valid (possibly feature-empty)
  config.
- [ ] **Step 2–4:** implement, PASS; full auth suite unchanged; typecheck.
- [ ] **Step 5: Commit** `Extend backend discovery with syncUrl and the sync feature flag`

---

## Task 17: seal-cli + end-to-end integration test

**Files:**
- Create: `apps/sync-service/tools/seal-cli.ts`
- Test: `apps/sync-service/tests/e2e.test.ts`

**Interfaces:** a Bun CLI (`bun tools/seal-cli.ts <command>`):
- `mint-mk` → prints a random 32-byte MK as base64url.
- `seal --mk <b64url> --collection <c> --key <id> --row '<json>'` → prints the
  §7.1 wire record JSON (blindId/nonce/ciphertext/ciphertextHash base64url,
  `envelopeVersion`, `baseRev: 0`, `deleted: false`).
- `open --mk <b64url> --collection <c> --blind-id <b64url> --record '<json>'`
  → prints the decrypted row (uses `openRecord` with the row's `id` field as
  the key extractor; `--key-field` overrides).

It imports from `@chatsundere/crypto` — the CLI is also the living proof the
envelope runs under Bun (Probe G's durable form on the Bun side).

- [ ] **Step 1: Failing e2e test** — the spec §15 flow, in-process: start the
  app against the test DB/Redis, mint an MK, seal a `personas` row via the
  CLI's exported functions, push as device 1 (JWT A), pull as device 2 (JWT B,
  same `sub`), open the pulled blob → row equals input; then delete from
  device 2 and confirm device 1's edit push returns `tombstoned`.
- [ ] **Step 2–4:** implement, PASS, typecheck.
- [ ] **Step 5: Commit** `Add the seal CLI and the end-to-end sync round-trip test`

---

## Task 18: Full verification gate

- [ ] Run, record, and report every number against the rule-9 baseline:
  1. `cd apps/sync-service && bun test` (full suite)
  2. `pnpm --filter @chatsundere/crypto test` (full vitest)
  3. `cd apps/auth-service && bun test` (full; pre-existing failures unchanged)
  4. `pnpm typecheck` (all 14 projects)
  5. `pnpm build`
- [ ] Confirm no file under `obsidian/` or `superpowers/` was modified except
  this plan's checkboxes (if you tick them) — no scratch pollution.
- [ ] Write the hand-off report (operating rule 13). **Do not push. Do not merge. Do not squash.**

---

## Manual verification (Chris, at integration — from spec §18)

Not part of the overnight run; listed so the plan is complete: compose up →
two-device push/pull round-trip via `seal-cli` → tombstone race → doorbell
poke + 14-minute quiet-socket Traefik test → logout revocation → quota +
delete-rate errors → `/api/v1/config` → `/metrics` anonymity → `psql` shows
only ciphertext and blind tokens.
