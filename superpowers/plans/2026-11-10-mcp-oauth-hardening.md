# Hardening OAuth grants for MCP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close Larissa's L2, L4 and L3-remainder deferrals of 2026-11-03: rollback protection for OAuth grants via a sealed monotonic `generation`, size padding of grant records, and a confirmation line when the sign-in details came through the user's Chatsundere server.

**Architecture:** One pure module (`mcp/oauth/grant-generation.ts`) owns every generation rule (next generation, the refusal verdict, the liveness helper). The sync layer (`sync/apply.ts`, `sync/worker.ts`, `sync/link-reset.ts`, `sync/strip.ts`) calls it on every read and acknowledgement path; the refresh algorithm (`ensure-token.ts`, `grant-publish.ts`, `sign-in.ts`) calls it on every write and checks the hold at every snapshot. The UI reads the hold through the one liveness helper.

**Tech Stack:** TypeScript strict, Dexie, Vitest (user-client), Bun test (crypto), React 18.

**Spec:** `superpowers/specs/2026-11-10-mcp-oauth-hardening-design.md` (cited as *the spec*). Brief: `superpowers/overnighter/2026-11-10-mcp-oauth-hardening-brief.md`. Parent: `superpowers/specs/2026-11-02-mcp-oauth-design.md` §5, §9.

## Global Constraints

- British English everywhere in the repo (code, comments, identifiers, copy, commit messages).
- Copy from the spec is verbatim and final (§3, §5.4, §5.5, §6, §9). Exact strings are repeated in the tasks that use them.
- New files under `apps/` start with `// SPDX-License-Identifier: AGPL-3.0-only`; under `packages/crypto/` with `// SPDX-License-Identifier: LGPL-3.0-only`.
- Strict TS with `noUncheckedIndexedAccess`; no `any` without an inline reason. Package-public functions get a one-line JSDoc. Comments explain why, not what. Biome lints.
- No token, code or verifier in `console.*`, error messages, assertions' failure text, or the report.
- Not touched: `apps/auth-service`, `apps/sync-service`, `apps/proxy-service`, `packages/shared-types`. No Dexie version bump (all new fields optional, read with defaults).
- Row field names fixed by the spec: `generation`, `seenGeneration`, `heldGeneration`. New `EnsureResult` reason: `'held'`. New notice variant: `'held'`. New `OAuthDiscovery` field: `viaProxy: boolean`.
- Never present a refresh token the device did not win; never discard tokens it may be the only holder of (parent spec §5).
- Subagents never commit, merge, push or switch branches. Work stays uncommitted for the controller.
- Mutation discipline: `git add` the work first, then break the code, watch the named test fail, `git checkout -- <file>` to restore.

## Review Focus

1. **Hold appearing mid-loop.** A claim conflict adopts a refused `current` (or a stale one whose revision was already refused): the loop must return `held` at the next snapshot, never push a claim over the refused revision. Pinned in Task 6, test "claim conflict with an older current returns held and pushes nothing more".
2. **Ack lost after epoch recovery.** The recovery drain fails, so recovery re-runs (`sync/recovery.ts:276-279`: a drain failure throws before the epoch persist). The re-run's pull-all serves the device's own gen-9 record: it must apply (equal generation) and clear the hold, and the coalesced entries must push `ok`, leaving the outbox empty. Pinned in Task 4, test "a failed recovery drain heals on the re-run and leaves no conflicting entry".
3. **New sign-in while held with a server-side generation higher than local seen.** `max(seen, base)+1` must use the opened `current`'s generation on conflict. Pinned in Task 5, test "new family re-push after conflict stamps max(seen, current)+1".
4. **Legacy rows without any generation field** on both sides (v0.3.5 → v0.3.6 upgrade): equal 0 must apply, never hold. Pinned in Task 2 ("absent generations read as 0 and apply") and Task 3.
5. **Proxy-only metadata with no proxy** (direct `TypeError`, `hasProxy` false): well-known guesses read as missing (`no-oauth`), the pointer throws the network error, and `viaProxy` stays false. Pinned in Task 8.

---

## Decisions taken in this plan (brief "Open points")

