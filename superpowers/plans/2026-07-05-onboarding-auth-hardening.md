# Onboarding & Auth Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close follow-ups F3 (multi-tab concurrent refresh hard-logs-out both tabs) and Pairing F4/F5 (five real join lifecycle codes fall through to a generic error) ahead of the v0.2.0 go-live.

**Architecture:** Unit A wraps the token-refresh round-trip in a cross-tab `navigator.locks` exclusive lock so concurrent tabs serialise instead of tripping server reuse-detection (client-only). Unit B reconciles `shared-types` `JoinError` with what the auth-service actually emits, unifies `code_already_redeemed` to 410 Gone, and maps each lifecycle code to a flow-tailored constructive message in both onboarding confirm handlers.

**Tech Stack:** TypeScript (strict), Bun test runner (auth-service), Vitest (user-client), Hono + Drizzle (auth-service), React (user-client).

## Global Constraints

- **British English** in every string, comment, and copy line — no exceptions (CLAUDE.md §3.7).
- **TypeScript strict**, `noUncheckedIndexedAccess`. No `any` without an inline comment explaining why.
- **`JoinError` is the single wire truth** for join lifecycle codes — newly-mapped branches reference the constant, not a bare string literal.
- **Copy is fixed by the spec** (`superpowers/specs/2026-07-05-onboarding-auth-hardening-design.md` §4.5) — reproduce verbatim, do not paraphrase.
- **Two independent units.** Unit A (Task 1) is client-only, not a Larissa path. Unit B (Tasks 2–4) touches the auth-service → Larissa gate before squash. They squash as two separate feature units; Liz owns the squash.
- **Do not touch** `packages/crypto/src/flows/join-by-pairing.ts` (the dead `isEvidenceInvalidError` rewrap is a separate follow-up; touching it drags crypto onto the Larissa path).

---

## File Structure

- `apps/user-client/src/lib/fetch.ts` — add `withRefreshLock`, wire it into `refreshAccessToken`. (Unit A)
- `apps/user-client/tests/lib/refresh-lock.test.ts` — new, pins the lock mechanism + fallback. (Unit A)
- `apps/auth-service/src/codes/rate-limit.ts` — `code_already_redeemed` 409 → 410, docstring. (Unit B)
- `apps/auth-service/tests/integration/join-invitation.test.ts` (and/or `join-pairing.test.ts`) — update the redeemed-twice status assertion. (Unit B)
- `packages/shared-types/src/join.ts` — correct `JoinError` (remove phantom, add four real codes). (Unit B)
- `apps/user-client/src/routes/onboarding/pairing/confirm.tsx` — map five codes, fix the dead `rate_limit_exceeded` branch. (Unit B)
- `apps/user-client/tests/routes/pairing-confirm-map-error.test.ts` — extend with the five codes + drift guards. (Unit B)
- `apps/user-client/src/routes/onboarding/invitation/confirm.tsx` — map four codes, align `session_expired` copy, export `mapSubmitError`. (Unit B)
- `apps/user-client/tests/routes/invitation-confirm-map-error.test.ts` — new, mirrors the pairing test. (Unit B)

---

## Task 1: F3 — cross-tab refresh serialisation

**Files:**
- Modify: `apps/user-client/src/lib/fetch.ts` (add `withRefreshLock`; change `refreshAccessToken` at `:198`)
- Test: `apps/user-client/tests/lib/refresh-lock.test.ts` (create)

**Interfaces:**
- Consumes: `classifyRefresh(baseUrl: string): Promise<RefreshOutcome>` (existing, `fetch.ts:156`), `refreshInFlight` module var (`fetch.ts:148`).
- Produces: `refreshAccessToken` unchanged signature (`(baseUrl: string, origin?: FetchOrigin) => Promise<boolean>`); its refresh round-trip now runs inside an exclusive Web Lock named `'chatsundere-token-refresh'`.

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/lib/refresh-lock.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { refreshAccessToken } from '../../src/lib/fetch.js';

// A minimal LockManager stand-in — jsdom has no navigator.locks. We record the
// lock name and run the callback synchronously, proving the refresh round-trip
// is routed through the named exclusive lock.
type LockRequest = (name: string, cb: (lock: unknown) => Promise<unknown>) => Promise<unknown>;

function installFakeLocks(record: string[]): void {
  const request: LockRequest = (name, cb) => {
    record.push(name);
    return cb(null);
  };
  (globalThis.navigator as unknown as { locks: { request: LockRequest } }).locks = { request };
}

