# Pre-Go-Live Fix Bundle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the six audited pre-go-live fix units from `superpowers/specs/2026-07-13-pre-golive-fix-bundle-design.md` — QR codes to the client origin with a `/join` landing (BLOCKER), sync robustness (tamper guard, empty-account status, blind-id memo), server-side vector tombstones, recovery error surfaces, a constructive relay-cut failure, and hygiene.

**Architecture:** Six independently squashable units (A–F). Unit A spans auth-service (QR mint helper + `APP_PUBLIC_URL`), deploy kit, and user-client (`parseJoinUrl` dual-form + `/join` chooser route). Units B/C are sync-engine-internal (client only). Units D/E are client error-surface work; E adds one typed error to `packages/llm-unified`. Unit F is docs + a settings normaliser.

**Tech Stack:** TypeScript strict, Bun (auth-service, `bun test`), React 18 + Vite (user-client, Vitest), Valibot (server env), Zustand stores, Dexie.

## Global Constraints

- **Spec:** `superpowers/specs/2026-07-13-pre-golive-fix-bundle-design.md` — read it first; it is the contract. Laura's spec-pass findings are already folded into it.
- **British English** in every artefact: code, comments, copy, commit messages, test names.
- **Worktree discipline:** all work in a dedicated worktree under `.claude/worktrees/<name>`; main tree stays on `master`. Subagents never merge, push, or switch branches. Verify every subagent commit landed on the intended branch (`git branch --contains <sha>`).
- **Gates per unit before its squash:** `pnpm typecheck --force` (expect 14/14, 0 cached), full `pnpm --filter @chatsundere/user-client vitest run` (baseline: 2931 pass as of `448861f`; the known Node-localStorage failures are environmental — verify any new failure against master before dismissing it), auth-service `bun test` for Unit A (baseline 204 pass / 12 skip / 1 pre-existing `admin-users` ordering fail), Biome on changed files. `pnpm build` (9/9) before the final squash.
- **Squash granularity:** one squashed commit per unit (A–F), free-form imperative subject. `[skip ci]` only on doc-only commits.
- **Audits (controller's duty, not subagents'):** Larissa pre-squash on Unit A; courtesy pass on B+C. Laura pre-squash on A, D, E.
- **Backend tests need the dev infra:** Postgres + Redis via `./dev-infra.sh`; the dev Redis container was noted corrupt on 2026-07-10 — if `chatsundere-dev-redis-1` misbehaves, `docker rm -f` it and re-run `./dev-infra.sh`.
- **No new Dexie version bumps anywhere in this plan** (all touched client fields are non-indexed; a bump breaks ~24 `db.verno` assertions and is not needed).

---

## Unit A — QR codes to the client origin (BLOCKER B1 + HIGH H1)

### Task A1: Shared QR-URL helper in auth-service + `APP_PUBLIC_URL`

**Files:**
- Create: `apps/auth-service/src/codes/qr-url.ts`
- Create: `apps/auth-service/tests/codes/qr-url.test.ts` (mirror where existing `codes/` tests live — check `apps/auth-service/tests/` layout and follow it)
- Modify: `apps/auth-service/src/env.ts` (add `APP_PUBLIC_URL` beside `ADMIN_PUBLIC_URL`, ~line 100)
- Modify: `apps/auth-service/src/routes/me-pairing-codes.ts:53`
- Modify: `apps/auth-service/src/routes/admin/invitations.ts:105-106`
- Modify: `apps/auth-service/src/cli/bootstrap.ts:46`
- Modify: `apps/auth-service/.env.example`, `apps/auth-service/.env.dev`

