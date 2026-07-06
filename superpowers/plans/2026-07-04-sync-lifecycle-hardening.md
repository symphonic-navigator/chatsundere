# Sync-Lifecycle Hardening & Device Decoupling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the sync engine arm the backfill for everything never transferred, reset transfer-state on decouple/server-switch, add a Decouple-this-device flow with server-session revoke, and make Erase-this-device a truly complete wipe.

**Architecture:** Four units on `apps/user-client` sync/onboarding surfaces plus one thin auth call. Engine-state changes are non-destructive (bookkeeping only); the only data-loss path is the wipe (Unit 4), which is made completion-aware. Reuses existing primitives (`listUnsyncedKeys`, `deleteLinkedAccount`, `_resetClientDataDbForTests` close pattern, `POST /api/v1/auth/logout`); no new server endpoints.

**Tech Stack:** TypeScript (strict), Dexie, Zustand, React 18, Vitest (frontend tests), Hono (auth-service, unchanged).

**Spec:** `superpowers/specs/2026-07-04-sync-lifecycle-hardening-design.md` — read it before starting; every task maps to a spec unit.

## Global Constraints

- All repo text (code, comments, tests, UI copy) is **British English**. Chat with Chris is German; nothing else.
- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`. No `any` without an inline justification. Biome bans the non-null `!` assertion — never introduce one.
- Tests live under `apps/user-client/tests/**` (mirroring the source path), run with **Vitest**. Expect the known 8-failure Node-localStorage baseline; a 9th new failure is real.
- Gate before every commit: `pnpm typecheck --force` (Turbo caches typecheck — do not trust a cached pass on a type-touching change) **and** Biome. Do not rely on the pre-commit hook (Biome-only).
- Engine-state helpers must touch **only** sync bookkeeping (`syncRows`, `syncOutbox`, `watermarkRev`, `epoch`, backfill flags, the new `linkedServerUserId`). They must NEVER touch a user-data table.
- Never call `DELETE /api/v1/me` from these flows. Decouple and wipe revoke only *this device's* session via `POST /api/v1/auth/logout`.
- Larissa gate before squashing Units 2/3/4 (crypto-adjacent DBs + auth session). Laura pre-squash pass on Unit 3.

---

## File structure

| File | Responsibility | Unit |
|---|---|---|
| `apps/user-client/src/sync/watermark.ts` | `getSyncState()` heals a legacy row missing optional fields | 1a |
| `apps/user-client/src/sync/backfill.ts` | new `armBackfillIfCorpusUnsynced()` reconciliation | 1b |
| `apps/user-client/src/boot/server-foundation.ts` (or the boot site that registers the engine) | invoke the reconciliation once after link status is known | 1b |
| `apps/user-client/src/sync/link-reset.ts` | new `resetEngineStateForLocalOnly()`; stamp `linkedServerUserId` in `resetEngineStateForNewLink()` | 2 |
| `apps/user-client/src/boot/client-data-db.ts` | add `linkedServerUserId?: string` to `SyncStateRow`; export `closeClientDataDb()` (prod sibling of the test reset) | 2, 4 |
| `apps/user-client/src/boot/knowledge-vectors-db.ts` | export `closeKnowledgeVectorsDb()` | 4 |
| `apps/user-client/src/sync/worker.ts` | cycle-start guard: stamped server-id ≠ current → force reset+arm | 2 |
| `apps/user-client/src/lib/auth-logout.ts` (create) | thin `logoutCurrentSession()` calling `POST /api/v1/auth/logout` | 3, 4 |
| `apps/user-client/src/lib/decouple-device.ts` (create) | orchestrate the decouple sequence (logout → clear link → local-only → reset) | 3 |
| `apps/user-client/src/routes/app/account/server-linking.tsx` | "End this link" section + typed-phrase confirm | 3 |
| `apps/user-client/src/routes/app/account.tsx` | dynamic link badge; Server-linking tile meta | 3 |
| `apps/user-client/src/lib/copy.ts` | decouple copy + typed phrase `decouple` | 3 |
| `apps/user-client/src/lib/wipe-device.ts` | completion-aware wipe + all-surface clear + logout | 4 |

---

## Task 1 — Heal legacy `syncState` rows (Unit 1a)

**Files:**
- Modify: `apps/user-client/src/sync/watermark.ts` (`getSyncState`, ~:32-40)
- Test: `apps/user-client/tests/sync/watermark.heal.test.ts` (create)

**Interfaces:**
- Produces: `getSyncState()` — same signature `(): Promise<SyncStateRow>`, but a persisted row missing optional fields is returned with defaults merged in and the merge persisted once.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { getClientDataDb, _resetClientDataDbForTests } from '../../src/boot/client-data-db.js';
import { getSyncState } from '../../src/sync/watermark.js';

describe('getSyncState heal', () => {
  beforeEach(async () => { await _resetClientDataDbForTests(); });

  it('heals a legacy row missing the backfill fields', async () => {
    const db = getClientDataDb();
    // A pre-backfill-feature row: only the fields that existed then.
    await db.syncState.add({ id: 'state', epoch: 'e1', watermarkRev: 5 } as never);
    const state = await getSyncState();
    expect(state.backfillPending).toBe(false); // healed, not undefined
    expect(state.backfillTotal).toBeNull();
    expect(state.backfillDone).toBeNull();
    // persisted, not just returned:
    const raw = await db.syncState.get('state');
    expect(raw?.backfillPending).toBe(false);
    // untouched fields preserved:
    expect(state.epoch).toBe('e1');
    expect(state.watermarkRev).toBe(5);
  });

  it('leaves a complete row unchanged', async () => {
    const db = getClientDataDb();
    await db.syncState.add({ ...(await getSyncState()), backfillPending: true });
    const state = await getSyncState();
    expect(state.backfillPending).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/sync/watermark.heal.test.ts`
Expected: FAIL — first case returns `backfillPending: undefined`.

- [ ] **Step 3: Implement the heal in `getSyncState`**

In `watermark.ts`, replace the `if (existing) return existing;` fast-path with a heal: compute `defaultState()`, and if any key on the default is missing from `existing` (`existing[k] === undefined`), merge and persist once.

```ts
export async function getSyncState(): Promise<SyncStateRow> {
  const db = getClientDataDb();
  const existing = await db.syncState.get(STATE_ID);
  if (existing) {
    const defaults = defaultState();
    const patch: Partial<SyncStateRow> = {};
    for (const key of Object.keys(defaults) as (keyof SyncStateRow)[]) {
      if (existing[key] === undefined) (patch as Record<string, unknown>)[key] = defaults[key];
    }
    if (Object.keys(patch).length > 0) {
      await db.syncState.update(STATE_ID, patch);
      return { ...existing, ...patch };
    }
    return existing;
  }
  const seed = defaultState();
  await db.syncState.add(seed).catch(() => undefined);
  return (await db.syncState.get(STATE_ID)) ?? seed;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run tests/sync/watermark.heal.test.ts` — Expected: PASS.

- [ ] **Step 5: Gate + commit**

```bash
pnpm typecheck --force
git add apps/user-client/src/sync/watermark.ts apps/user-client/tests/sync/watermark.heal.test.ts
git commit -m "Heal legacy syncState rows missing optional fields"
```

---

## Task 2 — Arm the backfill on any un-transferred corpus (Unit 1b)

**Files:**
- Modify: `apps/user-client/src/sync/backfill.ts` (add exported `armBackfillIfCorpusUnsynced`)
- Modify: the boot site that registers the engine (`apps/user-client/src/boot/server-foundation.ts` — grep for `_setBackfill`/`runBackfillIfPending` wiring; call the new fn once after link status is resolved and before/at the first cycle)
- Test: `apps/user-client/tests/sync/backfill.arm.test.ts` (create)

**Interfaces:**
- Consumes: `listUnsyncedKeys` (already in `backfill.ts`), `getSyncState`/`db.syncState`, `useAccountLinkStore.getState().linkStatus`.
- Produces: `armBackfillIfCorpusUnsynced(): Promise<void>` — if linked and `backfillPending !== true` and any collection in `BACKFILL_ORDER` yields an un-synced key, sets `backfillPending: true` (and leaves `backfillTotal/backfillDone` null so `runBackfillIfPending` snapshots the total on its next run). Idempotent; a no-op when local-only, already-armed, or fully synced.

- [ ] **Step 1: Write the failing test** — cover three cases: linked + un-synced rows → arms; linked + fully synced → stays false; already `backfillPending: true` → untouched. Mock `useAccountLinkStore` linkStatus and seed `personas`/`syncRows` to construct the states. Use `_setVectorKeysSource(async () => [])` so the embeddings engine never loads.

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { getClientDataDb, _resetClientDataDbForTests } from '../../src/boot/client-data-db.js';
import { armBackfillIfCorpusUnsynced, _setVectorKeysSource, _resetBackfillForTests } from '../../src/sync/backfill.js';
import { useAccountLinkStore } from '@chatsundere/ui-shared';

describe('armBackfillIfCorpusUnsynced', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    _setVectorKeysSource(async () => []);
    useAccountLinkStore.setState({ linkStatus: 'linked' } as never);
  });

  it('arms when a linked device holds an un-synced row', async () => {
    const db = getClientDataDb();
    await db.personas.add({ id: 'p1', name: 'X' } as never); // no syncRows base, no outbox
    await armBackfillIfCorpusUnsynced();
    expect((await db.syncState.get('state'))?.backfillPending).toBe(true);
  });

  it('does not arm a fully-synced linked device', async () => {
    const db = getClientDataDb();
    await db.personas.add({ id: 'p1', name: 'X' } as never);
    await db.syncRows.put({ collection: 'personas', key: 'p1', rev: 1, ciphertextHash: '' });
    await armBackfillIfCorpusUnsynced();
    expect((await db.syncState.get('state'))?.backfillPending ?? false).toBe(false);
  });

  it('is a no-op when local-only', async () => {
    useAccountLinkStore.setState({ linkStatus: 'local-only' } as never);
    const db = getClientDataDb();
    await db.personas.add({ id: 'p1', name: 'X' } as never);
    await armBackfillIfCorpusUnsynced();
    expect((await db.syncState.get('state'))?.backfillPending ?? false).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm vitest run tests/sync/backfill.arm.test.ts` → FAIL (fn not exported).

- [ ] **Step 3: Implement `armBackfillIfCorpusUnsynced`** in `backfill.ts`:

```ts
export async function armBackfillIfCorpusUnsynced(): Promise<void> {
  if (useSessionStore.getState().mk === null) return;
  if (useAccountLinkStore.getState().linkStatus !== 'linked') return;
  const state = await getSyncState();
  if (state.backfillPending === true) return;
  for (const collection of BACKFILL_ORDER) {
    if ((await listUnsyncedKeys(collection)).length > 0) {
      await getClientDataDb().syncState.update(STATE_ID, {
        backfillPending: true, backfillTotal: null, backfillDone: null,
      });
      return;
    }
  }
}
```
Add the `useAccountLinkStore` import. Then wire a single call to `armBackfillIfCorpusUnsynced()` at the engine-boot site, after link status is known (guarded so it runs once per boot).

- [ ] **Step 4: Run to verify it passes** — Expected: PASS (all three cases).

- [ ] **Step 5: Gate + commit**

```bash
pnpm typecheck --force
git add apps/user-client/src/sync/backfill.ts apps/user-client/tests/sync/backfill.arm.test.ts apps/user-client/src/boot/server-foundation.ts
git commit -m "Arm backfill whenever a linked device holds un-transferred rows"
```

---

## Task 3 — `resetEngineStateForLocalOnly()` (Unit 2, reset primitive)

**Files:**
- Modify: `apps/user-client/src/sync/link-reset.ts`
- Test: `apps/user-client/tests/sync/link-reset.local-only.test.ts` (create)

**Interfaces:**
- Produces: `resetEngineStateForLocalOnly(): Promise<void>` — clears `syncRows`, `syncOutbox`, and sets `syncState` `{ epoch: null, watermarkRev: 0, lastSyncAt: null, pulling: null, attention: null, backfillPending: false, backfillTotal: null, backfillDone: null, linkedServerUserId: undefined }`. Does NOT arm (local-only has no engine).

- [ ] **Step 1: Write the failing test** — seed `syncRows`, `syncOutbox`, and a linked `syncState` (epoch/watermark set, `backfillPending: true`); after the call, both tables are empty and `syncState` is back to local-only defaults.

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { getClientDataDb, _resetClientDataDbForTests } from '../../src/boot/client-data-db.js';
import { resetEngineStateForLocalOnly } from '../../src/sync/link-reset.js';

describe('resetEngineStateForLocalOnly', () => {
  beforeEach(async () => { await _resetClientDataDbForTests(); });
  it('clears all transfer-state to local-only defaults', async () => {
    const db = getClientDataDb();
    await db.syncRows.put({ collection: 'personas', key: 'p1', rev: 3, ciphertextHash: 'h' });
    await db.syncOutbox.add({ collection: 'personas', key: 'p1', op: 'upsert', enqueuedAt: 1 } as never);
    await db.syncState.put({ id: 'state', epoch: 'e', watermarkRev: 9, lastSyncAt: null, pulling: null, attention: null, backfillPending: true, backfillTotal: 2, backfillDone: 1 } as never);
    await resetEngineStateForLocalOnly();
    expect(await db.syncRows.count()).toBe(0);
    expect(await db.syncOutbox.count()).toBe(0);
    const s = await db.syncState.get('state');
    expect(s).toMatchObject({ epoch: null, watermarkRev: 0, backfillPending: false, backfillTotal: null, backfillDone: null });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (fn not exported).

- [ ] **Step 3: Implement** — mirror `resetEngineStateForNewLink` but with `backfillPending: false` and clearing `linkedServerUserId`:

```ts
export async function resetEngineStateForLocalOnly(): Promise<void> {
  const db = getClientDataDb();
  await getSyncState();
  await db.transaction('rw', db.syncRows, db.syncOutbox, db.syncState, async () => {
    await db.syncRows.clear();
    await db.syncOutbox.clear();
    await db.syncState.update('state', {
      epoch: null, watermarkRev: 0, lastSyncAt: null, pulling: null, attention: null,
      backfillPending: false, backfillTotal: null, backfillDone: null,
      linkedServerUserId: undefined,
    });
  });
}
```

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Gate + commit**

```bash
pnpm typecheck --force
git add apps/user-client/src/sync/link-reset.ts apps/user-client/tests/sync/link-reset.local-only.test.ts
git commit -m "Add resetEngineStateForLocalOnly for decouple/offline"
```

---

## Task 4 — Tag transfer-state with server identity (Unit 2, server-switch guard)

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts` — add `linkedServerUserId?: string` to the `SyncStateRow` interface (~:575-588). No `stores()` change (non-indexed field), so **no** Dexie version bump; Task 1's heal covers absence.
- Modify: `apps/user-client/src/sync/link-reset.ts` — `resetEngineStateForNewLink()` stamps `linkedServerUserId` from the linked account's `server_user_id`.
- Modify: `apps/user-client/src/sync/worker.ts` — in `runSyncCycle`, before `drainOutbox`, if the stamped `linkedServerUserId` differs from the current linked identity, force `resetEngineStateForNewLink()` + `armBackfillIfCorpusUnsynced()` first.
- Test: `apps/user-client/tests/sync/server-identity.test.ts` (create)

**Interfaces:**
- Consumes: `getLinkedAccount(getDb())` → `server_user_id`, or the account-link store identity. Decide one source at implement time and use it consistently in both the stamp and the guard (they must agree).
- Produces: `SyncStateRow.linkedServerUserId?: string`.

- [ ] **Step 1: Write the failing test** — stamp identity `A`; simulate the store/linked-account now being `B`; assert the cycle-start guard detects the mismatch and triggers a reset+arm (spy the reset, or assert `syncRows` cleared + `backfillPending` armed). Keep the test focused on the guard predicate — mock the linked-account read.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — add the field; in `resetEngineStateForNewLink` add `linkedServerUserId: <server_user_id>` to the `update`; in `worker.ts` add the guard at the top of `runSyncCycle` (after `canRunCycle`). Read the current identity once; compare to `(await getSyncState()).linkedServerUserId`; on mismatch run reset+arm and continue.

- [ ] **Step 4: Run to verify it passes.**

- [ ] **Step 5: Gate + commit**

```bash
pnpm typecheck --force
git add apps/user-client/src/boot/client-data-db.ts apps/user-client/src/sync/link-reset.ts apps/user-client/src/sync/worker.ts apps/user-client/tests/sync/server-identity.test.ts
git commit -m "Tag sync transfer-state with server identity and reset on mismatch"
```

---

## Task 5 — Auth logout client wrapper (Unit 3/4 shared)

**Files:**
- Create: `apps/user-client/src/lib/auth-logout.ts`
- Test: `apps/user-client/tests/lib/auth-logout.test.ts` (create)

**Interfaces:**
- Produces: `logoutCurrentSession(): Promise<boolean>` — POSTs `/api/v1/auth/logout` on the auth origin with bearer auth (reuse `apiFetch`, `authMode: 'bearer'`, `origin: 'background'` per the sync worker's pattern). Returns `true` on success, `false` on any failure (never throws — callers treat it best-effort).

- [ ] **Step 1: Write the failing test** — inject/mocks the fetch transport; assert it calls `POST .../api/v1/auth/logout`, returns `true` on 2xx and `false` on throw. (Follow the existing `apiFetch` test seams; read `apps/user-client/src/lib/fetch.ts` for the exact call shape and auth-base resolution.)

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** the thin wrapper around `apiFetch`, resolving the auth base URL the same way the client's refresh path does (`fetch.ts`). Confirm the server route contract at `apps/auth-service/src/routes/auth.ts:20` (bearer-auth, clears the refresh cookie, deny-lists the session) — no request body required.

- [ ] **Step 4: Run to verify it passes.**

- [ ] **Step 5: Gate + commit**

```bash
pnpm typecheck --force
git add apps/user-client/src/lib/auth-logout.ts apps/user-client/tests/lib/auth-logout.test.ts
git commit -m "Add best-effort logoutCurrentSession auth wrapper"
```

---

## Task 6 — Decouple-device sequence (Unit 3, logic)

**Files:**
- Create: `apps/user-client/src/lib/decouple-device.ts`
- Test: `apps/user-client/tests/lib/decouple-device.test.ts` (create)

**Interfaces:**
- Consumes: `logoutCurrentSession` (Task 5), `deleteLinkedAccount` (`@chatsundere/crypto`), `useAccountLinkStore.getState().setLocalOnly`, `resetEngineStateForLocalOnly` (Task 3).
- Produces: `decoupleDevice(): Promise<{ sessionRevoked: boolean }>` — runs: (1) `logoutCurrentSession()` (best-effort, capture result), (2) `deleteLinkedAccount(getDb())`, (3) `setLocalOnly()`, (4) `resetEngineStateForLocalOnly()`. Steps 2-4 always run even if step 1 returns false. Returns whether the session was revoked so the UI can show the constructive fallback note.

- [ ] **Step 1: Write the failing test** — happy path: all four run, returns `{ sessionRevoked: true }`, linked-account row gone, store local-only, transfer-state cleared, a seeded user-data row (`personas`) still present. Failure path: `logoutCurrentSession` returns false → steps 2-4 still complete, returns `{ sessionRevoked: false }`.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** the ordered sequence; wrap step 1 so a false/throw never blocks 2-4.

- [ ] **Step 4: Run to verify it passes.**

- [ ] **Step 5: Gate + commit**

```bash
pnpm typecheck --force
git add apps/user-client/src/lib/decouple-device.ts apps/user-client/tests/lib/decouple-device.test.ts
git commit -m "Add decoupleDevice sequence (logout, unlink, local-only, reset)"
```

---

## Task 7 — Decouple UI + dynamic badge (Unit 3, surface)

**Files:**
- Modify: `apps/user-client/src/routes/app/account/server-linking.tsx` — add an "End this link" section in the `linked` state (below `AddDeviceSection`, ~:130) with a typed-phrase confirm (`decouple`) calling `decoupleDevice()`.
- Modify: `apps/user-client/src/routes/app/account.tsx` — badge at :158-159 reads `useAccountLinkStore(s => s.linkStatus)` (Linked/Local-only/Checking); Server-linking tile meta (:189) broadened to acknowledge unlink.
- Modify: `apps/user-client/src/lib/copy.ts` — add `serverLinking.decouple*` strings + the typed phrase `decouple`. British English.
- Test: `apps/user-client/tests/routes/server-linking.decouple.test.tsx` (create) — component/interaction test.

**Interfaces:**
- Consumes: `decoupleDevice` (Task 6), `useAccountLinkStore`.

- [ ] **Step 1: Write the failing interaction test** — render the linked `ServerLinkingPage`; the Decouple button is present with heading "End this link"; the confirm control is disabled until the phrase `decouple` is typed; on confirm it calls the (mocked) `decoupleDevice` and the surface reflects the local-only flip. Assert the constructive not-signout copy is present.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** the section + confirm + copy + dynamic badge. Follow the existing typed-phrase pattern in `apps/user-client/src/routes/login/start-over.tsx` (`:27,63`) for the gate. Success state: rely on the store flip to `local-only` (the page already renders the re-link CTA), and show the reassuring completion copy; on `{ sessionRevoked: false }` show the constructive "session will expire on its own · retry" note (spec §5.3).

- [ ] **Step 4: Run to verify it passes** — plus verify at 380 px (manual, spec §10) the button is not buried under the pairing block.

- [ ] **Step 5: Gate + commit**

```bash
pnpm typecheck --force
git add apps/user-client/src/routes/app/account/server-linking.tsx apps/user-client/src/routes/app/account.tsx apps/user-client/src/lib/copy.ts apps/user-client/tests/routes/server-linking.decouple.test.tsx
git commit -m "Add Decouple-this-device flow and dynamic link badge"
```

---

## Task 8 — Completion-aware, all-surface wipe (Unit 4)

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts` — export `closeClientDataDb()` (prod sibling of `_resetClientDataDbForTests`, ~:1259-1268: `dbHandle?.close(); dbHandle = null;`).
- Modify: `apps/user-client/src/boot/knowledge-vectors-db.ts` — export `closeKnowledgeVectorsDb()` (`dbHandle?.close(); dbHandle = null; storeHandle = null; enginePromise = null;`).
- Modify: `apps/user-client/src/lib/wipe-device.ts` — close handles, delete completion-aware, clear localStorage/sessionStorage/Cache Storage/SW, logout, navigate last.
- Test: `apps/user-client/tests/lib/wipe-device.test.ts` (create)

**Interfaces:**
- Consumes: `closeClientDataDb`, `closeKnowledgeVectorsDb`, `logoutCurrentSession` (Task 5), `Dexie.delete`.

- [ ] **Step 1: Write the failing test** — the reproduction of the bug: open `chatsundere_client_data` via `getClientDataDb()`, seed a `personas` row, call `wipeDevice()` (stub `window.location.assign` and Cache/SW APIs), then re-open the DB and assert `personas` is **empty/absent**. Also assert `localStorage`/`sessionStorage` cleared and `logoutCurrentSession` called. (The current impl leaves the persona → this test fails first.)

- [ ] **Step 2: Run to verify it fails** — the surviving-persona bug reproduces.

- [ ] **Step 3: Implement** the new `wipeDevice`:

```ts
export async function wipeDevice(): Promise<void> {
  await logoutCurrentSession();               // best-effort session revoke (decision C)
  useSessionStore.getState().closeAndForget(); // zero the in-memory MK
  closeClientDataDb();                         // release the permanent Dexie handles FIRST
  closeKnowledgeVectorsDb();
  await Dexie.delete('chatsundere_client_data'); // completion-aware
  await Dexie.delete('chatsundere-knowledge-vectors');
  await deleteRawDb('chatsundere');            // crypto DB: no resolve-on-blocked
  await clearNonIndexedDbSurfaces();           // localStorage, sessionStorage, Cache Storage, SW
  window.location.assign('/onboarding');       // only after everything completed
}
```
`deleteRawDb`: an `indexedDB.deleteDatabase` promise that resolves on `onsuccess`, rejects/retries on `onblocked` (NOT resolve). `clearNonIndexedDbSurfaces`: `localStorage.clear(); sessionStorage.clear();` then `if (globalThis.caches) for (const k of await caches.keys()) await caches.delete(k);` then `(await navigator.serviceWorker?.getRegistrations() ?? []).forEach(r => r.unregister())` — each guarded for the jsdom/Node test env.

- [ ] **Step 4: Run to verify it passes** — the persona is gone; surfaces cleared; logout called.

- [ ] **Step 5: Gate + commit**

```bash
pnpm typecheck --force
git add apps/user-client/src/boot/client-data-db.ts apps/user-client/src/boot/knowledge-vectors-db.ts apps/user-client/src/lib/wipe-device.ts apps/user-client/tests/lib/wipe-device.test.ts
git commit -m "Make wipeDevice a completion-aware, all-surface erase with session revoke"
```

---

## Post-implementation (Liz, not a subagent)

- Run the full suite: `cd apps/user-client && pnpm vitest run` — expect the known 8-failure baseline, nothing new.
- `pnpm typecheck --force` at the repo root.
- **Larissa** audit on Units 2/3/4 (crypto DBs + auth session + wipe trust claim). **Laura** pre-squash pass on Unit 3.
- Manual verification (spec §10) on device — Chris runs the four scenarios.
- Squash per spec §9: (1) Unit 1 · (2) Units 2+3 · (3) Unit 4. Do NOT merge back to `full-backend-transition` until Chris says so (his live test session).

## Self-review notes

- **Spec coverage:** Unit 1 → Tasks 1–2; Unit 2 → Tasks 3–4; Unit 3 → Tasks 5–7; Unit 4 → Task 8 (+ shared Task 5). Session-revoke (decision C) → Task 5 consumed by Tasks 6 & 8. Dynamic badge + tile meta + copy → Task 7. All spec sections mapped.
- **Type consistency:** `armBackfillIfCorpusUnsynced`, `resetEngineStateForLocalOnly`, `logoutCurrentSession`, `decoupleDevice`, `closeClientDataDb`, `closeKnowledgeVectorsDb`, `SyncStateRow.linkedServerUserId` — each named identically where consumed.
- **Ordering:** primitives (Tasks 1,3,5) precede consumers (2,4,6,7,8); `logoutCurrentSession` (5) precedes decouple (6) and wipe (8), per import-dependency order.
- **Open implementation choice (Task 4):** the server-identity source (linked-account IDB `server_user_id` vs account-link store) — pick one, use it in both stamp and guard.