- **D-1 acknowledgement mechanics.** Direct pushes carry `generation`, `seenGeneration` and `heldGeneration: null` in the pushed row (`stampForPush`); `pushRecordDirect` already writes the pushed row wholesale on `ok`, and `stripForSeal` removes the two device-local fields before sealing (Task 2 adds them to the deny-list and a test proves they never reach the sealed form). The in-memory `claimed` row is the stamped row, so release and `invalid_grant` pushes become claim + 1. Outbox acknowledgements go through `applyOk`, which gets the pushed generation from a new `PreparedRecord.grantGeneration` field set at seal time.
- **D-2 hold check location.** A `blocked(row)` check at every snapshot in `linkedFlow` (top of each iteration and after step 3), inside `publishPending` at entry and on every conflict, and after every adopt (adopt outcome `'refused'` returns `held`; `adoptedOr` re-checks the hold).
- **D-3 status order.** Dead (`tokens === null && !pendingTokens`) first, then held, then the rest — via `isGrantDead` / `isGrantHeld`, with `isGrantLive` for the pills and panel.
- **D-4 query refresh.** A refusal collects `QK.mcpOAuthGrants` in `applyUpsert`; a hold cleared by a direct `ok` or an outbox `ok` invalidates it too (collect + flush).
- **D-5 names.** The link-generation local/parameter is renamed `linkGeneration` in `pushRecordDirect`, the drain, `applyOk`, `applyConflict` and their siblings that take it; local `held` in `McpAuthNotice.tsx` renamed to `granted`. Harness `PENDING_DEFAULTS` → `LOCAL_DEFAULTS`, `stripPending` → `stripLocal` (callers incl. `CasServer.push`, `grant-harness.ts:45`).
- **D-6 anchors.** Anchors below are as of `e728f28`; trust the code.
- **D-7 refused revision vs. recovery.** A refusal records the refused revision in `syncRows` (rev update when meta exists, `put` with the refused ciphertext hash when absent), no outbox entry. A recovery repush then pushes cleanly over that revision; its `ok` clears the hold in `applyOk`. If the recovery drain fails, recovery re-runs (it clears `syncRows`), and its pull-all applies our own record at equal generation, clearing the hold. For an ordinary (non-recovery) outbox entry whose ack is lost, the drain conflict triggers a pull; the stored hash is not that of our own record, so it is no echo, it applies, and the leftover entry then pushes against the right revision.
- **D-9 mid-refresh hold.** If a refusal lands between a won claim and its publish, the fresh pair stays pending (spec blocks the ordinary publish) and our claim stays on the server row; the claim is deliberately **not** released, since that would invite another device to present the spent token at once. After the lease another device may present the spent token and end in `invalid_grant`; the exit is *Sign in again*. Flagged for Larissa to rate.
- **D-10 sign-in over an ordinary pending pair.** `storeGrant` replaces the row and today drops an ordinary pending pair (a live refresh token only this device holds) without revoking it; the hold makes that window long. Before `putLocal`, revoke the old ordinary pending pair best-effort (as `revokePair` in `grant-publish.ts` does; export a helper for it). A new-family pending pair is not revoked (pre-existing behaviour unchanged).
- **D-8 metadata fallback.** "Network error" is a `TypeError` from the fetch or body read, as in `getAs`. The pointer path stops catching everything: a non-`TypeError` direct failure throws the network `OAuthError` with no proxy attempt.

---

## File structure

| File | Responsibility |
|---|---|
| `packages/crypto/src/sync-envelope/seal.ts` | `PADDED_COLLECTIONS` gains `mcpOAuthGrants` |
| `apps/user-client/src/mcp/oauth/grant-generation.ts` (new) | Pure generation rules + liveness helpers |
| `apps/user-client/src/boot/client-data-db.ts` | Three optional row fields |
| `apps/user-client/src/sync/strip.ts` | Deny-list + fresh-device defaults |
| `apps/user-client/src/sync/apply.ts` | Refusal / accept on pull, `refused` outcome, invalidation |
| `apps/user-client/src/sync/seal-batch.ts`, `sync/worker.ts` | `grantGeneration` on prepared records; outbox ack; direct-ack invalidation |
| `apps/user-client/src/sync/link-reset.ts` | Reset seen/held on both reset paths |
| `apps/user-client/src/mcp/oauth/grant-store.ts` | `adopt` returns `AdoptOutcome` |
| `apps/user-client/src/mcp/oauth/grant-publish.ts`, `ensure-token.ts`, `sign-in.ts` | Stamping and hold |
| `apps/user-client/src/mcp/mcp-tools.ts`, `mcp/oauth/connect-server.ts`, `mcp/types.ts`, `routes/app/integrations/server.tsx` | Model wording, *Test connection* |
| `apps/user-client/src/mcp/server-status.ts`, `components/mcp/OAuthConnectionPanel.tsx`, `components/mcp/McpAuthNotice.tsx` | The three UI surfaces |
| `apps/user-client/src/mcp/oauth/discovery.ts`, `components/mcp/SignInScreens.tsx`, `components/mcp/OAuthSignInFlow.tsx` | L3 |
| `apps/user-client/tests/mcp/oauth/grant-harness.ts` + `ensure-token.test.ts` | Simulation uses the shared refusal |

---

### Task 0: Baseline

- [ ] **Step 1:** `SHARP_IGNORE_GLOBAL_LIBVIPS=1 pnpm install --frozen-lockfile`
- [ ] **Step 2:** Run `pnpm typecheck --force`, `pnpm run build --force`, `pnpm lint`, `pnpm exec turbo run test --continue --force`. Record exact counts per package and every failure.
- [ ] **Step 3:** Compare with the brief's known state (typecheck 14/14, build 9/9, lint clean 1871 files; crypto 227, llm-unified 509, proxy-service 89, shared-types 7, embeddings 68, ui-shared 78, admin-client 71, user-client 4292/4293; auth-service ECONNREFUSED; sync-service 39/24/5). Confirm each user-client failure as a flake with `pnpm --filter @chatsundere/user-client exec vitest run <file>`. No commit (results go to the report).

### Task 1: L4 — pad grant records

**Files:** Modify `packages/crypto/src/sync-envelope/seal.ts:15-20`; Test `packages/crypto/tests/sync-envelope/seal.test.ts:81`.

**Interfaces:** Produces `PADDED_COLLECTIONS.has('mcpOAuthGrants') === true`.

- [ ] **Step 1: Failing tests** in `seal.test.ts`:
  - In "pads padded collections only": `expect(PADDED_COLLECTIONS.has('mcpOAuthGrants')).toBe(true)` and a sealed `mcpOAuthGrants` row `{ id: 'g1', tokens: null }` has `(ciphertext.length - 16) % 1024 === 0`.
  - New `it('opens an unpadded grant record sealed before padding')`: build the legacy record by hand with the same AAD/DEK as `sealRecord` but plaintext `encodeRow`-style 4-byte length prefix + JSON without padding (import `computeBlindId`, `deriveDek`, `encodeRow` from `../../src/index.js`; reproduce `buildAad` and `deriveDek(mk, 'sync/collection/mcpOAuthGrants-v1')` in the test), then `openRecord(mk, 'mcpOAuthGrants', blindId, record, (r) => r.id)` returns the row.
