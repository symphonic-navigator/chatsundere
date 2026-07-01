# Authenticated CORS Proxy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the `apps/proxy-service` Phase-0 skeleton into a token-authenticated, SSRF-hardened, transparent CORS forward proxy for LLM + MCP traffic, and add a public `GET /api/v1/config` discovery endpoint to `apps/auth-service`.

**Architecture:** A stateless Hono-on-Bun service on **two ports** — a public forward proxy (`PORT`, no reserved paths) and an internal ops server (`OPS_PORT`, health + metrics). Each request: derive client IP from the trusted hop → per-IP rate limit (pre-auth) → verify the account JWT against the auth-service JWKS → per-user rate limit → validate + resolve the target with a private-range block → forward method-agnostically to the pre-checked IP with `redirect: 'manual'`, streaming the response. Observability is anonymous (no user labels, no request logging).

**Tech Stack:** TypeScript (strict), Bun runtime + test runner, Hono, `jose` (JWKS), `prom-client`, `valibot`, `ioredis` or Bun's Redis client, `pino`.

**Design spec:** `superpowers/specs/2026-07-01-authenticated-cors-proxy-design.md` (read it first; `[L]` = Larissa finding, `[F]` = Fable finding).

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

2. **Branch.** Do all work on **`feat/backend-01-cors-proxy`** (create it from
   `master`). **Never switch the branch of the main working tree**; if you use
   worktrees, keep the main tree on `master`.

3. **TDD per task, no exceptions.** For every task: write the failing test →
   run it and confirm it **fails for the stated reason** → write the minimal
   implementation → run and confirm it **passes** → commit. Never write
   implementation before its test.

4. **Execution discipline — subagent-driven.** Use
   `superpowers:subagent-driven-development`: one fresh subagent per task, with a
   two-stage review (spec-conformance + code-quality) between tasks. **Subagents
   never merge, push, or switch branches** — say so in every subagent prompt.