function removeLocks(): void {
  delete (globalThis.navigator as unknown as { locks?: unknown }).locks;
}

afterEach(() => {
  removeLocks();
  vi.restoreAllMocks();
});

describe('refreshAccessToken cross-tab serialisation (F3)', () => {
  it('routes the refresh round-trip through the chatsundere-token-refresh Web Lock', async () => {
    const acquired: string[] = [];
    installFakeLocks(acquired);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'at', expires_in: 900 }), { status: 200 }),
    );

    const ok = await refreshAccessToken('https://auth.example');

    expect(ok).toBe(true);
    expect(acquired).toEqual(['chatsundere-token-refresh']);
  });

  it('falls back to a direct refresh when navigator.locks is unavailable', async () => {
    removeLocks();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ access_token: 'at', expires_in: 900 }), { status: 200 }),
      );

    const ok = await refreshAccessToken('https://auth.example');

    expect(ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/lib/refresh-lock.test.ts`
Expected: the first test FAILS — `acquired` is `[]` because `refreshAccessToken` does not yet route through `navigator.locks`.

- [ ] **Step 3: Add `withRefreshLock` and wire it in**

In `apps/user-client/src/lib/fetch.ts`, add this helper immediately above `refreshAccessToken` (after the `refreshInFlight` declaration block, ~`:148`):

```ts
/**
 * Serialise the refresh round-trip across all same-origin tabs. Two tabs
 * refreshing concurrently present the same refresh token to the server, which
 * reads that as reuse and revokes the whole family (F3). An exclusive, blocking
 * Web Lock makes the second tab wait, so each refresh presents the current
 * (already-rotated) cookie — no concurrent reuse. Falls back to a direct call
 * where navigator.locks is unavailable (jsdom, older engines); the module-local
 * refreshInFlight guard still collapses a within-tab 401 storm.
 */
async function withRefreshLock(fn: () => Promise<RefreshOutcome>): Promise<RefreshOutcome> {
  const locks = globalThis.navigator?.locks;
  if (locks && typeof locks.request === 'function') {
    // Exclusive (default mode), blocking — the second tab waits, it does not skip.
    return locks.request('chatsundere-token-refresh', fn);
  }
  return fn();
}
```

Then change the `refreshInFlight` assignment in `refreshAccessToken` (`fetch.ts:198`) from:

```ts
  refreshInFlight ??= classifyRefresh(baseUrl).finally(() => {
    refreshInFlight = null;
  });
```

to:

```ts
  refreshInFlight ??= withRefreshLock(() => classifyRefresh(baseUrl)).finally(() => {
    refreshInFlight = null;
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/lib/refresh-lock.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck --force`
Expected: 14/14 packages pass. (`globalThis.navigator.locks` is typed by lib.dom `LockManager`; the callback ignoring its `lock` argument is assignable.)

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/lib/fetch.ts apps/user-client/tests/lib/refresh-lock.test.ts
git commit -m "Serialise token refresh across tabs with a Web Lock

Two tabs refreshing concurrently presented the same refresh token, tripping
server reuse-detection and hard-logging-out both. Wrap the refresh round-trip in
an exclusive navigator.locks lock (chatsundere-token-refresh); the module-local
refreshInFlight guard still collapses a within-tab 401 storm, and a direct-call
fallback preserves jsdom behaviour. Closes follow-up F3.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 2: F4/F5 — auth-service `code_already_redeemed` → 410 Gone

**Files:**
- Modify: `apps/auth-service/src/codes/rate-limit.ts:64-66` (status + docstring `:26`)
- Test: `apps/auth-service/tests/integration/join-invitation.test.ts` and/or `join-pairing.test.ts` (update the redeemed-twice assertion)

**Interfaces:**
- Consumes: nothing new.
- Produces: `consumePendingCodeAttempt` now throws `ApiError(410, 'code_already_redeemed', …)` (was 409). The `code` string is unchanged, so the only wire change is the HTTP status.

- [ ] **Step 1: Locate the server test that asserts the redeemed status**

Run: `rg -n "code_already_redeemed|409" apps/auth-service/tests/integration/join-invitation.test.ts apps/auth-service/tests/integration/join-pairing.test.ts`
Identify the assertion that redeems a code twice and expects status `409` with code `code_already_redeemed`. (If the assertion checks only the code string and not the status, add a status assertion so the change is pinned.)

- [ ] **Step 2: Update the test to expect 410 (failing)**

Change the identified assertion's expected status from `409` to `410` (keep the `code_already_redeemed` code assertion). Example shape — match the file's actual style:

```ts
expect(res.status).toBe(410);
expect(body.error.code).toBe('code_already_redeemed');
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/auth-service && bun test tests/integration/join-invitation.test.ts`
Expected: FAIL — server still emits 409, test now expects 410.

- [ ] **Step 4: Change the status in the code**

In `apps/auth-service/src/codes/rate-limit.ts`, change (`:64-66`):

```ts
  if (row.redeemedAt !== null) {
    throw new ApiError(409, 'code_already_redeemed', 'Code already redeemed');
  }
```

to:

```ts
  if (row.redeemedAt !== null) {
    // 410 Gone (was 409): a redeemed one-time code is terminally spent, not a
    // conflict — aligns with code_expired (410) and the atomic-CAS path in
    // routes/join.ts, which already emits 410 for the same code.
    throw new ApiError(410, 'code_already_redeemed', 'Code already redeemed');
  }
```

And update the docstring line (`:26`) from:

```ts
 *  - 409 `code_already_redeemed`     — row was already redeemed
```

to:

```ts
 *  - 410 `code_already_redeemed`     — row was already redeemed
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/auth-service && bun test tests/integration/join-invitation.test.ts`
Expected: PASS. Then run the fuller suite to confirm the known baseline is unchanged: `cd apps/auth-service && bun test` — expect the pre-existing OPAQUE/recovery/join baseline failures only (no new failures beyond that baseline).

- [ ] **Step 6: Commit**

```bash
git add apps/auth-service/src/codes/rate-limit.ts apps/auth-service/tests/integration/
git commit -m "Return 410 Gone for an already-redeemed pending code

A redeemed one-time code is terminally spent, not a conflict — 410 aligns it
with code_expired and the atomic-CAS redemption path in routes/join.ts, which
already emits 410 for the same code. The error code string is unchanged.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 3: F4/F5 — shared-types + pairing confirm mapping

**Files:**
- Modify: `packages/shared-types/src/join.ts:69-78` (correct `JoinError`)
- Modify: `apps/user-client/src/routes/onboarding/pairing/confirm.tsx:245-293` (`mapError` — five codes, fix dead branch)
- Test: `apps/user-client/tests/routes/pairing-confirm-map-error.test.ts` (extend)

**Interfaces:**
- Consumes: `JoinError` (corrected below), `HttpError` (`fetch.ts:12`), the `Mapped` type (`confirm.tsx:241`).
- Produces: `JoinError.RateLimited = 'rate_limited'`, `JoinError.CodeExpired = 'code_expired'`, `JoinError.CodeAlreadyRedeemed = 'code_already_redeemed'`, `JoinError.CodeAttemptsExhausted = 'code_attempts_exhausted'` (and `RateLimitExceeded` removed). `mapError` now returns specific fatal screens for `code_expired`, `code_already_redeemed`, `code_attempts_exhausted`, `rate_limited`, `session_expired`.

- [ ] **Step 1: Correct `JoinError` in shared-types**

In `packages/shared-types/src/join.ts`, replace the `JoinError` object (`:69-78`) with:

```ts
/** Error codes the join surface can emit. Used for narrow client-side handling. */
export const JoinError = {
  InvalidCodeFormat: 'invalid_code_format',
  KindMismatch: 'kind_mismatch',
  CodeNotFoundOrExpired: 'code_not_found_or_expired',
  CodeExpired: 'code_expired',
  CodeAlreadyRedeemed: 'code_already_redeemed',
  CodeAttemptsExhausted: 'code_attempts_exhausted',
  RateLimited: 'rate_limited',
  UsernameTaken: 'username_taken',
  OpaqueAuthenticationFailed: 'opaque_authentication_failed',
  SessionExpired: 'session_expired',
  WrappingInvariantViolated: 'wrapping_invariant_violated',
} as const;
```

Confirm no other consumer referenced the removed constant:
Run: `rg -n "RateLimitExceeded" packages apps`
Expected: no hits (the client handlers use the bare string literal `'rate_limit_exceeded'`, which we replace below).

- [ ] **Step 2: Write the failing tests**

Extend `apps/user-client/tests/routes/pairing-confirm-map-error.test.ts` — add a new `describe` block (keep the existing one):

```ts
import { JoinError } from '@chatsundere/shared-types';

describe('PairingConfirm mapError — join lifecycle codes (F4/F5)', () => {
  it('maps code_expired to a specific fatal screen', () => {
    expect(mapError(new HttpError(410, 'code_expired', 'gone'))).toEqual({
      kind: 'screen',
      screen: {
        kind: 'fatal',
        message:
          'This pairing code has expired. Generate a fresh one on your other device and enter it here.',
      },
    });
  });

  it('maps code_already_redeemed to a specific fatal screen', () => {
    expect(mapError(new HttpError(410, 'code_already_redeemed', 'gone'))).toEqual({
      kind: 'screen',
      screen: {
        kind: 'fatal',
        message:
          'This pairing code has already been used. Generate a new one on your other device.',
      },
    });
  });

  it('maps code_attempts_exhausted to a specific fatal screen', () => {
    expect(mapError(new HttpError(429, 'code_attempts_exhausted', 'locked'))).toEqual({
      kind: 'screen',
      screen: {
        kind: 'fatal',
        message:
          'Too many tries — this code is now locked for safety. Generate a new one on your other device.',
      },
    });
  });

  it('maps rate_limited to the wait-a-minute fatal screen', () => {
    expect(mapError(new HttpError(429, 'rate_limited', 'slow down'))).toEqual({
      kind: 'screen',
      screen: {
        kind: 'fatal',
        message: 'Too many attempts. Please wait a minute, then try again.',
      },
    });
  });

  it('maps session_expired to the start-again fatal screen', () => {
    expect(mapError(new HttpError(410, 'session_expired', 'expired'))).toEqual({
      kind: 'screen',
      screen: {
        kind: 'fatal',
        message:
          'This took a little too long and the secure session timed out. Please start again.',
      },
    });
  });

  // Drift guards — pin the new constants to the exact strings the server emits.
  it('keeps the new JoinError constants aligned with the wire strings', () => {
    expect(JoinError.RateLimited).toBe('rate_limited');
    expect(JoinError.CodeExpired).toBe('code_expired');
    expect(JoinError.CodeAlreadyRedeemed).toBe('code_already_redeemed');
    expect(JoinError.CodeAttemptsExhausted).toBe('code_attempts_exhausted');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/routes/pairing-confirm-map-error.test.ts`
Expected: the five mapping tests FAIL (fall through to the generic "Something went wrong…"); the drift-guard test PASSES (constants added in Step 1).

- [ ] **Step 4: Add the branches in `mapError`**

In `apps/user-client/src/routes/onboarding/pairing/confirm.tsx`, replace the dead `rate_limit_exceeded` branch (`:258-262`):

```ts
    if (err.code === 'rate_limit_exceeded')
      return {
        kind: 'screen',
        screen: { kind: 'fatal', message: 'Too many attempts. Please wait a minute.' },
      };
```

with the five branches (place them together, after the `code_not_found_or_expired` branch at `:257`):

```ts
    if (err.code === JoinError.CodeExpired)
      return {
        kind: 'screen',
        screen: {
          kind: 'fatal',
          message:
            'This pairing code has expired. Generate a fresh one on your other device and enter it here.',
        },
      };
    if (err.code === JoinError.CodeAlreadyRedeemed)
      return {
        kind: 'screen',
        screen: {
          kind: 'fatal',
          message:
            'This pairing code has already been used. Generate a new one on your other device.',
        },
      };
    if (err.code === JoinError.CodeAttemptsExhausted)
      return {
        kind: 'screen',
        screen: {
          kind: 'fatal',
          message:
            'Too many tries — this code is now locked for safety. Generate a new one on your other device.',
        },
      };
    if (err.code === JoinError.RateLimited)
      return {
        kind: 'screen',
        screen: { kind: 'fatal', message: 'Too many attempts. Please wait a minute, then try again.' },
      };
    if (err.code === JoinError.SessionExpired)
      return {
        kind: 'screen',
        screen: {
          kind: 'fatal',
          message:
            'This took a little too long and the secure session timed out. Please start again.',
        },
      };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/routes/pairing-confirm-map-error.test.ts`
Expected: PASS (all, including the pre-existing Task-2 block).

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck --force`
Expected: 14/14. (shared-types rebuilt; pairing confirm compiles against the new constants.)

- [ ] **Step 7: Commit**

```bash
git add packages/shared-types/src/join.ts apps/user-client/src/routes/onboarding/pairing/confirm.tsx apps/user-client/tests/routes/pairing-confirm-map-error.test.ts
git commit -m "Map pairing join lifecycle codes to constructive messages

Reconcile shared-types JoinError with the server (drop the phantom
rate_limit_exceeded, add code_expired/code_already_redeemed/
code_attempts_exhausted/rate_limited) and map each — plus the previously
unhandled session_expired — to a specific, flow-tailored message in the pairing
confirm handler, instead of the generic 'Something went wrong'. Part of F4/F5.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 4: F4/F5 — invitation confirm mapping

**Files:**
- Modify: `apps/user-client/src/routes/onboarding/invitation/confirm.tsx:426-486` (`mapSubmitError` — four codes, align `session_expired` copy, export it)
- Test: `apps/user-client/tests/routes/invitation-confirm-map-error.test.ts` (create)

**Interfaces:**
- Consumes: `JoinError` (corrected in Task 3), `HttpError`, the `SubmitMapped` type (`confirm.tsx:421`).
- Produces: `mapSubmitError` is now exported and maps `code_expired`, `code_already_redeemed`, `code_attempts_exhausted`, `rate_limited`; `session_expired` copy aligned with the pairing side.

- [ ] **Step 1: Export `mapSubmitError`**

In `apps/user-client/src/routes/onboarding/invitation/confirm.tsx`, change `function mapSubmitError` (`:426`) to `export function mapSubmitError`.

- [ ] **Step 2: Write the failing tests**

Create `apps/user-client/tests/routes/invitation-confirm-map-error.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { HttpError } from '../../src/lib/fetch.js';
import { mapSubmitError } from '../../src/routes/onboarding/invitation/confirm.js';

describe('InvitationConfirm mapSubmitError — join lifecycle codes (F4/F5)', () => {
  it('maps code_expired to a specific fatal screen', () => {
    expect(mapSubmitError(new HttpError(410, 'code_expired', 'gone'))).toEqual({
      kind: 'screen',
      screen: {
        kind: 'fatal',
        message: 'This invitation has expired. Ask the person who invited you for a fresh code.',
      },
    });
  });

  it('maps code_already_redeemed to a specific fatal screen', () => {
    expect(mapSubmitError(new HttpError(410, 'code_already_redeemed', 'gone'))).toEqual({
      kind: 'screen',
      screen: {
        kind: 'fatal',
        message:
          'This invitation has already been used. Ask the person who invited you for a new one.',
      },
    });
  });

  it('maps code_attempts_exhausted to a specific fatal screen', () => {
    expect(mapSubmitError(new HttpError(429, 'code_attempts_exhausted', 'locked'))).toEqual({
      kind: 'screen',
      screen: {
        kind: 'fatal',
        message:
          'Too many tries — this invitation is now locked for safety. Ask the person who invited you for a new one.',
      },
    });
  });

  it('maps rate_limited to the wait-a-minute fatal screen', () => {
    expect(mapSubmitError(new HttpError(429, 'rate_limited', 'slow down'))).toEqual({
      kind: 'screen',
      screen: {
        kind: 'fatal',
        message: 'Too many attempts. Please wait a minute, then try again.',
      },
    });
  });

  it('aligns session_expired copy with the pairing side', () => {
    expect(mapSubmitError(new HttpError(410, 'session_expired', 'expired'))).toEqual({
      kind: 'screen',
      screen: {
        kind: 'fatal',
        message:
          'This took a little too long and the secure session timed out. Please start again.',
      },
    });
  });

  it('still falls through unrecognised errors to the generic fatal screen', () => {
    expect(mapSubmitError(new Error('boom'))).toEqual({
      kind: 'screen',
      screen: { kind: 'fatal', message: 'Something went wrong. Please try again.' },
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/routes/invitation-confirm-map-error.test.ts`
Expected: the four new-code tests FAIL (generic fallthrough); the `session_expired` test FAILS (current copy is "Your session timed out. Please start again."); the fallthrough test PASSES.

- [ ] **Step 4: Add the branches and align the copy**

In `apps/user-client/src/routes/onboarding/invitation/confirm.tsx`, replace the dead `rate_limit_exceeded` branch (`:462-467`) and the `session_expired` branch (`:468-473`) with:

```ts
    if (err.code === JoinError.CodeExpired) {
      return {
        kind: 'screen',
        screen: {
          kind: 'fatal',
          message: 'This invitation has expired. Ask the person who invited you for a fresh code.',
        },
      };
    }
    if (err.code === JoinError.CodeAlreadyRedeemed) {
      return {
        kind: 'screen',
        screen: {
          kind: 'fatal',
          message:
            'This invitation has already been used. Ask the person who invited you for a new one.',
        },
      };
    }
    if (err.code === JoinError.CodeAttemptsExhausted) {
      return {
        kind: 'screen',
        screen: {
          kind: 'fatal',
          message:
            'Too many tries — this invitation is now locked for safety. Ask the person who invited you for a new one.',
        },
      };
    }
    if (err.code === JoinError.RateLimited) {
      return {
        kind: 'screen',
        screen: { kind: 'fatal', message: 'Too many attempts. Please wait a minute, then try again.' },
      };
    }
    if (err.code === JoinError.SessionExpired) {
      return {
        kind: 'screen',
        screen: {
          kind: 'fatal',
          message:
            'This took a little too long and the secure session timed out. Please start again.',
        },
      };
    }
```

Confirm `JoinError` is imported in this file (it is used elsewhere in onboarding; if the import is missing, add `import { JoinError } from '@chatsundere/shared-types';`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/routes/invitation-confirm-map-error.test.ts`
Expected: PASS (all six).

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck --force`
Expected: 14/14.
Run: `pnpm --filter @chatsundere/user-client exec vitest run`
Expected: the known 8 Node-localStorage baseline failures only, no new failures; the two new map-error blocks and the refresh-lock suite green.
Run: `pnpm --filter @chatsundere/user-client exec biome check src/routes/onboarding/invitation/confirm.tsx`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/routes/onboarding/invitation/confirm.tsx apps/user-client/tests/routes/invitation-confirm-map-error.test.ts
git commit -m "Map invitation join lifecycle codes to constructive messages

Map code_expired/code_already_redeemed/code_attempts_exhausted/rate_limited to
specific operator-tailored messages in the invitation confirm handler, fix the
dead rate_limit_exceeded branch, align the session_expired copy with the pairing
side, and export mapSubmitError for testing. Completes F4/F5.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Post-implementation (Liz owns)

1. **Larissa gate on Unit B** (Tasks 2–4 diff — auth-service status change + the error-envelope surface). Summon with absolute worktree paths. Unit A (Task 1) is not a Larissa path.
2. **Squash** into two feature units on `full-backend-transition`: "Serialise token refresh across tabs (F3)" and "Map join lifecycle codes to constructive messages (F4/F5)". Verify each subagent commit landed on the intended branch.
3. **Update `obsidian/insights/follow-ups-index.md`** — strike F3 and Pairing F4/F5 through, move to Resolved with commit refs.
4. **STATUS-BACKEND** — note the hardening landing.
5. **Chris device-verifies** per spec §7 (needs the live backend for the F4/F5 states).

---

## Self-Review

**Spec coverage:**
- §3 F3 lock → Task 1. ✓
- §4.2 shared-types correction → Task 3 Step 1. ✓
- §4.3 auth-service 410 → Task 2. ✓
- §4.4 pairing five codes + dead-branch fix → Task 3. ✓
- §4.4 invitation four codes + `session_expired` align + export → Task 4. ✓
- §4.5 copy → reproduced verbatim in Tasks 3 & 4 test + impl steps. ✓
- §5 testing (existing scaffolds extended, new invitation scaffold) → Tasks 3 & 4. ✓
- §6 Larissa gate on Unit B, no Laura → Post-implementation. ✓
- Out-of-scope `join-by-pairing.ts` untouched → Global Constraints. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; the only "find the assertion" step (Task 2 Step 1) is a mechanical locate with an exact grep and the exact change shown in Step 2/4.

**Type consistency:** `JoinError.RateLimited`/`CodeExpired`/`CodeAlreadyRedeemed`/`CodeAttemptsExhausted`/`SessionExpired` used identically across Tasks 3 and 4 and defined in Task 3 Step 1. `mapError` (pairing) and `mapSubmitError` (invitation) names match their files. `withRefreshLock(fn: () => Promise<RefreshOutcome>)` return type matches `classifyRefresh`. Copy strings byte-match between each task's test step and its implementation step.