- [ ] **Step 2:** `pnpm --filter @chatsundere/crypto test` → FAIL on set membership.
- [ ] **Step 3:** Add `'mcpOAuthGrants'` to the set; extend the set's doc comment with why (token kind by size, spec §4).
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5: Mutations:** remove the entry → set test fails; make `unpadPlaintext` require padding (e.g. assert `length % 1024 === 0` temporarily) → legacy test fails. Restore each.
- [ ] **Step 6: Commit** `Pad MCP OAuth grant records`.

### Task 2: Generation rules, row fields and strip discipline

**Files:** Create `apps/user-client/src/mcp/oauth/grant-generation.ts`; Modify `src/boot/client-data-db.ts:168-193` (`McpOAuthGrantRow`), `src/sync/strip.ts:95-139`, `tests/mcp/oauth/grant-harness.ts` (`PENDING_DEFAULTS`, `stripPending`); Test: create `tests/mcp/oauth/grant-generation.test.ts`, extend the existing `stripForSeal` test file (`grep -rln stripForSeal apps/user-client/tests/sync` → use that path in the command).

**Interfaces — Produces** (all exported from `grant-generation.ts`, each with one-line JSDoc):
```ts
type GenerationFields = Pick<McpOAuthGrantRow, 'generation' | 'seenGeneration' | 'heldGeneration'>;
export function generationOf(row: { generation?: number } | null | undefined): number; // absent = 0
export function seenOf(row: { seenGeneration?: number } | null | undefined): number;   // absent = 0
export function nextGeneration(local: GenerationFields, baseGeneration: number): number; // max(seen, base) + 1
export function stampForPush(row: McpOAuthGrantRow, baseGeneration: number): McpOAuthGrantRow;
  // { ...row, generation: g, seenGeneration: g, heldGeneration: null }, g = nextGeneration(row, base)
export type PulledGrantVerdict = { kind: 'apply' } | { kind: 'refuse'; heldGeneration: number };
export function judgePulledGrant(local: GenerationFields | undefined, pulled: { generation?: number }): PulledGrantVerdict;
  // no local → apply; generationOf(pulled) >= seenOf(local) → apply; else refuse with heldGeneration = generationOf(pulled)
export function acceptedFields(local: GenerationFields | undefined, pulled: { generation?: number }): { seenGeneration: number; heldGeneration: null };
  // seenGeneration = max(seenOf(local), generationOf(pulled))
export function ackFields(local: GenerationFields, pushedGeneration: number): { seenGeneration: number; heldGeneration: null } | null;
  // outbox ack: pushed >= seenOf(local) → { max(seen, pushed), null }; else null (change nothing)
export function isGrantHeld(row: GenerationFields): boolean;     // heldGeneration != null
export function isGrantDead(row: Pick<McpOAuthGrantRow,'tokens'|'pendingTokens'>): boolean; // tokens === null && !pendingTokens
export function isGrantLive(row: McpOAuthGrantRow | undefined): boolean; // defined, !held, !dead
```
Row fields on `McpOAuthGrantRow` (JSDoc each with spec §5.1 meaning): `generation?: number`, `seenGeneration?: number`, `heldGeneration?: number | null`.

- [ ] **Step 1: Failing tests** `grant-generation.test.ts`:
  - `nextGeneration({ seenGeneration: 9 }, 4) === 10`; `nextGeneration({}, 7) === 8`; `nextGeneration({ seenGeneration: 3 }, 7) === 8`.
  - `stampForPush(row{generation:7, seenGeneration:7, heldGeneration:4}, 7)` → `generation 8, seenGeneration 8, heldGeneration null`, other fields equal.
  - "absent generations read as 0 and apply": `judgePulledGrant({}, {})` → `apply`.
  - `judgePulledGrant({ seenGeneration: 9 }, { generation: 4 })` → `{ kind: 'refuse', heldGeneration: 4 }`; `{generation: 9}` → apply; `judgePulledGrant(undefined, { generation: 0 })` → apply.
  - `ackFields({ seenGeneration: 9 }, 9)` → `{ seenGeneration: 9, heldGeneration: null }`; `ackFields({ seenGeneration: 9 }, 4)` → `null`.
  - `isGrantLive`: tokens + held null → true; tokens + held 4 → false; tokens null + pending blob → true; undefined → false. `isGrantDead`/`isGrantHeld` table.
  - strip test: `stripForSeal('mcpOAuthGrants', { id, generation: 3, seenGeneration: 9, heldGeneration: 4, ... })` keeps `generation`, drops `seenGeneration` and `heldGeneration`; `restoreLocalFields('mcpOAuthGrants', pulled, undefined)` gives `seenGeneration: 0, heldGeneration: null`; with a local row `{seenGeneration: 9, heldGeneration: 4}` they are restored from local.