5. **Commit granularity.** Commit per task (the plan's TDD steps). **Do NOT
   squash** — leave the branch as its per-task commits; the human squashes at
   integration. Commit message style: imperative, capitalised subject, no
   Conventional-Commits prefix. **These are code commits — no `[skip ci]`.**

6. **Co-author tag** on every commit, exactly:
   `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`

7. **Exact commands** (monorepo uses pnpm + Turbo + Bun's test runner):
   - Proxy tests (mostly hermetic): `cd apps/proxy-service && bun test`
   - Proxy typecheck: `pnpm --filter @chatsundere/proxy-service typecheck`
   - Auth tests: `cd apps/auth-service && bun test` — **needs a Postgres test DB
     via `TEST_DATABASE_URL`** (+ Redis). See the auth-service `env.ts` and
     `tests/integration/full-lifecycle.test.ts` for the setup.
   - Auth typecheck: `pnpm --filter @chatsundere/auth-service typecheck`
   - Repo-wide gate: `pnpm typecheck` (= `turbo run typecheck`) **and**
     `pnpm build` (= `turbo run build`). **Run both** — they diverge subtly, and
     `pnpm build` is the real build-verification gate, not `tsc` alone.

8. **Known-green baseline — confirm on `master` before you start.**
   - `apps/proxy-service`: **3 pass / 0 fail** (the health tests; verified
     2026-07-01). Task 13 legitimately replaces the public-port `/metrics`
     health test — that is expected, not a regression.
   - `apps/auth-service`: there are **known pre-existing failures in
     `tests/integration/full-lifecycle.test.ts`** (≈9 at the last integration).
     Run the auth suite on `master` first and **record the exact number**; your
     job is to **not increase it**. Do not chase these pre-existing failures and
     do not paper over a new one.

9. **Full verification at the end — not just the dirs you touched.** Per-task-dir
   runs have missed regressions in this repo. The final task runs the **full**
   proxy + auth suites, `pnpm typecheck`, and `pnpm build`, and reports every
   number against the baseline.

10. **Security gate — this IS a Larissa path** (`apps/proxy-service/**` +
    `apps/auth-service/**`). **You do NOT run the security audit** — that is done
    by Liz on the built diff after your run, before merge. Your obligation:
    treat the security-critical tests as **non-negotiable** — the account-token
    header invariant (Task 8), the SSRF `test.each` cases (Task 2), the
    metric-anonymity + no-URL-in-logs invariant (Tasks 9/11), the pinned-IP
    mechanism (Tasks 4/12). **If a security test fails, fix the code, never the
    test.**

11. **If the remote environment has no Postgres/Redis test DB:** the proxy suite
    is still fully runnable (its tests use a fake Redis, injected JWKS keys, and
    only the `target.ts` DNS tests need network). For **Task 14** (auth-service),
    if you cannot run the full auth suite, still run `pnpm --filter
    @chatsundere/auth-service typecheck` + `pnpm build` + the hermetic config
    test, and **state clearly in your report** that the full auth suite was not
    run so Liz verifies it at integration.

12. **Do NOT touch the STATUS files** (`obsidian/STATUS-*.md`). Session-lifecycle
    updates happen at integration, done by Liz — not by you.

13. **Hand-off — do NOT push and do NOT merge.** Stop at the final task. Report
    back: (a) every suite + typecheck + build number with the baseline noted,
    (b) the list of commits on `feat/backend-01-cors-proxy`, (c) anything you
    could not verify (e.g. the auth suite per rule 11). The human device-tests
    and integrates.

---

## Global Constraints

- **British English** in all code, comments, log strings, commit messages (CLAUDE.md §3.7).
- **TypeScript strict**, `noUncheckedIndexedAccess: true`, no `any` without an inline justification comment (§10).
- **Zero request logging.** Never log request/response bodies, headers, target, or user — including the error path. Operational logs only.
- **The account token (`x-chatsundere-authorization`) must never appear in a forwarded upstream request.** This is an invariant, test-enforced.
- **No user identity (`sub`/`jti`) on any Prometheus metric, ever.**
- Every package-public function carries a one-line JSDoc (§10).
- Bun test runner (`bun test`); run `pnpm --filter @chatsundere/proxy-service typecheck` before each commit.
- SPDX header on every new file: `// SPDX-License-Identifier: AGPL-3.0-only` (proxy) / the auth-service's existing header for its file.
- Commit style: imperative, capitalised subject, `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`. These are code commits — **no `[skip ci]`**.

---

## File structure

**`apps/proxy-service/src/`:**
- `env.ts` — MODIFY: proxy-specific env schema (drop `DATABASE_URL`, fix `JWT_ISSUER`, add the rest).
- `egress/blocked-ranges.ts` — CREATE: `isBlockedIp(ip)` — the private/blocked IP predicate.
- `egress/known-hosts.ts` — CREATE: `normaliseLlmHost(host)` — exact-match to a known set or `'other'`.
- `egress/target.ts` — CREATE: `parseTarget()` (shape validation) + `resolveAndPin()` (resolve all, check each, return one allowed IP) + `pinnedFetch()`.
- `net/client-ip.ts` — CREATE: `deriveClientIp()` from the trusted hop.
- `auth/verify-token.ts` — CREATE: `createTokenVerifier(env)` → `verifyToken(token)`.
- `ratelimit/limiter.ts` — CREATE: `createLimiter(redis)` → `checkLimit(key, limit, windowSec)`, fail-closed.
- `proxy/headers.ts` — CREATE: `buildForwardHeaders()` + `filterResponseHeaders()`.
- `metrics.ts` — MODIFY: add the anonymous counters.
- `cors.ts` — CREATE: `applyPreflight()` + `applyCorsHeaders()`.
- `error.ts` — CREATE: `onProxyError()` — generic, no request context.
- `routes/proxy.ts` — CREATE: the method-agnostic forward handler.
- `routes/health.ts` — MODIFY: no change to handlers; they move to the ops server (Task 12).
- `ops.ts` — CREATE: the internal ops Hono app (health + metrics).
- `server.ts` — MODIFY: public app = proxy only.
- `index.ts` — MODIFY: start both Bun servers.

**`apps/auth-service/src/`:**
- `env.ts` — MODIFY: add `PROXY_PUBLIC_URL` (validated absolute https URL).
- `routes/config.ts` — CREATE: `GET /api/v1/config`.
- `server.ts` — MODIFY: mount the config route + ensure its CORS.

**Redis client:** the auth-service already depends on a Redis client; match its choice. Below assumes an `ioredis`-compatible client exposing `incr`, `expire`. Confirm the exact import from `apps/auth-service/src/redis/client.ts` and mirror it.

---

## Task 1: Proxy env schema

**Files:**
- Modify: `apps/proxy-service/src/env.ts`
- Modify: `apps/proxy-service/.env.example`
- Test: `apps/proxy-service/tests/env.test.ts`

**Interfaces:**
- Produces: `loadEnv(source?): Env` with fields `NODE_ENV, PORT, OPS_PORT, LOG_LEVEL, REDIS_URL, JWT_ISSUER, JWT_AUDIENCE, AUTH_JWKS_URL, CORS_ALLOWED_ORIGINS (string[]), TRUST_PROXY_HOPS (number), RATE_LIMIT_USER_PER_MIN (number), RATE_LIMIT_IP_PER_MIN (number), MAX_BODY_BYTES (number), MAX_CONCURRENT_PER_USER (number), PROXY_IDLE_TIMEOUT_S (number)`.

- [ ] **Step 1: Write the failing test** (`tests/env.test.ts`)

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { loadEnv } from '../src/env.js';

const base = {
  REDIS_URL: 'redis://localhost:6379',
  AUTH_JWKS_URL: 'https://auth.example/api/v1/jwks',
};

describe('proxy env', () => {
  test('JWT_ISSUER defaults to chatsundere-auth-v1', () => {
    expect(loadEnv(base).JWT_ISSUER).toBe('chatsundere-auth-v1');
  });
  test('CORS_ALLOWED_ORIGINS parses a comma list into an array', () => {
    const env = loadEnv({ ...base, CORS_ALLOWED_ORIGINS: 'https://a.me, https://b.me' });
    expect(env.CORS_ALLOWED_ORIGINS).toEqual(['https://a.me', 'https://b.me']);
  });
  test('numeric envs coerce and default', () => {
    const env = loadEnv(base);
    expect(env.RATE_LIMIT_USER_PER_MIN).toBe(120);
    expect(env.RATE_LIMIT_IP_PER_MIN).toBe(600);
    expect(env.MAX_BODY_BYTES).toBe(52428800);
    expect(env.TRUST_PROXY_HOPS).toBe(1);
  });
  test('no DATABASE_URL is required', () => {
    expect(() => loadEnv(base)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run** `cd apps/proxy-service && bun test tests/env.test.ts` — expect FAIL (defaults wrong / DATABASE_URL required).

- [ ] **Step 3: Rewrite `src/env.ts`**

```ts
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
      v.transform((s) => s.split(',').map((o) => o.trim().toLowerCase()).filter(Boolean)),
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
```

- [ ] **Step 4: Update `.env.example`** to list every variable above with realistic placeholders and a one-line comment each (mirror the wording in spec §10).

- [ ] **Step 5: Run** `bun test tests/env.test.ts` — expect PASS. Then `pnpm --filter @chatsundere/proxy-service typecheck`.

- [ ] **Step 6: Commit** `git commit -m "Rework proxy-service env schema for the authenticated proxy"`

---

## Task 2: Blocked IP ranges (SSRF predicate)

**Files:**
- Create: `apps/proxy-service/src/egress/blocked-ranges.ts`
- Test: `apps/proxy-service/tests/blocked-ranges.test.ts`

**Interfaces:**
- Produces: `isBlockedIp(ip: string): boolean` — accepts an IPv4 or IPv6 numeric address string; returns true if it is in any private/blocked range (spec §5.1), including IPv4-embedding IPv6 forms (v4-mapped, v4-compat, NAT64 `64:ff9b::/96`, 6to4 `2002::/16`).

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { isBlockedIp } from '../src/egress/blocked-ranges.js';

describe('isBlockedIp', () => {
  test.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254',
    '0.0.0.0', '100.64.0.1', '192.0.0.1', '198.18.0.1', '224.0.0.1',
    '240.0.0.1', '255.255.255.255',
  ])('blocks IPv4 %s', (ip) => expect(isBlockedIp(ip)).toBe(true));

  test.each([
    '::1', 'fc00::1', 'fe80::1', 'fec0::1', 'ff02::1', '::',
    '::ffff:127.0.0.1', '::7f00:1', '64:ff9b::7f00:1', '2002:7f00:0001::',
  ])('blocks IPv6 %s', (ip) => expect(isBlockedIp(ip)).toBe(true));

  test.each(['1.1.1.1', '104.20.23.154', '2606:4700::1'])(
    'allows public %s',
    (ip) => expect(isBlockedIp(ip)).toBe(false),
  );
});
```

- [ ] **Step 2: Run** `bun test tests/blocked-ranges.test.ts` — expect FAIL (module missing).

- [ ] **Step 3: Implement `src/egress/blocked-ranges.ts`**

```ts
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * True if the resolved numeric IP is in any private, reserved, or internal
 * range (spec §5.1). Runs on the address returned by DNS resolution, so
 * alternate textual encodings normalise before they reach here.
 */
export function isBlockedIp(ip: string): boolean {
  const v4 = toIPv4(ip);
  if (v4 !== null) return isBlockedV4(v4);
  return isBlockedV6(ip);
}

/** Returns the dotted-quad IPv4 string if `ip` is IPv4 or an IPv4-embedding IPv6 form, else null. */
function toIPv4(ip: string): string | null {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip;

  const lower = ip.toLowerCase();
  // v4-mapped / v4-compat: ...:a.b.c.d or ...:<hex>:<hex> tail
  const embedded = extractEmbeddedV4(lower);
  if (embedded) return embedded;
  return null;
}

/** Extracts an embedded IPv4 from v4-mapped, v4-compat, NAT64 (64:ff9b::/96), or 6to4 (2002::/16). */
function extractEmbeddedV4(ip: string): string | null {
  // 6to4: 2002:AABB:CCDD::/48 embeds A.B.C.D in bits 16..48
  if (ip.startsWith('2002:')) {
    const groups = expandV6(ip);
    if (!groups) return null;
    const hi = groups[1];
    const lo = groups[2];
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  }
  // NAT64 64:ff9b::/96 and v4-mapped/v4-compat: last 32 bits are the IPv4.
  if (ip.startsWith('64:ff9b:') || ip.startsWith('::ffff:') || ip.startsWith('::')) {
    // dotted tail form, e.g. ::ffff:127.0.0.1
    const dotted = ip.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (dotted) return dotted[1] as string;
    const groups = expandV6(ip);
    if (!groups) return null;
    const hi = groups[6];
    const lo = groups[7];
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  }
  return null;
}

/** Expands an IPv6 string to its 8 16-bit groups; returns null if unparseable. */
function expandV6(ip: string): number[] | null {
  const cleaned = ip.replace(/(\d{1,3}(?:\.\d{1,3}){3})$/, (m) => {
    const p = m.split('.').map(Number);
    return `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  });
  const halves = cleaned.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (groups.length !== 8) return null;
  return groups.map((g) => parseInt(g || '0', 16));
}

function isBlockedV4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return true; // malformed → block
  const n = ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
  const inRange = (base: string, bits: number) => {
    const bp = base.split('.').map(Number);
    const bn = ((bp[0] << 24) >>> 0) + (bp[1] << 16) + (bp[2] << 8) + bp[3];
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) === (bn & mask);
  };
  return (
    inRange('0.0.0.0', 8) || inRange('10.0.0.0', 8) || inRange('127.0.0.0', 8) ||
    inRange('169.254.0.0', 16) || inRange('172.16.0.0', 12) || inRange('192.168.0.0', 16) ||
    inRange('100.64.0.0', 10) || inRange('192.0.0.0', 24) || inRange('198.18.0.0', 15) ||
    inRange('224.0.0.0', 4) || inRange('240.0.0.0', 4) || n === 0xffffffff
  );
}

function isBlockedV6(ip: string): boolean {
  const g = expandV6(ip.toLowerCase());
  if (!g) return true; // unparseable → block
  const first = g[0];
  if (g.every((x) => x === 0)) return true;                    // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if ((first & 0xfe00) === 0xfc00) return true;                // fc00::/7 ULA
  if ((first & 0xffc0) === 0xfe80) return true;                // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfec0) return true;                // fec0::/10 site-local
  if ((first & 0xff00) === 0xff00) return true;                // ff00::/8 multicast
  return false;
}
```

- [ ] **Step 4: Run** `bun test tests/blocked-ranges.test.ts` — expect PASS. `pnpm --filter @chatsundere/proxy-service typecheck`.

> NOTE for the implementer: if any `test.each` case fails, fix the range logic — do **not** delete the case. Each address is a real bypass class from the security review.

- [ ] **Step 5: Commit** `git commit -m "Add SSRF private-range block predicate"`

---

## Task 3: Known-host metric normalisation

**Files:**
- Create: `apps/proxy-service/src/egress/known-hosts.ts`
- Test: `apps/proxy-service/tests/known-hosts.test.ts`

**Interfaces:**
- Produces: `normaliseLlmHost(host: string): string` — lowercased exact-match against the known LLM provider host set → the host, else `'other'`.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { normaliseLlmHost } from '../src/egress/known-hosts.js';

describe('normaliseLlmHost', () => {
  test('known host returns itself', () => expect(normaliseLlmHost('api.x.ai')).toBe('api.x.ai'));
  test('case-insensitive', () => expect(normaliseLlmHost('API.X.AI')).toBe('api.x.ai'));
  test('unknown host collapses to other', () => expect(normaliseLlmHost('evil.example')).toBe('other'));
  test('suffix attack collapses to other', () =>
    expect(normaliseLlmHost('api.x.ai.evil.com')).toBe('other'));
});
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement `src/egress/known-hosts.ts`.** Seed the set from the hosts `packages/llm-unified` proxies today (grep its provider base URLs — e.g. `api.x.ai`, `nano-gpt.com`, `ollama.com`, `quotewise.io`; confirm the current list before writing). Exact-match only.

```ts
// SPDX-License-Identifier: AGPL-3.0-only

/** Known LLM provider hosts. Used ONLY to bound the Prometheus label cardinality. */
const KNOWN_LLM_HOSTS = new Set<string>([
  'api.x.ai',
  'nano-gpt.com',
  'ollama.com',
  'quotewise.io',
  // Extend from packages/llm-unified provider base URLs; exact host only.
]);

/** Exact-match (lowercased) a host to the known set, else 'other'. Never a suffix match. */
export function normaliseLlmHost(host: string): string {
  const h = host.toLowerCase();
  return KNOWN_LLM_HOSTS.has(h) ? h : 'other';
}
```

- [ ] **Step 4: Run** — expect PASS. Typecheck.
- [ ] **Step 5: Commit** `git commit -m "Add known-host metric normalisation"`

---

## Task 4: Target parsing + resolve-and-pin

**Files:**
- Create: `apps/proxy-service/src/egress/target.ts`
- Test: `apps/proxy-service/tests/target.test.ts`

**Interfaces:**
- Consumes: `isBlockedIp` (Task 2).
- Produces:
  - `parseTarget(raw: string): { origin: string; host: string; protocol: 'https:' | 'http:' }` — throws `TargetError` (with a `.status` of 400) on a bad shape (spec §5.6: absolute URL, scheme https/http, no userinfo, no path/query).
  - `resolveAndPin(host: string): Promise<string>` — resolves all A/AAAA records, throws `TargetError` (status 403) if **any** is blocked, else returns one allowed IP.
  - `class TargetError extends Error { status: 400 | 403 }`.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { parseTarget, resolveAndPin, TargetError } from '../src/egress/target.js';

describe('parseTarget', () => {
  test('accepts a clean https origin', () => {
    expect(parseTarget('https://api.x.ai')).toEqual({
      origin: 'https://api.x.ai', host: 'api.x.ai', protocol: 'https:',
    });
  });
  test('accepts http (self-hosted MCP)', () => {
    expect(parseTarget('http://mcp.local.example').protocol).toBe('http:');
  });
  test.each([
    'ftp://api.x.ai',                 // bad scheme
    'https://user:pass@api.x.ai',     // userinfo
    'https://api.x.ai/v1/chat',       // path in target
    'https://api.x.ai?x=1',           // query in target
    'not-a-url',
  ])('rejects %s with 400', (raw) => {
    try { parseTarget(raw); throw new Error('should have thrown'); }
    catch (e) { expect((e as TargetError).status).toBe(400); }
  });
});

describe('resolveAndPin', () => {
  test('a host that resolves only to a public IP returns an IP', async () => {
    const ip = await resolveAndPin('example.com');
    expect(ip).toMatch(/\d+\.\d+\.\d+\.\d+|:/);
  });
  test('localhost is blocked with 403', async () => {
    try { await resolveAndPin('localhost'); throw new Error('should have thrown'); }
    catch (e) { expect((e as TargetError).status).toBe(403); }
  });
});
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement `src/egress/target.ts`**

```ts
// SPDX-License-Identifier: AGPL-3.0-only

import { lookup } from 'node:dns/promises';
import { isBlockedIp } from './blocked-ranges.js';

/** A rejected target; `status` maps directly to the HTTP response code. */
export class TargetError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403,
  ) {
    super(message);
  }
}

/** Validates the `x-cors-proxy-target` shape (spec §5.6): absolute https/http origin, no userinfo, no path/query. */
export function parseTarget(raw: string): { origin: string; host: string; protocol: 'https:' | 'http:' } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TargetError('Malformed target URL', 400);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new TargetError('Target scheme must be https or http', 400);
  }
  if (url.username || url.password) throw new TargetError('Target must not contain userinfo', 400);
  if ((url.pathname && url.pathname !== '/') || url.search) {
    throw new TargetError('Target must be an origin, without path or query', 400);
  }
  return { origin: url.origin, host: url.hostname, protocol: url.protocol };
}

/**
 * Resolves every A/AAAA record for `host`, blocks if ANY is a private/internal
 * range, and returns one allowed IP to pin the connection to (DNS-rebinding
 * defence — the checked IP is the connected IP).
 */
export async function resolveAndPin(host: string): Promise<string> {
  let records: { address: string }[];
  try {
    records = await lookup(host, { all: true });
  } catch {
    throw new TargetError('Target host does not resolve', 403);
  }
  if (records.length === 0) throw new TargetError('Target host does not resolve', 403);
  for (const r of records) {
    if (isBlockedIp(r.address)) throw new TargetError('Target resolves to a blocked range', 403);
  }
  return (records[0] as { address: string }).address;
}
```

- [ ] **Step 4: Run** — expect PASS (needs network for `example.com`; acceptable — these tests are not run in CI, they validate real DNS behaviour). Typecheck.
- [ ] **Step 5: Commit** `git commit -m "Add target validation and resolve-then-pin SSRF guard"`

---

## Task 5: Client-IP derivation

**Files:**
- Create: `apps/proxy-service/src/net/client-ip.ts`
- Test: `apps/proxy-service/tests/client-ip.test.ts`

**Interfaces:**
- Produces: `deriveClientIp(xForwardedFor: string | null, directIp: string, trustHops: number): string` — takes the entry `trustHops` positions from the right of `X-Forwarded-For` (the address the trusted front proxy observed); falls back to `directIp` when XFF is absent or `trustHops` is 0.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { deriveClientIp } from '../src/net/client-ip.js';

describe('deriveClientIp', () => {
  test('one trusted hop takes the right-most XFF entry', () => {
    // attacker spoofs the left; Traefik appended the real IP on the right
    expect(deriveClientIp('9.9.9.9, 8.8.8.8, 203.0.113.7', '10.0.0.1', 1)).toBe('203.0.113.7');
  });
  test('a spoofed value further left cannot change the key', () => {
    expect(deriveClientIp('evil, evil, 203.0.113.7', '10.0.0.1', 1)).toBe('203.0.113.7');
  });
  test('no XFF falls back to the direct socket IP', () => {
    expect(deriveClientIp(null, '203.0.113.9', 1)).toBe('203.0.113.9');
  });
  test('trustHops 0 always uses the direct IP', () => {
    expect(deriveClientIp('1.2.3.4', '203.0.113.9', 0)).toBe('203.0.113.9');
  });
});
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement `src/net/client-ip.ts`**

```ts
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Derives the trusted client IP for rate limiting. Never trusts a
 * client-settable value: it reads the entry `trustHops` positions from the
 * right of X-Forwarded-For — the address the trusted front proxy (Traefik)
 * actually observed — and falls back to the direct socket IP.
 */
export function deriveClientIp(
  xForwardedFor: string | null,
  directIp: string,
  trustHops: number,
): string {
  if (trustHops <= 0 || !xForwardedFor) return directIp;
  const parts = xForwardedFor.split(',').map((s) => s.trim()).filter(Boolean);
  const idx = parts.length - trustHops;
  return idx >= 0 ? (parts[idx] as string) : directIp;
}
```

- [ ] **Step 4: Run** — expect PASS. Typecheck.
- [ ] **Step 5: Commit** `git commit -m "Add trusted-hop client-IP derivation"`

---

## Task 6: Token verification (JWKS resource server)

**Files:**
- Create: `apps/proxy-service/src/auth/verify-token.ts`
- Test: `apps/proxy-service/tests/verify-token.test.ts`

**Interfaces:**
- Consumes: `Env` (Task 1).
- Produces: `createTokenVerifier(env: Env): (token: string) => Promise<{ sub: string }>` — verifies EdDSA signature via a remote JWKS, enforcing `issuer` + `exp` + 5 s clock tolerance, ignoring `aud`. Throws on any failure.

- [ ] **Step 1: Write the failing test** (self-signs against a local JWKS served by `createLocalJWKSet` to avoid network)

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { createTokenVerifier } from '../src/auth/verify-token.js';
import type { Env } from '../src/env.js';

async function fixture() {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'EdDSA', use: 'sig' };
  const env = { JWT_ISSUER: 'chatsundere-auth-v1', AUTH_JWKS_URL: 'https://unused' } as unknown as Env;
  // Verifier accepts an injected key set for testing (see impl note).
  const verify = createTokenVerifier(env, async () => ({ keys: [jwk] }));
  const sign = (claims: Record<string, unknown>, exp = '5m') =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'EdDSA', kid: 'test' })
      .setIssuer('chatsundere-auth-v1')
      .setIssuedAt()
      .setExpirationTime(exp)
      .sign(privateKey);
  return { verify, sign };
}

describe('verifyToken', () => {
  test('valid token yields sub', async () => {
    const { verify, sign } = await fixture();
    const t = await sign({ sub: 'user-1', role: 'user' });
    expect((await verify(t)).sub).toBe('user-1');
  });
  test('wrong issuer rejected', async () => {
    const { verify } = await fixture();
    const bad = await new SignJWT({ sub: 'x' })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'test' })
      .setIssuer('someone-else').setIssuedAt().setExpirationTime('5m')
      .sign((await generateKeyPair('EdDSA')).privateKey);
    await expect(verify(bad)).rejects.toThrow();
  });
  test('expired token rejected', async () => {
    const { verify, sign } = await fixture();
    const t = await sign({ sub: 'x' }, '-1m');
    await expect(verify(t)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement `src/auth/verify-token.ts`** (supports an injected key set for tests; defaults to the pinned remote JWKS in production)

```ts
// SPDX-License-Identifier: AGPL-3.0-only

import { type JSONWebKeySet, createLocalJWKSet, createRemoteJWKSet, jwtVerify } from 'jose';
import type { Env } from '../env.js';

/**
 * Builds a token verifier. Verifies EdDSA against the auth-service JWKS,
 * enforcing issuer + exp (5 s clock tolerance) and IGNORING aud (variant a).
 * `keySetLoader` is injectable for tests; production uses the pinned remote set.
 */
export function createTokenVerifier(
  env: Env,
  keySetLoader?: () => Promise<JSONWebKeySet>,
): (token: string) => Promise<{ sub: string }> {
  // Pinned fetch options so a bogus-kid flood can't hammer the auth JWKS and a
  // hung fetch can't stall the proxy (spec §4).
  const jwks = keySetLoader
    ? undefined
    : createRemoteJWKSet(new URL(env.AUTH_JWKS_URL), {
        timeoutDuration: 5000,
        cooldownDuration: 30000,
        cacheMaxAge: 600000,
      });

  return async (token: string) => {
    const keySet = jwks ?? createLocalJWKSet(await (keySetLoader as () => Promise<JSONWebKeySet>)());
    const { payload } = await jwtVerify(token, keySet, {
      issuer: env.JWT_ISSUER,
      algorithms: ['EdDSA'],
      clockTolerance: 5,
    });
    if (typeof payload.sub !== 'string') throw new Error('Token missing sub');
    return { sub: payload.sub };
  };
}
```

- [ ] **Step 4: Run** — expect PASS. Typecheck.
- [ ] **Step 5: Commit** `git commit -m "Add JWKS resource-server token verification"`

---

## Task 7: Rate limiter (Redis, fail-closed)

**Files:**
- Create: `apps/proxy-service/src/ratelimit/limiter.ts`
- Test: `apps/proxy-service/tests/limiter.test.ts`

**Interfaces:**
- Produces: `createLimiter(redis: RedisLike): (key: string, limit: number, windowSec: number) => Promise<boolean>` — returns `true` if allowed. A fixed-window counter per bucket (approximates the sliding window; sufficient for v1). **Fail-closed:** any Redis error returns `false`. `RedisLike = { incr(k): Promise<number>; expire(k, s): Promise<unknown> }`.

- [ ] **Step 1: Write the failing test** (fake Redis)

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { createLimiter } from '../src/ratelimit/limiter.js';

function fakeRedis() {
  const store = new Map<string, number>();
  return {
    incr: async (k: string) => { const n = (store.get(k) ?? 0) + 1; store.set(k, n); return n; },
    expire: async () => 1,
  };
}

describe('limiter', () => {
  test('allows up to the limit then blocks', async () => {
    const allow = createLimiter(fakeRedis());
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) results.push(await allow('k', 3, 60));
    expect(results).toEqual([true, true, true, false]);
  });
  test('fails closed on Redis error', async () => {
    const broken = { incr: async () => { throw new Error('down'); }, expire: async () => 1 };
    expect(await createLimiter(broken)('k', 100, 60)).toBe(false);
  });
});
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement `src/ratelimit/limiter.ts`**

```ts
// SPDX-License-Identifier: AGPL-3.0-only

interface RedisLike {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

/**
 * Fixed-window rate limiter over Redis. Returns true when the call is allowed.
 * Fails CLOSED: any Redis error denies the request rather than becoming an
 * unlimited authenticated relay (spec §5.4).
 */
export function createLimiter(redis: RedisLike) {
  return async (key: string, limit: number, windowSec: number): Promise<boolean> => {
    try {
      const bucket = `ratelimit:${key}`;
      const n = await redis.incr(bucket);
      if (n === 1) await redis.expire(bucket, windowSec);
      return n <= limit;
    } catch {
      return false;
    }
  };
}
```

- [ ] **Step 4: Run** — expect PASS. Typecheck.
- [ ] **Step 5: Commit** `git commit -m "Add fail-closed Redis rate limiter"`

---

## Task 8: Header denylists + Host rewrite

**Files:**
- Create: `apps/proxy-service/src/proxy/headers.ts`
- Test: `apps/proxy-service/tests/headers.test.ts`

**Interfaces:**
- Produces:
  - `buildForwardHeaders(incoming: Headers, targetHost: string): Headers` — copies all headers except the strip-denylist (`x-chatsundere-*`, `x-cors-proxy-*`, hop-by-hop) and rewrites `Host`.
  - `filterResponseHeaders(upstream: Headers): Headers` — drops `Set-Cookie`, upstream `Access-Control-*`, hop-by-hop; keeps everything else including `Location`.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { buildForwardHeaders, filterResponseHeaders } from '../src/proxy/headers.js';

describe('buildForwardHeaders', () => {
  const incoming = new Headers({
    'x-chatsundere-authorization': 'Bearer ACCOUNT',
    'x-cors-proxy-target': 'https://api.x.ai',
    authorization: 'Bearer UPSTREAM',
    'x-api-key': 'K',
    'mcp-session-id': 'S',
    'last-event-id': '42',
    'mcp-protocol-version': '2025-06-18',
    'x-title': 'custom',
    connection: 'keep-alive',
    host: 'proxy.chatsundere.me',
  });
  const out = buildForwardHeaders(incoming, 'api.x.ai');

  test('account token never forwarded', () => expect(out.get('x-chatsundere-authorization')).toBeNull());
  test('proxy target header never forwarded', () => expect(out.get('x-cors-proxy-target')).toBeNull());
  test('hop-by-hop stripped', () => expect(out.get('connection')).toBeNull());
  test('Host rewritten to target', () => expect(out.get('host')).toBe('api.x.ai'));
  test('upstream key forwarded', () => expect(out.get('authorization')).toBe('Bearer UPSTREAM'));
  test.each(['x-api-key', 'mcp-session-id', 'last-event-id', 'mcp-protocol-version', 'x-title'])(
    'forwards %s', (h) => expect(out.get(h)).not.toBeNull(),
  );
});

describe('filterResponseHeaders', () => {
  const up = new Headers({
    'content-type': 'text/event-stream',
    location: 'https://api.x.ai/v2',
    'set-cookie': 'sess=1',
    'access-control-allow-origin': '*',
    connection: 'close',
  });
  const out = filterResponseHeaders(up);
  test('keeps content-type', () => expect(out.get('content-type')).toBe('text/event-stream'));
  test('keeps Location', () => expect(out.get('location')).toBe('https://api.x.ai/v2'));
  test('drops Set-Cookie', () => expect(out.get('set-cookie')).toBeNull());
  test('drops upstream CORS', () => expect(out.get('access-control-allow-origin')).toBeNull());
  test('drops hop-by-hop', () => expect(out.get('connection')).toBeNull());
});
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement `src/proxy/headers.ts`**

```ts
// SPDX-License-Identifier: AGPL-3.0-only

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'upgrade', 'te', 'transfer-encoding',
  'proxy-authorization', 'proxy-connection',
]);

/** True for headers that must never be forwarded upstream (proxy-only + hop-by-hop). */
function isStrippedRequestHeader(key: string): boolean {
  const k = key.toLowerCase();
  return (
    k.startsWith('x-chatsundere-') || k.startsWith('x-cors-proxy-') ||
    HOP_BY_HOP.has(k) || k === 'host'
  );
}

/** Copies every request header except the tested strip-denylist; rewrites Host to the target. */
export function buildForwardHeaders(incoming: Headers, targetHost: string): Headers {
  const out = new Headers();
  incoming.forEach((value, key) => {
    if (!isStrippedRequestHeader(key)) out.set(key, value);
  });
  out.set('host', targetHost);
  return out;
}

/** Copies every response header except Set-Cookie, upstream CORS, and hop-by-hop. */
export function filterResponseHeaders(upstream: Headers): Headers {
  const out = new Headers();
  upstream.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k === 'set-cookie' || k === 'set-cookie2') return;
    if (k.startsWith('access-control-')) return;
    if (HOP_BY_HOP.has(k)) return;
    out.set(key, value);
  });
  return out;
}
```

- [ ] **Step 4: Run** — expect PASS. Typecheck.
- [ ] **Step 5: Commit** `git commit -m "Add transparent header denylists with Host rewrite"`

---

## Task 9: Anonymous metrics

**Files:**
- Modify: `apps/proxy-service/src/metrics.ts`
- Test: `apps/proxy-service/tests/metrics.test.ts`

**Interfaces:**
- Consumes: `normaliseLlmHost` (Task 3).
- Produces: `recordRequest({ kind, outcome }): void`, `recordLlmRequest({ host, outcome }): void` (host pre-normalised), `recordSsrfBlocked(): void`, `recordUnauthorized(): void`, `recordRateLimited(): void`. No metric carries `sub`/`jti`.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { register } from 'prom-client';
import { initialiseMetrics, recordLlmRequest, recordRequest } from '../src/metrics.js';

describe('metrics', () => {
  test('counters exist and carry no user label', async () => {
    initialiseMetrics();
    recordRequest({ kind: 'mcp', outcome: 'ok' });
    recordLlmRequest({ host: 'api.x.ai', outcome: 'ok' });
    const text = await register.metrics();
    expect(text).toContain('proxy_requests_total');
    expect(text).toContain('proxy_llm_requests_total');
    expect(text).not.toContain('sub=');
    expect(text).not.toContain('jti=');
  });
});
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Extend `src/metrics.ts`** — keep `initialiseMetrics`/`renderMetrics`, add `Counter`s with the exact label sets from spec §8.2 (`proxy_requests_total{kind,outcome}`, `proxy_llm_requests_total{host,outcome}`, `proxy_ssrf_blocked_total`, `proxy_unauthorized_total`, `proxy_rate_limited_total`) and the `record*` helpers. **No `sub`/`jti` label.** The LLM host label value must already be normalised by the caller (Task 12). Register counters once (guard like `initialised`).

- [ ] **Step 4: Run** — expect PASS. Typecheck.
- [ ] **Step 5: Commit** `git commit -m "Add anonymous proxy metrics"`

---

## Task 10: CORS

**Files:**
- Create: `apps/proxy-service/src/cors.ts`
- Test: `apps/proxy-service/tests/cors.test.ts`

**Interfaces:**
- Consumes: `Env` (Task 1).
- Produces:
  - `matchOrigin(origin: string | null, allowed: string[]): string | null` — exact lowercased match; `null` origin never matches.
  - `applyCorsHeaders(c, origin: string): void` — sets `Access-Control-Allow-Origin` (specific), `Vary: Origin`, no credentials.
  - `preflightResponse(c, origin: string): Response` — echoes `Access-Control-Request-Headers`, method list, exposes `Mcp-Session-Id`.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { matchOrigin } from '../src/cors.js';

const allowed = ['https://app.chatsundere.me'];
describe('matchOrigin', () => {
  test('exact match', () => expect(matchOrigin('https://app.chatsundere.me', allowed)).toBe('https://app.chatsundere.me'));
  test('suffix attack rejected', () => expect(matchOrigin('https://app.chatsundere.me.evil.com', allowed)).toBeNull());
  test('null origin rejected', () => expect(matchOrigin('null', allowed)).toBeNull());
  test('missing origin rejected', () => expect(matchOrigin(null, allowed)).toBeNull());
});
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement `src/cors.ts`** — `matchOrigin` does `origin && origin !== 'null' && allowed.includes(origin.toLowerCase()) ? origin : null`. `applyCorsHeaders` sets the specific origin, `Vary: Origin`, **no** `Access-Control-Allow-Credentials`. `preflightResponse` sets `Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS`, `Access-Control-Allow-Headers` = the request's `Access-Control-Request-Headers` (fallback `x-chatsundere-authorization, x-cors-proxy-target, authorization, content-type`), `Access-Control-Expose-Headers: Mcp-Session-Id`, `Access-Control-Max-Age: 600`, returns `204`.

- [ ] **Step 4: Run** — expect PASS. Typecheck.
- [ ] **Step 5: Commit** `git commit -m "Add exact-origin CORS with request-header echo"`

---

## Task 11: Generic error handler

**Files:**
- Create: `apps/proxy-service/src/error.ts`
- Test: `apps/proxy-service/tests/error.test.ts`

**Interfaces:**
- Produces: `onProxyError(err: unknown, c): Response` — returns a generic `502`/`500` JSON body; **never** interpolates `err.message` or request context into the response or a log.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { onProxyError } from '../src/error.js';

describe('onProxyError', () => {
  test('never leaks the target URL from a fetch error message', async () => {
    const app = new Hono();
    app.onError(onProxyError);
    app.get('/x', () => { throw new Error('fetch failed https://mcp.secret-host.example/path'); });
    const res = await app.request('/x');
    const body = await res.text();
    expect(res.status).toBe(502);
    expect(body).not.toContain('secret-host');
    expect(body).not.toContain('/path');
  });
});
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement `src/error.ts`** — return `c.json({ error: { code: 'upstream_error', message: 'Upstream request failed' } }, 502)`. If it logs at all, log a static string with no `err` interpolation.

- [ ] **Step 4: Run** — expect PASS. Typecheck.
- [ ] **Step 5: Commit** `git commit -m "Add generic non-leaking proxy error handler"`

---

## Task 12: The forward proxy route

**Files:**
- Create: `apps/proxy-service/src/routes/proxy.ts`
- Test: `apps/proxy-service/tests/proxy.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–11.
- Produces: `registerProxyRoute(app, deps)` where `deps = { env, verifyToken, allow (limiter), redis }`. Handles **all methods** on `*`. Order per spec §3.

- [ ] **Step 1: Write the failing test** (inject fakes; stub the upstream via a `pinnedFetch` seam)

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { registerProxyRoute } from '../src/routes/proxy.js';
import type { Env } from '../src/env.js';

const env = {
  JWT_ISSUER: 'chatsundere-auth-v1', TRUST_PROXY_HOPS: 1,
  RATE_LIMIT_USER_PER_MIN: 120, RATE_LIMIT_IP_PER_MIN: 600, MAX_BODY_BYTES: 52428800,
  CORS_ALLOWED_ORIGINS: ['https://app.chatsundere.me'],
} as unknown as Env;

function build(overrides: Partial<Parameters<typeof registerProxyRoute>[1]> = {}) {
  const app = new Hono();
  registerProxyRoute(app, {
    env,
    verifyToken: async (t: string) => { if (t !== 'GOOD') throw new Error('bad'); return { sub: 'user-1' }; },
    allow: async () => true,
    // seam: skip real DNS/fetch — echo the request the proxy built
    pinnedFetch: async (req: Request) => new Response('ok', { status: 200, headers: { 'x-fwd-auth': req.headers.get('authorization') ?? '' } }),
    ...overrides,
  });
  return app;
}

describe('proxy route', () => {
  test('401 without a valid account token', async () => {
    const res = await build().request('/v1/chat', {
      method: 'POST',
      headers: { 'x-cors-proxy-target': 'https://api.x.ai', authorization: 'Bearer UP' },
    });
    expect(res.status).toBe(401);
  });
  test('forwards with a valid token and strips the account header', async () => {
    const res = await build().request('/v1/chat', {
      method: 'POST',
      headers: {
        'x-chatsundere-authorization': 'Bearer GOOD',
        'x-cors-proxy-target': 'https://api.x.ai',
        authorization: 'Bearer UP',
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-fwd-auth')).toBe('Bearer UP');
  });
  test('429 when the per-user limiter denies', async () => {
    const res = await build({ allow: async () => false }).request('/v1/chat', {
      method: 'POST',
      headers: { 'x-chatsundere-authorization': 'Bearer GOOD', 'x-cors-proxy-target': 'https://api.x.ai' },
    });
    expect(res.status).toBe(429);
  });
});
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement `src/routes/proxy.ts`.** `registerProxyRoute(app, deps)` registers `app.all('*', handler)`. The `pinnedFetch` dep defaults to the real implementation (parse token from `x-chatsundere-authorization`, `parseTarget`, `resolveAndPin`, then `fetch(\`${protocol}//${ip}${url.pathname}${url.search}\`, { method, headers: buildForwardHeaders(...), body, redirect: 'manual', ...(protocol === 'https:' ? { tls: { serverName: host } } : {}) })`) but is injectable for tests. Handler order (spec §3): OPTIONS→preflight; derive client IP (`deriveClientIp` using `X-Forwarded-For` + Bun's `server.requestIP`, threaded via `c.env`); per-IP `allow` (pre-auth) → 429 + `recordRateLimited`; read `x-chatsundere-authorization`, `verifyToken` → 401 + `recordUnauthorized` on failure; per-user `allow` → 429; `parseTarget` (400) + `resolveAndPin` (403, `recordSsrfBlocked`); enforce `MAX_BODY_BYTES` on the streamed body; `pinnedFetch`; stream `res.body` through with `filterResponseHeaders` + CORS; record `recordRequest` + `recordLlmRequest(normaliseLlmHost(host))` for llm kind. Determine `kind` from a client `x-cors-proxy-kind` hint (default `llm`); **never** compute a host label for `mcp`. **Concurrency cap:** keep an in-process `Map<sub, number>` of active connections; on entry (after per-user limit) reject with `429` if the count for `sub` is `>= env.MAX_CONCURRENT_PER_USER`, otherwise increment, and decrement in a `finally` after the stream completes. Note in a comment that this is per-replica (single-replica assumption, spec §6.4).

- [ ] **Step 4: Run** — expect PASS. Typecheck.
- [ ] **Step 5: Commit** `git commit -m "Add the method-agnostic forward proxy route"`

---

## Task 13: Two-port server split

**Files:**
- Create: `apps/proxy-service/src/ops.ts`
- Modify: `apps/proxy-service/src/server.ts`, `apps/proxy-service/src/index.ts`, `apps/proxy-service/src/routes/health.ts`
- Test: `apps/proxy-service/tests/two-port.test.ts`

**Interfaces:**
- Produces: `createOpsApp(): Hono` (health + metrics), `createServer(deps): Hono` (proxy only, no reserved paths).

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { createOpsApp } from '../src/ops.js';

describe('two-port split', () => {
  test('ops app serves /metrics', async () => {
    const res = await createOpsApp().request('/metrics');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('# TYPE');
  });
  // Public-port behaviour: a /metrics request is treated as a proxy target path,
  // NOT served locally — covered by the proxy route test (no local /metrics handler).
});
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3:** Move the health/metrics handlers into `createOpsApp()` in `src/ops.ts`. Update `routes/health.ts`'s `/readyz` to report `redis` only (drop `database`). Rewrite `server.ts` `createServer(deps)` to mount **only** the proxy route (Task 12) + `app.onError(onProxyError)`, with **no** `/healthz`/`/readyz`/`/metrics` on it. Rewrite `index.ts` to `loadEnv()`, build the Redis client + `verifyToken` + `allow`, then start **two** `Bun.serve` instances: public on `env.PORT` (with `idleTimeout: env.PROXY_IDLE_TIMEOUT_S`) and ops on `env.OPS_PORT`. Log both ports.

- [ ] **Step 4: Run** `bun test` (whole suite) — expect PASS. Delete/replace the old `tests/health.test.ts` assertions that hit the public app for `/metrics` (they now belong to the ops app). Typecheck.
- [ ] **Step 5: Commit** `git commit -m "Split proxy and ops onto separate ports"`

---

## Task 14: Auth-service discovery endpoint

**Files:**
- Modify: `apps/auth-service/src/env.ts` (add `PROXY_PUBLIC_URL`)
- Create: `apps/auth-service/src/routes/config.ts`
- Modify: `apps/auth-service/src/server.ts` (mount + CORS)
- Test: `apps/auth-service/tests/config.test.ts`

**Interfaces:**
- Produces: `GET /api/v1/config` → `200 { proxyUrl: string, features: string[] }`, unauthenticated, CORS-enabled for the app origin.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { createServer } from '../src/server.js'; // mirror the auth-service's server factory signature

describe('GET /api/v1/config', () => {
  test('returns the configured proxyUrl and features, unauthenticated', async () => {
    const app = createServer(/* pass test env with PROXY_PUBLIC_URL=https://proxy.example */);
    const res = await app.request('/api/v1/config');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ proxyUrl: 'https://proxy.example', features: ['proxy'] });
  });
});
```

- [ ] **Step 2:** Confirm the auth-service `createServer`/env-injection signature (read `apps/auth-service/src/server.ts` + `env.ts`), and adapt the test to match. Run — expect FAIL.

- [ ] **Step 3:** Add `PROXY_PUBLIC_URL` to the auth-service env schema, validated as an absolute `https` URL (valibot `v.pipe(v.string(), v.url(), v.check(u => u.startsWith('https://')))` or equivalent). Implement `routes/config.ts` returning `{ proxyUrl: env.PROXY_PUBLIC_URL, features: ['proxy'] }`. Mount it in `server.ts` **before** any auth middleware (public), and ensure `middleware/cors.ts` covers `/api/v1/config` for the app origin (it is fetched cross-origin pre-login).

- [ ] **Step 4: Run** `bun test tests/config.test.ts` and `pnpm --filter @chatsundere/auth-service typecheck` — expect PASS. **Run the full auth-service suite** to confirm no regression on the audited surface.
- [ ] **Step 5: Commit** `git commit -m "Add public GET /api/v1/config discovery endpoint"`

---

## Task 15: Wiring verification + docs

**Files:**
- Modify: `apps/proxy-service/README.md`, `apps/proxy-service/.env.example` (final pass)

- [ ] **Step 1:** `pnpm --filter @chatsundere/proxy-service typecheck && pnpm --filter @chatsundere/auth-service typecheck` — both clean.
- [ ] **Step 2:** `cd apps/proxy-service && bun test` — full suite green (network-dependent target tests may be skipped in a sandbox; note which).
- [ ] **Step 3:** `pnpm build` at the repo root — green.
- [ ] **Step 4:** Update `apps/proxy-service/README.md`: what the service is, the two ports, every env var (from §10), and the `curl` wire shapes (spec §11) for manual verification.
- [ ] **Step 5: Commit** `git commit -m "Document proxy-service config and wire shapes"`

---

## Self-review notes (for the executor)

- **Every SSRF `test.each` case and every header-invariant case is a real bypass class** — if one fails, fix the logic, never the test.
- **The account token invariant** (Task 8) and the **metric anonymity** (Task 9) are the two hardest security requirements; treat their tests as non-negotiable.
- **The pinned-IP fetch** (Task 4/12) is DNS-rebinding defence — the connected IP MUST be the checked IP. Do not fall back to `fetch(hostname)`; the verified mechanism is `fetch(ip-url, { tls: { serverName: host } })`.
- **Larissa re-audits the built diff before squash** (spec §12) — expect a security pass on the real code, not just this plan.
```