**Interfaces:**
- Produces: `buildJoinQrUrl(env: Env, code: string): string` — the ONLY way a `qr_url` is minted from now on.
- Consumes: `loadEnv()` / the `Env` type from `env.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/auth-service/tests/codes/qr-url.test.ts
import { describe, expect, test } from 'bun:test';
import { buildJoinQrUrl } from '../../src/codes/qr-url.js';

const base = { API_BASE_URL: 'https://auth.example.com/auth' } as never;

describe('buildJoinQrUrl', () => {
  test('with APP_PUBLIC_URL: client-origin form, server url-encoded, /auth stripped', () => {
    const env = { ...base, APP_PUBLIC_URL: 'https://app.example.com' } as never;
    expect(buildJoinQrUrl(env, 'ABCD-EFGH-JK')).toBe(
      'https://app.example.com/join?server=https%3A%2F%2Fauth.example.com#ABCD-EFGH-JK',
    );
  });

  test('APP_PUBLIC_URL trailing slash is tolerated', () => {
    const env = { ...base, APP_PUBLIC_URL: 'https://app.example.com/' } as never;
    expect(buildJoinQrUrl(env, 'ABCD-EFGH-JK')).toBe(
      'https://app.example.com/join?server=https%3A%2F%2Fauth.example.com#ABCD-EFGH-JK',
    );
  });

  test('without APP_PUBLIC_URL: legacy form WITH the /auth strip (B1 fix)', () => {
    expect(buildJoinQrUrl(base, 'ABCD-EFGH-JK')).toBe('https://auth.example.com/join#ABCD-EFGH-JK');
  });

  test('API_BASE_URL without /auth suffix is passed through unchanged', () => {
    const env = { API_BASE_URL: 'https://chat.example.com' } as never;
    expect(buildJoinQrUrl(env, 'ABCD-EFGH-JK')).toBe('https://chat.example.com/join#ABCD-EFGH-JK');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/auth-service && bun test tests/codes/qr-url.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/auth-service/src/codes/qr-url.ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { Env } from '../env.js';

/**
 * Single source of truth for join QR/deep-link URLs (spec 2026-07-13 §2.3).
 * With APP_PUBLIC_URL set the link lands on the user-client's /join route so a
 * native-camera scan reaches a real screen; without it we fall back to the
 * legacy auth-origin form — with the /auth suffix stripped, which the pairing
 * and bootstrap mints previously forgot (blocker B1).
 */
export function buildJoinQrUrl(env: Env, code: string): string {
  const serverBase = env.API_BASE_URL.replace(/\/auth$/, '');
  const app = env.APP_PUBLIC_URL?.replace(/\/$/, '');
  if (app) return `${app}/join?server=${encodeURIComponent(serverBase)}#${code}`;
  return `${serverBase}/join#${code}`;
}
```

In `env.ts`, add directly beneath the `ADMIN_PUBLIC_URL` entry (same validator, new name — the public origin of the user-client):

```ts
  // Public origin of the user-client. When set, join QR codes / deep links
  // point at `${APP_PUBLIC_URL}/join?...` so a native-camera scan lands on a
  // real screen (spec 2026-07-13 §2). Loopback http allowed for dev, exactly
  // like ADMIN_PUBLIC_URL.
  APP_PUBLIC_URL: optional(
    pipe(
      string(),
      url(),
      check(
        isHttpsOrLoopbackHttp,
        'APP_PUBLIC_URL must be an https URL, or http on a loopback host',
      ),
    ),
  ),
```

Also add `APP_PUBLIC_URL?: string;` to the `Env` interface and the `process.env` pickup, mirroring `ADMIN_PUBLIC_URL` (three sites total in `env.ts` — validator, interface, loader; grep `ADMIN_PUBLIC_URL` and mirror every hit).

Replace the three mint sites with the helper:
- `me-pairing-codes.ts:53`: `const qrUrl = buildJoinQrUrl(env, code);`
- `admin/invitations.ts:105-106`: delete the local `baseUrl` strip line; `const qrUrl = buildJoinQrUrl(env, code);`
- `cli/bootstrap.ts:46`: `const qrUrl = buildJoinQrUrl(env, code);`

`.env.dev`: `APP_PUBLIC_URL=http://localhost:3000`. `.env.example`: document it (client origin; QR deep links degrade to the auth-origin legacy form when unset).

- [ ] **Step 4: Run tests**

Run: `cd apps/auth-service && bun test tests/codes/qr-url.test.ts` → PASS. Then the full auth suite (`bun test` with dev infra up) — expect the 2026-07-10 baseline (204/12/1 known fail); any invitation/pairing-code test asserting the old URL shape must be updated to the helper's output, not deleted.

- [ ] **Step 5: Commit** — `Route join QR URLs through a shared client-origin builder`

### Task A2: Deploy kit + operator docs

**Files:**
- Modify: `deploy/generate.sh` (~line 59-61, beside `ADMIN_PUBLIC_URL`)
- Modify: `deploy/deployment.env.template` (auth section, beside `API_BASE_URL` ~line 27)
- Modify: `obsidian/DEPLOYMENT.md` (env-reference section that documents `ADMIN_PUBLIC_URL`; add the same treatment)