- [ ] **Step 2:** `pnpm --filter @chatsundere/user-client exec vitest run tests/mcp/oauth/grant-generation.test.ts tests/sync/strip.test.ts` → FAIL (module missing / fields kept).
- [ ] **Step 3:** Implement module; add the fields; in `strip.ts` add `'seenGeneration', 'heldGeneration'` to the `mcpOAuthGrants` deny-list with a why comment (another device's high-water mark must never count here), and `seenGeneration: 0, heldGeneration: null` to `FRESH_DEVICE_DEFAULTS.mcpOAuthGrants`. In the harness: rename `PENDING_DEFAULTS` → `LOCAL_DEFAULTS` and add `seenGeneration: 0, heldGeneration: null`; rename `stripPending` → `stripLocal` stripping the two new fields too (callers: `CasServer.push` at `grant-harness.ts:45`, `ensure-token.test.ts`, `sign-in.test.ts`).
- [ ] **Step 4:** Same command → PASS; also `pnpm --filter @chatsundere/user-client exec vitest run tests/mcp/oauth` → PASS.
- [ ] **Step 5: Mutations:** `>=` → `>` in `judgePulledGrant` (equal case fails); drop `+ 1` in `nextGeneration`; drop `seenGeneration` from the deny-list (strip test fails). Restore each.
- [ ] **Step 6: Commit** `Add generation rules for OAuth grants`.

### Task 3: Refusal on pull (`applyUpsert`) and `GrantStore.adopt` outcome

**Files:** Modify `src/sync/apply.ts` (`ApplyOutcome` ~`:72`, `applyUpsert` ~`:767-940`, `restoreAppliedRow` ~`:947`), `src/mcp/oauth/grant-store.ts` (interface `adopt`, Dexie impl), `tests/mcp/oauth/ensure-token.test.ts` (`Device.adopt`), `tests/mcp/oauth/sign-in.test.ts` (its store `adopt` ~`:104`); Test: create `tests/sync/apply-grant-generation.test.ts` (Dexie-level, modelled on `tests/sync/push-record-direct.test.ts` setup: `fake-indexeddb/auto`, session MK, `_setOpenRecord`/real seal).

**Interfaces:**
- Consumes Task 2: `judgePulledGrant`, `acceptedFields`.
- Produces: `ApplyOutcome` gains `| { kind: 'refused' }`; `UpsertTxResult` gains `refused?: true`. `export type AdoptOutcome = 'adopted' | 'refused' | 'stale'` in `grant-store.ts`; `GrantStore.adopt(record): Promise<AdoptOutcome>`. Dexie mapping: `inserted` / `resolved` (pulled) → `adopted`; `refused` → `refused`; everything else (`echo`, `stale`, `rejected`, `tamper`, `suppressed`, `unavailable`, `skipped`, `tombstoned`) → `stale`; list this mapping in the `AdoptOutcome` JSDoc. The sign-in test store's `adopt` (`tests/mcp/oauth/sign-in.test.ts:~104`) calls `judgePulledGrant`/`acceptedFields`, records the revision and returns the outcome, like `Device.adopt`; its `push` writes `stripLocal`-ed bodies to the server side.

Behaviour in `applyUpsert`, inside the existing transaction, for `collection === 'mcpOAuthGrants'` when a local row exists, before `resolveConflict`: `judgePulledGrant(local, row)`; on `refuse` → `table.update(key, { heldGeneration })`, record the revision exactly as the local-wins branch does (meta present → `syncRows.update rev`; absent → `syncRows.put` with `localHash`), no outbox entry, return `{ outcome: { kind: 'refused' }, refused: true }`. After commit, `refused` → `collect(QK.mcpOAuthGrants)` (use `collectFor`). On apply (insert or pulled wins), `restoreAppliedRow` for `mcpOAuthGrants` overlays `acceptedFields(local, row)` after `restoreLocalFields`.

- [ ] **Step 1: Failing tests** `apply-grant-generation.test.ts`:
  - "refuses an older generation and leaves the local row unchanged": local row `{generation 9, seenGeneration 9, tokens T, pendingTokens P, pendingBaseRev 5, ...}` at syncRows rev 5; pull the same grant sealed with `generation 4` at rev 8 → outcome `refused`; local row deep-equals the old one except `heldGeneration: 4`; `syncRows` rev 8; `syncOutbox` empty; invalidator received `QK.mcpOAuthGrants`.
  - "applies an equal or higher generation and clears the hold": local `{seen 9, held 4}`; pull `generation 9` at rev 9 → `resolved`; row has pulled synced fields, `seenGeneration 9`, `heldGeneration null`, pending fields kept. Same for `generation 12` → seen 12.
  - "legacy rows apply": local without any generation fields, pulled without `generation` → applied, `seenGeneration 0`.
  - "a fresh device accepts and records seen": no local row, pulled gen 6 → inserted, seen 6.
  - Harness parity (in `ensure-token.test.ts`): `Device.adopt` returns `AdoptOutcome`, calls `judgePulledGrant`/`acceptedFields`, records the revision on refusal and sets `heldGeneration`; a unit test "device adopt refuses an older generation" drives it directly.
- [ ] **Step 2:** `pnpm --filter @chatsundere/user-client exec vitest run tests/sync/apply-grant-generation.test.ts` → FAIL.
- [ ] **Step 3:** Implement as described; update `Device.adopt` and the sign-in test store `adopt` to return outcomes (signature change). Keep `resolution.ts` unchanged (the pulled-wins rule still decides once accepted).
- [ ] **Step 4:** Run the new file plus `tests/sync tests/mcp/oauth` → PASS; `pnpm --filter @chatsundere/user-client typecheck` → clean.
- [ ] **Step 5: Mutations:** skip the `syncRows` revision record on refusal (rev assertion fails); skip `acceptedFields` overlay (clear-hold test fails); drop the invalidation (invalidator assertion fails).
- [ ] **Step 6: Commit** `Refuse older OAuth grant generations on pull`.

### Task 4: Acknowledgements — direct, outbox, recovery; link reset

**Files:** Modify `src/sync/seal-batch.ts:55-80,~140-180` (`PreparedRecord.grantGeneration?: number`, set from the raw row in `prepareRecord` when `collection === 'mcpOAuthGrants'`), `src/sync/worker.ts` (`pushRecordDirect` ~`:744-794`: rename local `generation` → `linkGeneration`; after a committed `ok` write for `mcpOAuthGrants`, collect + flush `QK.mcpOAuthGrants`; `applyOk` ~`:853`: add `db.mcpOAuthGrants` to the transaction scope and, when the meta was written and `prep.grantGeneration !== undefined`, apply `ackFields(row, prep.grantGeneration)` to the local row; invalidate after commit when it changed anything), `src/sync/link-reset.ts` (both reset bodies: in the same transaction, add `db.mcpOAuthGrants`, and for every row set `seenGeneration = generationOf(row)`, `heldGeneration = null`); Tests: extend `tests/sync/push-record-direct.test.ts`, create `tests/sync/grant-outbox-ack.test.ts` (drain-level, set up like `tests/sync/scenarios.test.ts`), extend `tests/sync/link-reset.test.ts`, `tests/sync/link-reset.local-only.test.ts`, and `tests/sync/recovery.test.ts`. `applyOk` adds `db.mcpOAuthGrants` to its transaction scope **only** when `prep.collection === 'mcpOAuthGrants'`, and applies `ackFields` whether or not the meta was written (it is monotone, so a stale ack still clears a hold it is entitled to clear) — but never when the ack is stale by link generation.

**Interfaces:** Consumes Task 2 `ackFields`, `generationOf`; Task 3's refusal. Produces nothing new for later tasks besides the behaviour.

- [ ] **Step 1: Failing tests:**
  - push-record-direct: "an ok writes generation, raises seen and clears the hold" — push `stampForPush(row{gen 7, seen 7, held 4}, 7)`; on ok the local row has `generation 8, seenGeneration 8, heldGeneration null`; the sealed plaintext (captured via `_setPushTransport` + open) has `generation 8` and **no** `seenGeneration`/`heldGeneration` keys. "a failed push leaves generation and seen untouched" — transport throws → local row unchanged.
  - drain: "an outbox ack at or above seen clears the hold, carrying the generation unchanged" — local `{gen 9, seen 9, held 4}` + outbox entry → sealed body has `generation 9`; ack → `held null`, seen 9. "an outbox ack below seen changes nothing" — local `{gen 4, seen 9, held 4}` → after ack `held 4`.
  - recovery: "an honest restore heals itself": local `{gen 9, seen 9}` synced at rev 20; recovery pulls the grant sealed at gen 4 (rev 3) → refused, then repush seals gen 9 at baseRev 3 → transport answers ok → local `held null`, outbox empty. "a failed recovery drain heals on the re-run and leaves no conflicting entry": the first recovery's drain push throws after the server stored our gen-9 record at rev 21; recovery re-runs, its pull-all applies our own gen-9 record (`held null`), the coalesced entries push at rev 21 with `ok`; outbox empty.
  - drain (`grant-outbox-ack.test.ts`): "an ordinary drain conflict with our own lost-ack record applies and pushes cleanly": entry pushed, ack lost, next drain conflicts with `current` = our record; pull applies it (no echo, hold cleared); leftover entry pushes `ok`; outbox empty.
  - invalidation: a direct `ok` for a grant and an outbox ack that clears a hold each hand `QK.mcpOAuthGrants` to the registered invalidator (`_setInvalidator` or the module's test seam).
  - link-reset: both reset functions set `seenGeneration` to the row's `generation` (row `{gen 6, seen 9, held 4}` → seen 6, held null; row without generation → seen 0) and never touch other fields.
- [ ] **Step 2:** `pnpm --filter @chatsundere/user-client exec vitest run tests/sync/push-record-direct.test.ts tests/sync/grant-outbox-ack.test.ts tests/sync/link-reset.test.ts tests/sync/link-reset.local-only.test.ts tests/sync/recovery.test.ts` → FAIL on the new tests.
- [ ] **Step 3:** Implement as listed. The outbox push carries the row's generation unchanged by construction (no stamping in the drain); `enqueueFullRepush`/`backfill` filters stay as they are.
- [ ] **Step 4:** `pnpm --filter @chatsundere/user-client exec vitest run tests/sync` → PASS.
- [ ] **Step 5: Mutations:** remove `seenGeneration`/`heldGeneration` from the deny-list (sealed-body assertion fails); skip `ackFields` in `applyOk` (heal test fails); set seen to 0 in link reset (link-reset test fails).
- [ ] **Step 6: Commit** `Acknowledge OAuth grant generations and heal on epoch recovery`.

### Task 5: Stamping every compare-and-set write; `storeGrant` keeps the mark

**Files:** Modify `src/mcp/oauth/ensure-token.ts` (claim ~`:312`, `releaseClaim` ~`:197`, `invalid` push ~`:232`), `src/mcp/oauth/grant-publish.ts` (`publishPending`: body stamped per attempt), `src/mcp/oauth/sign-in.ts` (`storeGrant` ~`:279-331`); Test: `tests/mcp/oauth/ensure-token.test.ts`, `tests/mcp/oauth/sign-in.test.ts`.

**Interfaces:** Consumes Task 2 `stampForPush`, `generationOf`, `seenOf`. Rules:
- claim: `claimed = stampForPush({ ...row, claim }, generationOf(row))` — the in-memory `claimed` carries the claim generation.
- release: `stampForPush({ ...claimed, claim: null }, generationOf(claimed))`; `invalid`: `stampForPush({ ...claimed, tokens: null, claim: null, updatedAt }, generationOf(claimed))`.
- publish (ordinary): first attempt base `generationOf(row)`; re-push after "nothing newer" uses `generationOf(current)`.
- publish (new family): first attempt base `generationOf(row)`; after a conflict, base = `generationOf(opened current)` when `store.open` returns a row, else `generationOf(row)`.
- `storeGrant`: carry `generation`, `seenGeneration`, `heldGeneration` from `snap?.row` into both the unlinked row and the pending row.
- D-10: export `revokeOrdinaryPending(row, mk, deps: PublishDeps): Promise<void>` from `grant-publish.ts` (wraps the existing `revokePair`, a no-op unless `row.pendingTokens` is set and `pendingNewFamily !== true`); `storeGrant` calls it on `snap.row` inside the lock before `putLocal`, best-effort (errors swallowed).
- Unlinked writes (`unlinkedFlow`, unlinked `publishPending`) leave `generation` as it is.

- [ ] **Step 1: Failing tests** (simulation):
  - "each push kind pushes max(seen, base)+1": a full refresh from row gen 7 → claim push gen 8, publish push gen 9; device's row ends `generation 9, seenGeneration 9`. Release after `failed` → gen 9 over claim 8. `invalid_grant` → `tokens null` push gen 9.
  - "a failed push leaves local generation and seen untouched": plan `['network']` on the claim → local row generation 7, seen 7.
  - "new family re-push after conflict stamps max(seen, current)+1": local seen 9, server at gen 12 under another rev → first push conflicts, second push gen 13.
  - In `tests/mcp/oauth/sign-in.test.ts`: "storeGrant keeps the high-water mark": local row `{gen 9, seen 9, held 4}`, the server at gen 4; complete a sign-in → pushed generation 10, hold cleared on ok; in a second test the store's `push` first delivers a gen-4 record through `adopt` (before answering) → it is refused (outcome `refused`, the local pending new-family pair intact) and the push still goes out with generation 10.
  - "new family falls back to the local generation when current does not open": conflict `current` is poison → re-push stamps `max(seen, local gen)+1`.
  - D-10, in `sign-in.test.ts`: "sign-in revokes an ordinary pending pair it replaces": local row holding an ordinary pending pair; sign-in → one revocation POST for that pair's refresh token (assert on the fake auth server's revocation log, never print the token); a new-family pending pair is not revoked.
  - "a v0.3.5-shaped push is accepted": another device `cas.put` of the row spread unchanged (same generation) with a new claim → device B pulls it → adopted.
- [ ] **Step 2:** `pnpm --filter @chatsundere/user-client exec vitest run tests/mcp/oauth/ensure-token.test.ts tests/mcp/oauth/sign-in.test.ts` → FAIL.
- [ ] **Step 3:** Implement the rules.
- [ ] **Step 4:** Same → PASS (all pre-existing tests stay green).
- [ ] **Step 5: Mutations:** use `{ ...claimed }` unstamped in release (gen 9 assertion fails); drop the carry-over in `storeGrant` (pushed 10 fails); use local base on new-family conflict (13 fails).
- [ ] **Step 6: Commit** `Raise the OAuth grant generation on every compare-and-set write`.

### Task 6: `held` in the refresh algorithm

**Files:** Modify `src/mcp/oauth/ensure-token.ts` (`EnsureResult` reason union `:41`, `linkedFlow`, `refreshUnderClaim`, `releaseClaim`, `adoptedOr`), `src/mcp/oauth/grant-publish.ts`; Test: `tests/mcp/oauth/ensure-token.test.ts`.

**Interfaces:** Consumes Task 3 `AdoptOutcome`, Task 2 `isGrantHeld`, `generationOf`, `seenOf`. Produces `EnsureResult` reason `'held'`. Internal helper in `ensure-token.ts`: `blocked(row) = isGrantHeld(row) && !(row.pendingTokens && row.pendingNewFamily === true)`.

Rules:
- `linkedFlow`: after every snapshot (top of each iteration and after step 3's re-snapshot) `if (blocked(row)) return fail('held')`. Claim conflict: `if ((await adopt(current)) === 'refused') return fail('held')`.
- `releaseClaim` returns the adopt outcome (or `null` when no conflict); `failed`/`in-doubt`/`frozen` callers return `held` when it was `'refused'`.
- `invalid` conflict: refused → `held`; `adoptedOr` returns `held` when the re-snapshot is held.
- After `publishPending` in `refreshUnderClaim`, outcome `kept`/`adopted` → re-snapshot; held → `fail('held')`.
- `publishPending`: entry `isGrantHeld(row) && !newFamily → 'kept'`; ordinary conflict with an opened `current` where `generationOf(current) < seenOf(row)` → `await adopt(result.current)` and `'kept'`; the "newer rotation won" adopt returning `'refused'` → `'kept'` without `CLEARED_PENDING`. New family is never blocked.

- [ ] **Step 1: Failing tests:**
  - "held returns without pushing or fetching": row `heldGeneration 4` → `{ ok:false, reason:'held' }`, `pushes.length === 0`, `tokenPosts === 0`.
  - "claim conflict with an older current returns held and pushes nothing more": another device puts an older-generation body under a newer rev between snapshot and claim (via `beforePush`) → result `held`, exactly one push.
  - "an ordinary pending pair stays unpublished while held and publishes after the hold clears": row with ordinary pending + held → `publishPendingTokens` pushes nothing, pending intact; clear via a pull of gen ≥ seen → next `publishPendingTokens` publishes.
  - "a refusal during publish keeps the pending pair": publish conflict whose `current` is older-generation → outcome `kept`, all four pending fields unchanged, `held` set.
  - "a refusal after invalid_grant presents nothing": `invalid` conflict with an older current → `held`.
  - "a release conflict with an older current holds": `failed` refresh, release push conflicts with an older-generation current → `held`, no further push.
  - For each simulated §5.3 path (claim conflict, release conflict, `invalid_grant` conflict, publish adopt): refused → revision recorded in `device.revs`, local row equal to before except `heldGeneration`, no token returned; equal/higher → applied, hold cleared.
  - "adopting the same refused current twice still holds": second adopt returns `stale`, the loop still returns `held` via the snapshot check.
  - D-9: "a hold between claim and publish keeps the pair and the claim": refusal injected after the claim `ok` → `held`, pending pair kept, no release push.
  - "a new sign-in publishes while held, its token usable at once, ok clears the hold": held row + `storeGrant`-shaped pending new family; first publish `network` → `ensure()` returns the new family's access token; retry publishes; row `held null`.
- [ ] **Step 2:** Run `tests/mcp/oauth/ensure-token.test.ts` → FAIL.
- [ ] **Step 3:** Implement. Fix every exhaustive switch on `EnsureResult['reason']` that the typecheck flags (connect-server's default branch handled in Task 7).
- [ ] **Step 4:** `pnpm --filter @chatsundere/user-client exec vitest run tests/mcp` → PASS; `pnpm --filter @chatsundere/user-client typecheck` → clean.
- [ ] **Step 5: Mutations:** remove the top-of-loop check (mid-loop test fails); remove the `newFamily` exemption in `blocked` (new-sign-in test fails); clear pending on refused adopt (pending test fails).
- [ ] **Step 6: Commit** `Pause OAuth grants held after a refused rollback`.

### Task 7: What the user and the model see

**Files:** Modify `src/mcp/server-status.ts:21-39`, `src/components/mcp/OAuthConnectionPanel.tsx`, `src/components/mcp/McpAuthNotice.tsx`, `src/mcp/mcp-tools.ts:53,186-230`, `src/mcp/oauth/connect-server.ts:19-36,72`, `src/mcp/types.ts:41` (`McpConnectionResult.held?: true`), `src/routes/app/integrations/server.tsx` (`applyTestResult` ~`:373`, the result lines ~`:794-806`); Tests: `tests/mcp/server-status.test.ts`, create `tests/components/oauth-connection-panel.test.tsx`, `tests/components/mcp-auth-notice.test.tsx`, `tests/mcp/mcp-tools.test.ts` (reason table ~`:365` gains `held`), `tests/mcp/oauth/connect-server.test.ts`, `tests/component/integration-server.test.tsx`.

**Interfaces:** Consumes Task 2 `isGrantDead`, `isGrantHeld`, `isGrantLive`; Task 6 reason `'held'`. Produces notice variant `'held'` in `McpAuthNotice['variant']`.

Exact copy:
- list status: `⚠ Sign-in paused here` — order in `oauthStatus`: signing in, no grant, dead (`⚠ Sign in again`), held, then the rest.
- detail page (paragraph under the "Signed in at" line, note style): `This device received a copy of this sign-in that is older than the one it already had, so it has paused the sign-in to keep it safe. Nothing has been removed. Sign in again to carry on, or wait: if your other devices catch up, it carries on by itself.` The *Sign in again* block shows when `dead || held`, with the existing disabled reasons.
- pill `held`: `isGrantHeld(grant)` → `⚠ ${name}: sign-in paused on this device` + *Sign in again* (same `open` + class-2 gate as dead); `isGrantLive(grant)` → `● ${name}: in use`; otherwise (dead or not arrived) fall through to the existing dead rendering (`⚠ ${name}: sign-in ended` + *Sign in again*). `dead`/`scope` flips use `isGrantLive`. Rename local `held` → `granted`.
- model, `held`: `${server.name} is unavailable: its sign-in is paused on this device, and the user can sign in again. Tell the user, and do not retry this tool in this turn.` (`tokenFailure` case `'held'` → `notice(server, 'held')`).
- *Test connection*: `tokenError` `'held'` → `Sign-in paused on this device. Sign in again to carry on.`; `testOAuthConnection` returns it with `held: true`; in `server.tsx` a new `testNote` state is rendered in the test-result block; on `held: true` set only `testNote` and `test: done`, leaving `routing`, `resolvedEndpoint`, `lastTestedAt` and `lastError` untouched; any other result clears `testNote`.

- [ ] **Step 1: Failing tests:**
  - status: held grant with tokens → `⚠ Sign-in paused here`; held + dead → `⚠ Sign in again`; held + needs proxy without proxy → `⚠ Sign-in paused here` (ranks above waiting).
  - panel: held grant renders the paused paragraph and an enabled *Sign in again*; `backendUnreachable` disables it with `SIGN_IN_WAITS_FOR_BACKEND`.
  - notice: `held` variant with a held grant → paused text + button opening the overlay with `{ serverId, extraScopes: [] }`; with a live grant → `● X: in use`, no button; with a dead or missing grant → `⚠ X: sign-in ended` + button; `dead` variant with a held grant (tokens present) → `⚠ X: sign-in ended`, not `connected again`; `scope` variant with held → not `access granted`.
  - mcp-tools: a token result `{ ok:false, reason:'held' }` → error string exactly the model copy above, `meta.mcpAuth.variant === 'held'`, and not containing `has ended`.
  - connect-server: `ensureToken` returning `held` → `{ ok:false, held:true, error:'Sign-in paused on this device. Sign in again to carry on.' }`.
  - `integration-server.test.tsx`: *Test connection* on a held grant shows `Sign-in paused on this device. Sign in again to carry on.`, and a subsequent Save writes the previous `lastError` (unchanged).
- [ ] **Step 2:** `pnpm --filter @chatsundere/user-client exec vitest run tests/mcp/server-status.test.ts tests/components/oauth-connection-panel.test.tsx tests/components/mcp-auth-notice.test.tsx tests/mcp/mcp-tools.test.ts tests/mcp/oauth/connect-server.test.ts tests/component/integration-server.test.tsx` → FAIL on the new tests.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5: Mutations:** swap dead/held order in `oauthStatus`; revert `McpAuthNotice` `dead` flip to the old local test; map `held` to `notice(server, 'dead')`. Each fails its test.
- [ ] **Step 6: Commit** `Show paused OAuth sign-ins in status, detail page, chat and Test connection`.

### Task 8: L3 — direct-first protected resource metadata and `viaProxy`

**Files:** Modify `src/mcp/oauth/discovery.ts:8-20,97-307`; Test `tests/mcp/oauth/discovery.test.ts`; fix other `OAuthDiscovery` literals the typecheck flags (tests and fixtures).

**Interfaces:** Produces `OAuthDiscovery.viaProxy: boolean`.

Rules: one helper `getDirectFirst(target): Promise<{ read: Read; viaProxy: boolean } | 'network'>` used by the pointer, the well-known guesses and `getAs` (replacing `getAs`'s own copy): direct; on a `TypeError` (fetch or body) and `hasProxy`, proxy; other errors → `'network'`. Pointer: `'network'` → throw `OAuthError('network', "Couldn't reach this server's sign-in details.")`. Guesses: `'network'` → treat as missing. The probe keeps `route`. `viaProxy` = the PRM's source `|| ` the AS metadata's source.

- [ ] **Step 1: Failing tests:**
  - "pointer goes direct first even when the probe used the proxy": `route: 'proxy'`, direct succeeds → no proxy GET for the PRM; `viaProxy false`.
  - "pointer falls back to the proxy only on a TypeError": direct throws `TypeError` + `hasProxy` → proxy used, `viaProxy true`; direct throws a non-`TypeError` → rejects with kind `network`, no proxy call.
  - "well-known guesses follow the same rule": no pointer, direct `TypeError` on the guess, proxy serves → `viaProxy true`.
  - "viaProxy when only the AS metadata came through the proxy" → true; all direct → false.
  - Review Focus 5: direct `TypeError`, `hasProxy false`, no pointer → `{ kind: 'no-oauth' }`.
- [ ] **Step 2:** `pnpm --filter @chatsundere/user-client exec vitest run tests/mcp/oauth/discovery.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same → PASS; typecheck clean.
- [ ] **Step 5: Mutations:** catch all errors for fallback (non-TypeError test fails); compute `viaProxy` from AS only (PRM-proxy test fails).
- [ ] **Step 6: Commit** `Fetch OAuth resource metadata direct first and remember the proxy`.

### Task 9: L3 — the confirmation line

**Files:** Modify `src/components/mcp/SignInScreens.tsx:33-64` (`SignInConfirm` prop `viaProxy: boolean`), `src/components/mcp/OAuthSignInFlow.tsx` (~`:110-121` hosts state gains `viaProxy` from `props.discovery`, updated on the re-check at ~`:345`; passed at ~`:384`); Test: create `tests/components/sign-in-screens.test.tsx`; extend `tests/components/oauth-sign-in-flow.test.tsx`.

Copy (one `<p className={noteClass}>` directly after the "You'll sign in at …" paragraph): `This sign-in service doesn't accept requests from browsers, so its details came through your Chatsundere server. Check that the sign-in address above is the one you expect.`

- [ ] **Step 1: Failing tests:** `viaProxy` true → line present, directly after the sign-in-at paragraph, *Continue to sign-in* still enabled; false → absent. Flow test: a discovery with `viaProxy: true` shows the line on the confirm step; a re-check result with `viaProxy: false` removes it.
- [ ] **Step 2:** `pnpm --filter @chatsundere/user-client exec vitest run tests/components/sign-in-screens.test.tsx tests/components/oauth-sign-in-flow.test.tsx` → FAIL. **Step 3:** Implement. **Step 4:** Same command → PASS.
- [ ] **Step 5: Mutations:** render unconditionally; ignore the re-check's flag. Each fails.
- [ ] **Step 6: Commit** `Say when OAuth sign-in details came through the user's server`.

### Task 10: Phase verification

- [ ] `pnpm exec turbo run test --continue`, `pnpm typecheck`, `pnpm run build`, `pnpm lint` — all compared against Task 0; only the known environmental failures and confirmed flakes may remain.

### Task 11: Documentation (spec §9)

**Files:** `obsidian/insights/security-deferrals.md` (2026-11-03 OAuth entry: L2, L4, L3 remainder closed by this unit; L4 timing channel **accepted by Chris, 2026-11-10**; add §5.7 residual and Larissa deferrals from Task 12), `obsidian/insights/follow-ups-index.md` (strike the three rows), `obsidian/decisions/0038-oauth-for-mcp-connectors.md` (addendum: generation counter, padded collection), `superpowers/specs/2026-11-02-mcp-oauth-design.md` §5 "Accepted failure modes" backup-restore line per spec §5.7, `apps/user-client/src/content/help/integrations.md` after the status lines (~`:26`): `If a device receives an older copy of your sign-in than the one it already has, it shows **Sign-in paused here** and stops using it to keep it safe. Tap **Sign in again**, or wait: it carries on by itself once your devices catch up.`

- [ ] Edit; if a help-content test snapshots the file, run it. Commit `Document OAuth grant hardening` — mixed with the help `.md` under `apps/`; it is text only, so ` [skip ci]`.

### Task 12: Audits

- [ ] Larissa-style security audit (fresh subagent; diff vs `master`, spec, parent §5, ADR 0038; severity Critical/High/Medium/Low; rate the §5.7 residual and D-9). Fix Critical/High/Medium where possible, re-audit; record deferrals.
- [ ] Laura-style pre-squash UX pass (fresh subagent with `.claude/agents/laura.md`, spec §3, §5.4–§5.6, §6, diff). Fix hard defects.
- [ ] Commit fixes per finding group; re-run Task 10.

### Task 13: Draft PR and report — do not merge

- [ ] Push; open a **draft** PR to `master`; do not merge, squash or tag.
- [ ] Write `superpowers/overnighter/2026-11-10-mcp-oauth-hardening-overnighter-report.md` (sections per brief), add the PR to `superpowers/open-items.md`; commit `Add MCP OAuth hardening overnighter report [skip ci]`; push.
- [ ] Do not merge.