**Interfaces:** none (config only). No tests; verified by `bash -n deploy/generate.sh` and a grep that every template var referenced by `generate.sh` exists in the template.

- [ ] **Step 1:** `generate.sh`: add `[APP_PUBLIC_URL]="https://$HOST_APP"` to the substitution map (same associative-array block as `ADMIN_PUBLIC_URL`, line ~61).
- [ ] **Step 2:** `deployment.env.template`: add `APP_PUBLIC_URL=https://app.example.com` with a two-line comment (what it does; unset → legacy auth-origin QR form).
- [ ] **Step 3:** `DEPLOYMENT.md`: document the variable and the QR behaviour for self-hosters (one short subsection).
- [ ] **Step 4:** `bash -n deploy/generate.sh` → clean; `shellcheck deploy/generate.sh` if available → no new findings.
- [ ] **Step 5: Commit** — `Wire APP_PUBLIC_URL through the deployment kit`

### Task A3: `parseJoinUrl` accepts the client-origin form

**Files:**
- Modify: `apps/user-client/src/lib/qr.ts` (whole parse function, currently lines 14-41)
- Modify: `apps/user-client/src/components/JoinFormFields.tsx:23-29` (paste auto-split — verify it calls `parseJoinUrl`; if it re-implements, make it delegate)
- Test: extend the existing `parseJoinUrl` test file (locate via `rg -l "parseJoinUrl" apps/user-client/tests apps/user-client/src`)

**Interfaces:**
- Produces: `parseJoinUrl(raw: string): ParseJoinResult` — unchanged signature; `ParsedJoin.baseUrl` is now the decoded `server` param when present, else the legacy derivation. New error literal `'bad_server_param'` added to the error union.
- Consumed by: `/join` route (Task A4), both scan screens, paste auto-split.

- [ ] **Step 1: Write the failing tests**

```ts
test('new client-origin form: server param wins, code from fragment', () => {
  const r = parseJoinUrl('https://app.example.com/join?server=https%3A%2F%2Fauth.example.com#ABCD-EFGH-JK');
  expect(r).toEqual({ ok: true, value: { baseUrl: 'https://auth.example.com', code: 'ABCD-EFGH-JK' } });
});

test('new form: decoded server must be https (or loopback http) — else bad_server_param', () => {
  const r = parseJoinUrl('https://app.example.com/join?server=http%3A%2F%2Fevil.example.com#ABCD-EFGH-JK');
  expect(r).toEqual({ ok: false, error: 'bad_server_param' });
});

test('new form: loopback-http server accepted (dev)', () => {
  const r = parseJoinUrl('https://app.example.com/join?server=http%3A%2F%2Flocalhost%3A8080#ABCD-EFGH-JK');
  expect(r.ok).toBe(true);
});

test('legacy form still parses byte-identically', () => {
  const r = parseJoinUrl('https://auth.example.com/join#ABCD-EFGH-JK');
  expect(r).toEqual({ ok: true, value: { baseUrl: 'https://auth.example.com/', code: 'ABCD-EFGH-JK' } });
});
```

(Adjust the code literal to one that satisfies the real `isValidCode`; use whatever valid literal the existing tests use.)

- [ ] **Step 2:** Run → FAIL (new-form cases).
- [ ] **Step 3: Implement.** In `parseJoinUrl`, after the `/join`-path check: if `url.searchParams.has('server')`, decode it, `new URL(...)`-validate it, apply the SAME scheme rule as the outer URL (https, or http on loopback — extract the existing check into a small local helper so both call sites share it), and return `{ baseUrl: decoded, code: fragment }` (normalise: ensure trailing `/` handling matches what `probeServer`/the form expect — mirror the legacy branch's output shape). On any failure of the param: `{ ok: false, error: 'bad_server_param' }` — never silently fall back to the legacy derivation (the client origin is not the server). The outer-URL scheme check stays as-is.
- [ ] **Step 4:** Run the file's full test suite → PASS, legacy cases untouched.
- [ ] **Step 5: Commit** — `Accept the client-origin join deep-link form in parseJoinUrl`

### Task A4: `/join` landing route (chooser)

**Files:**
- Create: `apps/user-client/src/routes/join.tsx`
- Create: `apps/user-client/tests/routes/join.test.tsx` (note: page-level tests live under `apps/user-client/tests/routes/` — the deployment-kit session was bitten by planning only `src/routes/`)
- Modify: `apps/user-client/src/App.tsx` (register `<Route path="/join" element={<JoinLanding />} />` in the PUBLIC section, i.e. alongside `/onboarding/*` at lines 111-123, NOT inside `ProtectedRoute`)

**Interfaces:**
- Consumes: `parseJoinUrl` (A3), `probeServer` from `@chatsundere/ui-shared`, `useOnboardingStore` (`setState` with `{ kind: 'invitation_input' | 'pairing_input', baseUrl, code }`), `NavTile`, the matrix chrome (`brand-logo-text` etc. — copy the structure from `routes/onboarding/matrix.tsx`), session presence (same source the `Gate`/matrix uses — investigate `routes/onboarding/matrix.tsx` and `Gate` for the canonical check), link-state from `useAccountLinkStore`.

**Behavioural contract (spec §2.5(2)-(3), Laura HARD + arbitration folded — read the spec section before coding):**
1. Parse `window.location` (`?server=` + `#code`, both forms accepted). Invalid → calm notice "That link didn't carry a valid code." with one action labelled **"Choose how to join"** → `/onboarding`.
2. Session exists → redirect to `/app` with a toast; copy branches on link state: linked → "This device is already linked to your account."; local-only → constructive, non-dismissive copy naming that joining a server from a local account isn't available yet.
3. No session + valid parse → chooser: `Welcome` eyebrow + wordmark + one sentence ("You scanned a Chatsundere code") + two gold `NavTile`s — "I have an invitation" / "Link this device to my account". Probe `probeServer(baseUrl)` on entry.
4. Tile activation seeds the store EXACTLY like the `kind_mismatch` handoff (`invitation/confirm.tsx:315-321`): `setState({ kind: 'invitation_input' | 'pairing_input', baseUrl, code })` then `navigate('/onboarding/invitation' | '/onboarding/pairing')` — the flow root, never a `/confirm` deep link.
5. **Probe-fail branch (Laura HARD):** tiles stay ENABLED and still navigate to the same flow roots with the same seeded store — but the flow must land the user on the prefilled FORM (which owns probe-retry + unreachable copy), not fast-forward to confirm. **Investigate first:** how `PairingForm`/`InvitationForm` react to a pre-seeded `*_input` store state (that is how the kind_mismatch handoff fast-forwards). If seeding alone auto-forwards to confirm, add an explicit distinction (e.g. seed the store AND pass `{ state: { probeFailed: true } }` via `navigate`, with the form checking it — or whatever minimal mechanism fits the existing guard). Pin the chosen mechanism with a test: probe-fail → tile → form rendered with both fields prefilled, no confirm.
6. No wipe anywhere in this route.

- [ ] **Step 1: Write the failing tests** — cover: invalid params → notice + labelled action; valid + no session → chooser renders both tiles + sentence; tile tap seeds store + navigates to flow root (assert store state and router location); probe-fail → tiles enabled, navigation target verified per the mechanism chosen in the investigation; session-present linked / local-only → redirect + the right toast copy. Follow the render/msw/mocking patterns of the existing `tests/routes/` files (read one, e.g. the matrix test, first).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the route (structure and class vocabulary copied from `matrix.tsx`; tiles are standard-height `NavTile`s, gold overlay, centred — no `grow`).
- [ ] **Step 4:** Full user-client vitest → green vs baseline.
- [ ] **Step 5: Commit** — `Add the /join landing route for scanned Chatsundere codes`

**Unit A close-out (controller):** squash A1–A4 → **Larissa** (auth-service diff: new env parsing, URL builder, no info-disclosure change — the code still rides the fragment, never sent to any server) + **Laura pre-squash** (chooser flow vs the spec's folded HARD). Then gates, squash to master per §8 discipline.

---

## Unit B — Sync robustness

### Task B1: Tamper attention cannot be clobbered

**Files:**
- Modify: `apps/user-client/src/sync/watermark.ts:180-184` (`setAttention`)
- Test: the existing watermark/attention test file (locate via `rg -l "setAttention" apps/user-client/tests apps/user-client/src/sync`)

**Interfaces:** `setAttention(a: SyncAttention | null): Promise<void>` — signature unchanged. New exported `resetAttentionForEngineReset(): Promise<void>` ONLY if the investigation below finds a legitimate clear routed through `setAttention(null)`.

- [ ] **Step 1: Investigate the legitimate clear path.** `rg -n "setAttention(null)" apps/user-client/src` and read `sync/link-reset.ts` + the wipe path: confirm decouple/relink/wipe reset `syncState` wholesale (not via `setAttention`). Record the finding in the task summary. If any legitimate tamper-clear DOES route through `setAttention(null)`, give that caller an explicit escape (`resetAttentionForEngineReset`) rather than weakening the guard.
- [ ] **Step 2: Write the failing tests** — raise `{kind:'tamper'}` then: `setAttention({kind:'tombstone_threshold',count:25})` → persisted attention still tamper; `setAttention({kind:'quota_exceeded',...})` → still tamper; `setAttention(null)` → still tamper; `setAttention({kind:'tamper'})` → stays tamper (idempotent); and the engine-reset path still ends with no attention.
- [ ] **Step 3: Implement** — in `setAttention`, before the update: read the persisted attention; if its kind is `'tamper'` and the incoming value is not `{kind:'tamper'}`, return without writing (keep the `raisedThisCycle` bookkeeping for the incoming kind — the cycle still *raised* it; add a one-line comment why: the security alarm outranks routine notices, spec 2026-07-13 §3.1).
- [ ] **Step 4:** Sync test suite green.
- [ ] **Step 5: Commit** — `Guard the tamper attention against routine overwrites`

### Task B2: Empty-account status line

**Files:**
- Modify: `apps/user-client/src/components/SyncStatusLine.tsx:158-160` (`deriveSyncStatus` step 6)
- Test: the existing `deriveSyncStatus` tests (same file's test module)

- [ ] **Step 1: Failing tests** — `watermarkRev: 0, lastSyncAt: null, online` → kind `pulling`; `watermarkRev: 0, lastSyncAt: <timestamp>, online, empty outbox` → kind `synced`.
- [ ] **Step 2:** Run → second case FAILS (currently `pulling`).
- [ ] **Step 3:** Change the guard to `if (state.watermarkRev === 0 && online && state.lastSyncAt === null)` and fix the duplicated step-numbering comment (`6.`/`6.` → renumber).
- [ ] **Step 4:** Suite green.
- [ ] **Step 5: Commit** — `Stop showing first-sync pulling on an already-synced empty account`

### Task B3: Blind-id derivation memo (MEDIUM-3)

**Files:**
- Modify: `apps/user-client/src/sync/apply.ts` (`findKeyByBlindId`, stage-1 loop at ~:490-494; the per-cycle cache reset site — find where `blindIdCache` is nulled, `rg -n "blindIdCache" apps/user-client/src/sync/apply.ts`)
- Test: the apply test file that already covers `findKeyByBlindId`/tombstones

**Interfaces:** none new — internal memo.

- [ ] **Step 1: Failing test** — spy on the blind-id derivation (inject/mock `activeBlindId`; it is already an injectable factory — check how existing tests stub it): apply N=5 tombstones against a collection with M=20 syncRows metas → the derive function is called at most M (+N for misses) times total, NOT N×M. Assert exact ceiling.
- [ ] **Step 2:** Run → FAIL (current count is N×M).
- [ ] **Step 3: Implement** — module-level per-cycle `Map<string /* collection */, Map<string /* key */, string /* blindIdB64 */>>` memo for stage 1: inside the stage-1 loop, look the meta's key up in the memo before deriving; store after deriving. Clear the memo at the exact same site(s) `blindIdCache` is cleared (same lifecycle: per cycle, MK-scoped — if `blindIdCache` clearing is keyed to anything else, mirror it precisely; a stale memo across an MK change would be a correctness bug, so double-check the clear covers MK/link resets).
- [ ] **Step 4:** Full sync suite green (behaviour identical, count reduced).
- [ ] **Step 5: Commit** — `Memoise blind-id derivations across a pull cycle`

**Unit B close-out (controller):** gates → Larissa courtesy glance (B1's guard semantics) → squash.

---

## Unit C — Vector tombstones on document delete (MEDIUM-1)

### Task C1: Enqueue vector tombstones in the delete cascades

**Files:**
- Modify: `apps/user-client/src/data/knowledge.ts` (`deleteDocumentCascade` ~:74-96, `deleteLibraryCascade` ~:100-130; update the `:82` comment recording the superseded rule)
- Modify: `apps/user-client/src/sync/apply.ts` (`applyTombstone` tally at ~:552-557 — exclude `vectors`)
- Test: `apps/user-client/tests/` knowledge/sync tests (extend where `deleteDocumentCascade` is already covered)

**Interfaces:**
- Consumes: `mutateSynced` (`sync/enqueue.ts:~127` — it already supports a **`cascade`** of `{collection, key}` children enqueued as `'delete'`, see `enqueue.ts:192`), the knowledge vector store (`deleteDocumentVectors`).

- [ ] **Step 0: Investigate the vectors sync-key contract.** The boot corpus-arm scan (`boot/server-foundation.ts:40-53`) enqueues `vectors` rows — read it and the vectors handling in `sync/` to learn what a `vectors` outbox key IS (vector row id? chunk id?). The tombstone key MUST match what the push path uses for upserts, or the server tombstones a different blind id. Also read how a pulled `vectors` tombstone applies locally (`apply.ts` — vectors live in the embeddings DB, not client-data Dexie). Record both answers in the task summary before writing code.
- [ ] **Step 1: Failing tests** — (a) `deleteDocumentCascade` on a linked device with 3 vector rows for the document → outbox contains 3 `{collection:'vectors', op:'delete'}` entries with the exact keys from Step 0 plus the document tombstone; (b) unlinked device → no enqueues (mirror how the existing linked/unlinked gating is tested — `isLinkedForSync`); (c) `deleteLibraryCascade` cascades per document; (d) a PULLED `vectors` tombstone does not increment the user-facing tombstone tally: apply ≥20 vector tombstones → no `tombstone_threshold` attention; 20 `documents` tombstones → attention raised (pin both directions).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** — collect the document's vector keys BEFORE `deleteDocumentVectors` runs (the store query is the source), then pass them as `cascade: keys.map((k) => ({ collection: 'vectors', key: k }))` into the existing `mutateSynced` call. Library cascade: per contained document. In `applyTombstone`, guard the tally: `if (collection !== 'vectors') { tombstoneCycleCount += 1; ... }` with a comment (vectors are invisible infrastructure; one document delete carries hundreds of chunks — spec 2026-07-13 §4.3). Rewrite the `knowledge.ts:82` comment: vectors ARE tombstoned server-side on document/library delete as of 2026-07-13 (supersedes the original sync-spec decision); edit-shrink cleared-state semantics unchanged.
- [ ] **Step 4: Verify the retry path** — confirm (by reading `sync/worker.ts` drain error handling, plus an existing test if one covers `delete_rate_limited`) that a rate-limit-bounced tombstone stays in the outbox and retries. If genuinely untested and cheap to pin, add the test; if it requires new harness machinery, record it as a follow-ups row instead (do not gold-plate).
- [ ] **Step 5:** Full user-client vitest green.
- [ ] **Step 6: Commit** — `Tombstone document vectors server-side on delete`

**Unit C close-out (controller):** gates → Larissa courtesy pass (tombstone semantics + no new plaintext exposure — keys/blind-ids only) → squash.

---

## Unit D — Recovery error surfaces

### Task D1: Onboarding recovery — dead branches + honest 429

**Files:**
- Modify: `apps/user-client/src/routes/onboarding/recovery.tsx:97-125` (the catch handler)
- Test: the route's existing test file under `apps/user-client/tests/` (find via `rg -l "onboarding/recovery" apps/user-client/tests`)

**Current code (verbatim, for orientation):** the CryptoError branch handles `conflict`, then `integrity_check_failed | wrong_recovery_key` (inline, non-fatal); the HttpError branch checks `404/not_found`, `429/rate_limit_exceeded` (phantom literal), `>=500/0`. `recoverFromScratch` wraps the 404 into `CryptoError('not_found')` so the HttpError 404 arm is dead; `decodeRecoveryKey` throws `CryptoError('invalid_recovery_key_format')` which no arm catches.

- [ ] **Step 1: Failing tests** — drive the submit handler with a mocked `recoverFromScratch` (follow the file's existing test mocking):
  - throws `CryptoError('not_found')` → fatal screen "No account with that username on this server."
  - throws `CryptoError('invalid_recovery_key_format')` → inline key-field error (same copy as `routes/login/recovery.tsx:234` uses for this code — read it and reuse verbatim), screen stays `ready`, typed inputs preserved.
  - throws `HttpError` 429 with `Retry-After: 300` → fatal copy "Too many attempts. Please wait about 5 minutes."; without Retry-After → "Too many attempts. Please wait a few minutes."
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** — extend the CryptoError branch:

```tsx
if (err instanceof CryptoError && err.code === 'not_found') {
  setScreen({ kind: 'fatal', message: 'No account with that username on this server.' });
  return;
}
if (err instanceof CryptoError && err.code === 'invalid_recovery_key_format') {
  setRecoveryKeyError(/* the login-surface copy for this code, reused verbatim */);
  setScreen({ kind: 'ready' });
  return;
}
```

Delete the now-dead `err.status === 404 || err.code === 'not_found'` HttpError arm ONLY if Step 1's mock proves it dead for every caller path — otherwise leave it as a harmless backstop with a comment. Replace the 429 arm: drop `|| err.code === 'rate_limit_exceeded'` (phantom — server emits `rate_limited`; use that literal alongside the status check), compute the minutes copy from the parsed `Retry-After` on `HttpError` (verify the field name in `lib/fetch.ts` — the audit says it is parsed but unused).

- [ ] **Step 4:** Suite green.
- [ ] **Step 5: Commit** — `Surface unknown-username and malformed-key errors in onboarding recovery`

### Task D2: Flow R — back affordance + status disambiguation

**Files:**
- Modify: `apps/user-client/src/routes/login/recovery.tsx` (`step2-deferred` screen at ~:297-378; `mapOnlineRecoveryError` at ~:244-256)
- Test: the route's existing test file

- [ ] **Step 1: Failing tests** — (a) in `step2-deferred`, a wrong-key failure renders the error AND a "Re-enter recovery key" affordance; activating it returns to the key step with username preserved, key field cleared; (b) `mapOnlineRecoveryError(HttpError 429)` → rate-limit copy ("Too many attempts — wait a few minutes."), `404` → unknown-username copy, network throw → unchanged unreachable copy.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** — add the back affordance to the `step2-deferred` branch only (`step2-local` reached the screen with a verified key — check whether the same affordance is still coherent there and include it only if it costs nothing); it sets the step state back to the key-entry step, preserving username state, clearing + focusing the key field. Split `mapOnlineRecoveryError`'s HttpError arm by status. Keep 409/401 on the existing generic copy (spec §5.2 — a specific guess would mislead).
- [ ] **Step 4:** Suite green.
- [ ] **Step 5: Commit** — `Give flow-R recovery a way back to the key step and honest statuses`

**Unit D close-out (controller):** gates → **Laura pre-squash** (both screens) → squash. Not a Larissa path.

---

## Unit E — Constructive relay-cut failure (proxy M1)

### Task E1: Typed `ProxyUnavailableError` in llm-unified

**Files:**
- Modify: `packages/llm-unified/src/transport.ts:92-97` (the two guards)
- Modify: the package's public export barrel (`packages/llm-unified/src/index.ts` — verify path)
- Test: `packages/llm-unified/src/transport.test.ts`

**Interfaces:**
- Produces: `export class ProxyUnavailableError extends Error { readonly missing: 'proxy_url' | 'account_token'; }` — exported from the package root; message text stays close to today's for log continuity.

- [ ] **Step 1: Failing tests** — `buildRequest` (or the module's tested entry — mirror the existing proxy-branch tests at `transport.test.ts:67-86`) with cors-proxy routing and (a) no proxy source → throws `ProxyUnavailableError` with `missing === 'proxy_url'`; (b) source without token → `missing === 'account_token'`; both `instanceof Error`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** the class (JSDoc: "Thrown when a provider requires the account proxy but the device has no discovered proxy URL / no account token — the user-facing remedy is linking the account.") and replace the two `throw new Error(...)` sites.
- [ ] **Step 4:** `cd packages/llm-unified && bun test` → green (baseline ~421). **Then rebuild the package** (`pnpm --filter @chatsundere/llm-unified build`) — stale `dist/` causes phantom tsc errors downstream.
- [ ] **Step 5: Commit** — `Throw a typed ProxyUnavailableError from the proxy transport guards`

### Task E2: Client surfaces the relay-cut failure constructively

**Files:**
- Modify: `apps/user-client/src/state/stream-manager.store.ts` (~:1110-1127 — the away-from-chat failure toast; also find where the failure/`retryDisabledReason`/footer state is recorded for the in-chat case — trace the `.catch` path that persists the interrupted state)
- Modify: `apps/user-client/src/components/chat/StreamInterruptedFooter.tsx` (link-button)
- Test: stream-manager tests + a footer render test

**Interfaces:**
- Consumes: `ProxyUnavailableError` from `@chatsundere/llm-unified` (Task E1).

**Copy (spec §6, Laura naming-parity SOFT):** first verify the account sub-page title and its My-Account tile both read **"Server linking"** verbatim (`routes/app/account/server-linking.tsx` + the account matrix tile meta); if either differs, align the copy below to the REAL name rather than renaming the page.
- Toast: `` `${persona.name} needs your account link to reach this model — open My Account → Server linking.` ``
- Footer link-button label: `Open Server linking` → `navigate('/app/account/server-linking')`.

- [ ] **Step 1: Failing tests** — (a) stream failure with `ProxyUnavailableError` → toast shows the new copy (not the generic); any other error → generic copy unchanged; (b) footer in the proxy-unavailable failure state renders the link-button and it navigates (render test with a router harness, following existing footer tests); (c) the error message reaching the footer is the specific one, not a swallowed generic — assert on rendered text (the known unrendered-error-surface failure class).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** — branch on `instanceof ProxyUnavailableError` in the failure path; thread a discriminant (e.g. an optional `failureKind: 'proxy_unavailable'` on whatever state the footer already reads — inspect the footer's props at `StreamInterruptedFooter.tsx` and its call site in `chat-page.tsx`/`send-message.ts` first and extend minimally). Background jobs (title-gen/memory) stay silent — verify their catch paths don't route through the toast (spec §6.3).
- [ ] **Step 4:** Full user-client vitest green. **Restart `pnpm dev` if device-checking** (Vite HMR ignores `packages/*` — the rebuilt llm-unified needs a dev-server restart to be visible).
- [ ] **Step 5: Commit** — `Surface a constructive next step when a model needs the account proxy`

**Unit E close-out (controller):** gates → **Laura pre-squash** (copy + affordance) → squash. Not a Larissa path (client + llm-unified error type only).

---

## Unit F — Hygiene

### Task F1: Ledger + orphaned relay secret

**Files:**
- Modify: `obsidian/insights/follow-ups-index.md`
- Modify: `apps/user-client/src/data/settings.ts` (the load-time coercion noted at `:30` for device-local fields — add the normaliser where `corsProxy` is already listed as device-local)
- Test: extend the settings load tests (same directory’s existing coverage)

- [ ] **Step 1 (code): Failing test** — a settings row loaded with a legacy `corsProxy` object (sealed `sharedKey` blob) comes out with `corsProxy: null` (or the field's documented empty shape — mirror what fresh installs get, `boot/client-data-db.ts:~1640`), and a write-back persists the cleared value. No Dexie bump.
- [ ] **Step 2:** Implement in the existing coercion path; comment: dead since the relay cut `94bdcdd6`; sealed ciphertext, unreadable and unused — cleared on load (spec 2026-07-13 §7.2).
- [ ] **Step 3 (docs):** follow-ups-index edits, exactly per spec §7.1: wafer/xAI row → Resolved (squash `62874ec4`; the real-key device probe stays on the go-live checklist); `/linking/scan` row → struck with the one-line reason; F7 row → resolved via Unit A, live-scan verification still owed to Chris; add rows: local→server upgrade path missing (Lyra/Chris design question, from spec §2.5(3)); resolved rows for tamper guard / MEDIUM-1 / MEDIUM-3 / recovery branches / flow R / relay-cut toast once their units are squashed.
- [ ] **Step 4:** Gates on the code part; docs part rides a `[skip ci]` commit if committed separately from the settings change (mixed commit → no tag).
- [ ] **Step 5: Commit** — `Clear the orphaned relay secret and settle the audit ledger` (add `[skip ci]` ONLY if the settings change ends up in its own earlier commit and this one is doc-only).

---

## Final integration (controller)

- [ ] All six squashes on the worktree branch in order A→F; `pnpm typecheck --force` 14/14 + full vitest + `pnpm build` 9/9 on the INTEGRATED tree.
- [ ] Verify the squash-merge captured the full tree (file-count/diff vs branch tip; typecheck on master post-merge) and no scratch/report files leaked into the tracked tree (`git diff --cached --name-only`).
- [ ] Update `obsidian/STATUS-BACKEND.md` (Unit A, C server-relevant) + `obsidian/STATUS-CLIENT-ONLY.md` (B, D, E, F) per CLAUDE.md §16.
- [ ] Master is NOT pushed — Chris pushes after his §9-spec manual verification (spec 2026-07-13 §9: system-camera + in-app QR scans, recovery typo copy, flow-R back, relay-cut footer, empty-account status, plus the non-code checklist: one real xAI/wafer proxy send).
