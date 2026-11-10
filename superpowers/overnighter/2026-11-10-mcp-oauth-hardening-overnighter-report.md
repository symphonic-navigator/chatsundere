# Overnighter report: hardening OAuth grants for MCP

**Date:** 2026-11-10 · **Branch:** `feature/mcp-oauth-hardening` · **Draft PR:** https://github.com/symphonic-navigator/chatsundere/pull/36 (do not merge) · **Spec:** `superpowers/specs/2026-11-10-mcp-oauth-hardening-design.md` · **Plan:** `superpowers/plans/2026-11-10-mcp-oauth-hardening.md`

## Summary for Chris

All three Low deferrals of 2026-11-03 are implemented:

- **L2:** sealed `generation` with a device-local high-water mark and a calm pause.
- **L4:** grant records are padded.
- **L3 remainder:** metadata is fetched direct first, and the confirmation names the proxy.

The Larissa-style audit found no Critical or High; its Medium and three Lows are fixed and re-audited. The Laura-style pass found one hard defect, now fixed. Five residuals (R1–R5) await your sign-off in `obsidian/insights/security-deferrals.md` (2026-11-10 entry); all are Low or Info.

Two points need your eye:

1. **Display liveness deviates from the letter of spec §5.4** (decision 11 below).
2. **The spec's §5.7 wording understates the worst case** (Larissa R1). I did not change the spec.

## Environment

- **Machine:** cloud container, Linux, no Postgres, no Redis, no Docker, no devices, no OAuth server, no provider keys.
- **Toolchain:**
  - Node **22.23.4**; `.mise.toml` pins Node 20. Not installed separately, because everything ran green on 22.
  - pnpm 9.15.0, bun 1.4.4, all pre-installed.
  - Nothing installed beyond `SHARP_IGNORE_GLOBAL_LIBVIPS=1 pnpm install --frozen-lockfile`, which took 23 s.
- **Superpowers skills were available and used:**
  - `writing-plans` for the plan;
  - `subagent-driven-development` for execution: one fresh implementer per task, and a fresh reviewer per task for Tasks 2–8;
  - Larissa-style and Laura-style audits (Laura via the `laura` agent definition).
- **Subagents never committed, pushed or switched branches.** I committed and pushed after every task and checked `git branch --contains HEAD`.

## Plan review findings and what I did

A fresh reviewer got the brief, the spec and the plan. Its eleven findings, all folded in before the plan commit `8c3a2c3`:

1. **The `held` pill fallback misread dead or absent grants as paused.** Fixed: held shows paused, live shows in use, anything else shows the ended rendering.
2. **The lost-ack recovery test could not happen as written.** Recovery re-runs on a failed drain. The test was rewritten as a recovery re-run and the D-7 rationale was corrected.
3. **The `storeGrant` high-water test had no runnable home.** It now lives in `sign-in.test.ts`, whose store got the real refusal.
4. **Tokens only this device holds (two paths).**
   - Mid-refresh hold: logged as **D-9**.
   - Sign-in over an ordinary pending pair: **D-10** proposed revoking that pair. The audit later rejected this; see below.
5. ***Test connection* had no rendering path for the paused note.** Fixed with a separate `testNote` state and a mandatory route test.
6. **Spec §8 coverage gaps:**
   - release-conflict refusal;
   - each §5.3 path in both directions;
   - the new-sign-in base fallback;
   - invalidation tests;
   - new test files named for the panel and the screens.

   All added.
7. **`applyOk` lock scope widened for every collection.** Now widened for grants only. Monotone ack applied regardless of the meta write.
8. **Type gaps.** Added `UpsertTxResult.refused`, the full `AdoptOutcome` mapping, and a test that adopts the same refused revision twice.
9. **Names.** Review-focus task number fixed, D-5 extended to every link-generation parameter, and `LOCAL_DEFAULTS`/`stripLocal` renamed with all callers.
10. **Exact test paths and commands.** Every task now names its files and its command.
11. **Task 1 import path.** Fixed.

## Task 0: baseline, planned against measured

Measured on `e728f28`, before any change.

**Build checks:**

| Check | Known state (brief) | Measured |
|---|---|---|
| `pnpm typecheck --force` | 14/14 | 14/14 |
| `pnpm run build --force` | 9/9 | 9/9 |
| `pnpm lint` | clean, 1871 files | clean, 1871 files |

**Test suites** (`turbo run test --continue --force`):

| Package | Known state (brief) | Measured |
|---|---|---|
| crypto | 227 pass | 227 pass |
| llm-unified | 509 | 509 |
| proxy-service | 89 | 89 |
| shared-types | 7 | 7 |
| embeddings | 68 | 68 |
| ui-shared | 78 | 78 |
| admin-client | 71 | 71 |
| user-client | 4292/4293, 1 flake | **4293/4293** in 651 files, no flake this run |
| auth-service | aborts, `ECONNREFUSED ::1:5432` | aborts, `ECONNREFUSED 127.0.0.1:5432` |
| sync-service | 39 pass, 24 fail, 5 skip | 39 pass, 24 fail (68 tests) |

Task 0 took about 15 minutes, as expected.

## Tasks: commits and test output

| Task | Commits | Final test evidence |
|---|---|---|
| 1 L4 padding | `20f72b3` | crypto 228 pass / 0 fail (red run before the change: 227 pass, 1 fail) |
| 2 Generation rules | `ac21fd8` | 44 tests in the targeted files; `tests/mcp/oauth` 324; user-client 4308/4308 |
| 3 Refusal on pull | `34d2853` | new Dexie test 6/6 (red: 5 of 6 failed); `tests/sync` + `tests/mcp/oauth` 759; user-client 4315 |
| 4 Acknowledgements and link reset | `e561a86`, `0292bc0` (fix round) | user-client 4326; `tests/sync` 478 after the fix round |
| 5 Stamping every write | `5a5503a` | targeted 101/101; user-client 4337 |
| 6 `held` in refresh | `9108bb4`, `7a4df37` (fix round) | red: 11 failed; `tests/mcp` 448; user-client 4356; `tests/mcp/oauth` 330 after the fix round |
| 7 UI and model | `bf1887a`, `3468313` (fix round) | the six task files 128; user-client 4382; 79 in the fix-round files |
| 8 Discovery direct first | `b1d3809` | discovery 42; user-client 4362 |
| 9 Confirmation line | `20b860a` | targeted 47; user-client 4390 |
| 10 Phase verification | at `20b860a` | typecheck 14/14, build 9/9, lint clean (1878 files), user-client 4390/4390 (657 files); other packages as baseline |
| 11 Docs | `0aa7133`, `b4cce4c`, `4bb7151` | text only |
| 12 Audit fixes | `974aa03`, `29883dc` | user-client 4402 after the fix wave; `tests/sync` + `tests/mcp` 962 after the follow-ups |

**Final verification at `29883dc`:**

- `pnpm typecheck` 14/14.
- `pnpm run build` 9/9.
- `pnpm lint`: clean, 1878 files.
- `pnpm exec turbo run test --continue`:

| Package | Result |
|---|---|
| crypto | 228 pass |
| llm-unified | 509 |
| proxy-service | 89 |
| shared-types | 7 |
| embeddings | 68 |
| ui-shared | 78 |
| admin-client | 71 |
| **user-client** | **4414/4414** (657 files) |
| auth-service | ECONNREFUSED (environmental) |
| sync-service | 39 pass, 24 fail (environmental) |

The per-task detail is in the appendix: changes, real command outputs, and **every mutation individually** with its outcome.

## Security audit (Larissa-style) and what I did

**Verdict:** no Critical or High.

**Fixed (commits `974aa03`, `29883dc`) and re-audited as ADDRESSED:**

- **M1 (Medium), plan decision D-10.** The sign-in revoked a replaced ordinary pending pair *after* exchanging the new code. Under RFC 7009 per-grant revocation that can kill the new family. For an in-doubt pair it can also kill other devices' working tokens. The benefit was nil. **Dropped:** the earlier behaviour is restored, and a test asserts no revocation.
- **L1.** `viaProxy` stayed false when a proxied challenge supplied the metadata pointer or the scope. Fixed.
- **L2.** A direct `ok` whose write-back was skipped still cleared the pending pair. Now, when the grant is held, the pair is kept.
- **L3.** A direct acknowledgement could lower `seenGeneration`. Now:
  - the mark is merged as a maximum;
  - the hold is cleared only through `ackFields`;
  - an ack below the mark keeps the stored row and holds the grant. A hostile server is the only way to get there.

**Ratings asked for:**

- **Spec §5.7 residual:** Low is right, but the wording is wrong. With a superseded family in the losing body, a device can present that family's tokens. → **R1**.
- **D-9:** acceptable, Low residual. A refinement that needs a spec change → **R3**.
- **D-10:** Medium → dropped.
- **Padding:** adequate for a Low. Buckets still often separate token kinds. An 8 KiB floor is proposed → **R4**.

**Info:**

- Freeze is not covered → **R2**.
- `unlinkedFlow` ignores the hold. Harmless, because link reset clears it.
- Rollout same-generation acceptance is as §5.6 accepts.

**Re-audit extras:**

- One pre-existing Low: a link reset during a publish can leave a spent token as `tokens` → **R5**, deferred.
- The L3 edge (an ack below the mark overwrote the stored content) → fixed in `29883dc`.
- `isGrantPaused` confirmed as display-only. A drift test now pins it against the gate.

All of R1–R5 are in `security-deferrals.md` and `follow-ups-index.md`, **awaiting Chris**. None is Critical, High or Medium.

## UX audit (Laura-style pre-squash) and what I did

**Hard defect H1.** After *Sign in again* while held, if the new sign-in's first push failed, every surface still read "paused, sign in again", although the tools already worked on the new sign-in's token.

- **Fixed** with a display-only `isGrantPaused`, which exempts a pending new-family pair.
- The list, the panel and the pill use it. The gates in `ensure-token.ts` and `grant-publish.ts` are unchanged.
- This deviates from the literal liveness rule in spec §5.4. See decision 11.

**Soft findings, for Chris:**

- **S1.** The *Test connection* paused note says "Sign in again to carry on" but sits below the fold, away from the button. The spec copy is final, so it is unchanged. The suggestion was a button inside the note, or "Use Sign in again above".
- **S2.** A pill whose grant has not reached this device offers *Sign in again* while the detail page withholds it. This is pre-existing for the `dead` pill; the `held` variant inherits it. The suggestion was a calm `○ <name>: sign-in on its way`.
- **S3.** A stale comment. Fixed.

Laura agreed with my other three choices:

- the held-and-dead panel shows no paused text;
- the *Test connection* result block shows only the note;
- the pill fallbacks.

## Decisions made without Chris

1. **Acknowledgement mechanics (brief 1).**
   - Options: (a) put generation, seen and held into the pushed row, so the existing whole-row `ok` write carries them; or (b) a separate write after the `ok`.
   - Chosen: **(a)**. It lands in the same transaction, as §5.2 requires, and `stripForSeal` removes seen and held (tested on the sealed body). The in-memory claimed row carries the claim's generation, so release and `invalid_grant` push claim + 1.
   - Outbox acks read the generation captured at seal time (`PreparedRecord.grantGeneration`), so a row edited after sealing is never credited.
2. **Where the hold is checked (brief 2).**
   - At the top of every loop iteration, after step 3's re-snapshot, after every adopt (a refused outcome returns `held`; `adoptedOr` and the release paths re-check), at `publishPending` entry, and before every re-push attempt.
   - Option rejected: checking at entry only. That allowed the claim-conflict loop the brief describes.
3. **Status order (brief 3).** Dead, then held, then the rest, using one helper set (`isGrantDead`, `isGrantHeld`/`isGrantPaused`, `isGrantLive`). Implementing "not live" as dead was rejected.
4. **Query refresh (brief 4).** A refusal, a hold cleared by a direct `ok`, and a hold cleared by an outbox ack all invalidate `QK.mcpOAuthGrants`. An ack that changes nothing invalidates nothing.
5. **Names (brief 5).** The link-generation local and parameter is renamed `linkGeneration` throughout the worker. `held` in the notice is renamed `granted`. The test harness has `LOCAL_DEFAULTS`/`stripLocal`. The gate helper is `isHoldBlocking`, sharing `hasPendingNewSignIn` with the display helper.
6. **Anchors (brief 6).** Trusted the code. The push filters in `recovery.ts` and `backfill.ts` are unchanged, because outbox pushes carry the generation unchanged by construction.
7. **Refused revision against epoch recovery (brief 7).** A refusal records the revision exactly as the local-wins branch does, with no outbox entry. Recovery's repush then pushes cleanly, and its `applyOk` clears the hold. If the recovery drain fails, recovery re-runs and its pull-all applies the device's own record at an equal generation. Both cases are tested, ending with an empty outbox.
8. **Metadata fallback (brief 8).** One `getDirectFirst` helper serves the pointer, the guesses and the authorisation server metadata. Only a `TypeError` falls back to the proxy. A pointer failing with any other error throws the network error, with no proxy attempt.
9. **D-9: a hold between a won claim and its publish.**
   - Options: (a) release the claim; (b) keep the pair pending and keep the claim; (c) publish anyway.
   - Chosen: **(b)**. Releasing would invite the spent token at once, and publishing is forbidden by §5.4. Larissa rates the residual Low; her refinement (publish own content at seen + 1) is R3.
10. **D-10: revoke an ordinary pending pair a sign-in replaces.** Planned to stop a live refresh token from being dropped silently. **Dropped** after Larissa M1. Cost: as before this unit, an orphaned refresh token stays live at the authorisation server.
11. **Display liveness exempts a pending new sign-in (Laura H1).**
    - Options: (a) follow §5.4 literally (live only when `heldGeneration` is null), which leaves "paused, sign in again" showing while the tools work; or (b) treat a pending new-family pair as not paused, for display only.
    - Chosen: **(b)**. It is the closest to the intent of §5.4 and §3 step 5, and it opens no security gap. **Please confirm or amend the §5.4 wording.**
12. **Hostile ack below the mark holds the grant.** Without the hold, `publishPending`'s "superseded" branch would discard a pair this device may be the only holder of.
13. **Existing tests changed (Task 5).** Tests 13, 15, 18, 31 and 27e wrote foreign "newer" rows at generation 0. That is the shape of a v0.3.5 *sign-in*, which §5.6 accepts as pausing. They now write one generation above the server's row, using a `putNewer` helper. No assertion changed. The reviewer judged this faithful. A dedicated test pins the generation-0 rollout pause.
14. **Unlinked path.** `publishPending`'s hold check sits after the unlinked promotion, so an unlinked device never presents the token a pending pair replaced. `unlinkedFlow` does not read the hold, because link reset clears it.

## Deviations, surprises and open points for Chris

- **Spec §5.4 liveness wording:** see decision 11.
- **Spec §5.7 wording:** it understates the worst case (Larissa R1). I left the spec unchanged, as the brief asks. The deferral entry carries the correction.
- **R1–R5 need sign-off** (all Low or Info): `security-deferrals.md`, 2026-11-10.
- **Process deviations:**
  - Tasks 1 and 9 (small diffs) and the one-line or small fix rounds of Tasks 4, 6 and 7 were reviewed by me, not by a fresh reviewer subagent. The audits later covered the whole branch.
  - No separate whole-branch code review was run beyond the Larissa and Laura passes and their re-audit.
- **Red step:**
  - In Tasks 8 and 9 the implementers wrote code before watching the tests fail. Their mutations show the tests bite.
  - In Tasks 4–7, some new tests pin behaviour that already held, so they passed from the start. Each such case is named in the appendix.
- **Tests without real devices:**
  - The new Dexie-level test `tests/sync/apply-grant-generation.test.ts` runs under `@vitest-environment node`. Under jsdom, Dexie returns stored `Uint8Array` fields as plain objects, which breaks the byte-for-byte deep-equal.
  - In fake-indexeddb, `update` has the same quirk, so one write uses `put`. Neither affects real browsers.
- **A full-suite flake** was seen once during Task 9 and was not identified; the rerun was clean. No flake in either final run.
- **Toolchain:** Node 22 rather than the pinned Node 20.
- **Spec §11 step 5** (the rollback check on the dev stack) is yours to run, as planned.

## Proposed STATUS changes (`obsidian/STATUS-CLIENT-ONLY.md`, after the squash)

- **Current:** add a v0.3.6 entry:
  > **OAuth grant hardening — squashed from PR #36.** Sealed `generation` with a device-local high-water mark; a device that already knows a grant pauses an older copy (`⚠ Sign-in paused here`, *Sign in again*) instead of adopting it, and an honest backup restore heals through epoch recovery. Grant records are padded; protected resource metadata goes direct first, and the confirmation names the proxy when the details came through it. Larissa 0 Critical/High (M1 and three Lows fixed, re-audited); Laura's hard defect fixed. Residuals R1–R5 in [[insights/security-deferrals]] (2026-11-10).
- **v0.3.5 entry:** replace the "Still awaiting Chris: L2, L4, L3 remainder" line with "closed in v0.3.6".
- **Next session:** replace "Decide the three OAuth deferral proposals" with "Decide the OAuth hardening residuals R1–R5; consider Laura S1 and S2".
- **Last updated:** set after the squash and the v0.3.6 tag (squash, tag, then the STATUS commit).

## PR

Draft: https://github.com/symphonic-navigator/chatsundere/pull/36. Not merged, squashed or tagged. Added to `superpowers/open-items.md`.

---

## Appendix: per-task implementer reports (changes, command output, every mutation)

These are written by the implementer subagents and copied verbatim. "Staged, not committed" refers to the hand-over to me; I committed each one as listed above.


### Appendix — Task 1

#### Task 1 report: L4 pad grant records

Status: DONE

Changes (staged, uncommitted):
- packages/crypto/src/sync-envelope/seal.ts: added 'mcpOAuthGrants' to PADDED_COLLECTIONS; extended doc comment (token kind by size, spec §4; legacy records stay readable).
- packages/crypto/tests/sync-envelope/seal.test.ts: set-membership and bucket-size assertions in "pads padded collections only"; new test "opens an unpadded grant record sealed before padding" (hand-built record: 4-byte LE prefix + encodeRow JSON, same AAD and DEK as sealRecord). Imports computeBlindId, deriveDek, encodeRow from src/index.js.

Tests:
- Before implementation: `pnpm --filter @chatsundere/crypto test` -> 227 pass, 1 fail (set membership).
- After: 228 pass, 0 fail.
- biome check --write on both files: clean (1 file reformatted).

Mutations (run via `bun test tests/sync-envelope/seal.test.ts`, restored with git checkout):
1. Removed 'mcpOAuthGrants' from the set -> "pads padded collections only" FAILED (1 fail). Restored.
2. unpadPlaintext throws unless framed.length % 1024 === 0 -> legacy test "opens an unpadded grant record sealed before padding" FAILED (plus three other unpadded-collection round-trips). Restored.
After restore: 11 pass, 0 fail.

Deviations: none. Full user-client suite skipped as instructed (crypto-only change).


### Appendix — Task 2

#### Task 2 report: generation rules, row fields, strip discipline

Status: DONE (work staged, not committed).

## Changes (apps/user-client)
- src/mcp/oauth/grant-generation.ts (new): all brief functions with JSDoc; `GenerationFields` exported.
- src/boot/client-data-db.ts: `generation?`, `seenGeneration?`, `heldGeneration?` on `McpOAuthGrantRow`, JSDoc'd.
- src/sync/strip.ts: `seenGeneration`, `heldGeneration` in the mcpOAuthGrants deny-list (why comment); fresh-device defaults `0` / `null`.
- tests/mcp/oauth/grant-harness.ts: `PENDING_DEFAULTS` -> `LOCAL_DEFAULTS` (+ the two fields), `stripPending` -> `stripLocal` (strips both). Importers updated: ensure-token.test.ts (sign-in.test.ts did not use either name).
- tests/mcp/oauth/grant-generation.test.ts (new); tests/sync/strip.test.ts extended (two tests).

## Verification
- Red first: 2 failed (strip) + module missing.
- `vitest run tests/mcp/oauth tests/sync/strip.test.ts`: 13 files, 324 passed.
- Full user-client suite: 652 files, 4308 tests passed.
- typecheck clean (after fixing `version: 1 as const` in my test); `biome check src tests/mcp/oauth tests/sync/strip.test.ts`: clean.

## Mutations (command: vitest run tests/mcp/oauth/grant-generation.test.ts tests/sync/strip.test.ts; restored with git checkout)
1. `>=` -> `>` in judgePulledGrant: 2 failed (equal-generation, absent-generations-apply). Restored.
2. dropped `+ 1` in nextGeneration: 2 failed (nextGeneration, stampForPush). Restored.
3. removed `'seenGeneration'` from deny-list: 2 failed (both new strip tests). Restored.
After restore: 44 passed.

## Notes
- Strip tests placed in the existing mcpOAuthGrants describe block.


### Appendix — Task 3

#### Task 3 report — refusal on pull and `GrantStore.adopt` outcome

Status: DONE. Work is staged, not committed.

## Changes

- `apps/user-client/src/sync/apply.ts`
  - `ApplyOutcome` gains `| { kind: 'refused' }`. `UpsertTxResult` gains `refused?: true`.
  - `applyUpsert`: inside the existing transaction, for `mcpOAuthGrants` when a local row exists and before `resolveConflict`, `judgePulledGrant(local, row)` runs. On `refuse`, it calls `db.mcpOAuthGrants.update(key, { heldGeneration })` and records the revision the way the local-wins branch does: if meta exists, `syncRows.update rev`; if not, `syncRows.put` with `localHash`. No outbox entry is written. It returns `{ outcome: { kind: 'refused' }, refused: true }`.
  - After commit, `result.refused` leads to `collectFor(collection, key, undefined)`, which collects `QK.mcpOAuthGrants`.
  - `restoreAppliedRow`: for `mcpOAuthGrants`, it overlays `acceptedFields(local, row)` after `restoreLocalFields`. This covers both insert and pulled-wins.
  - Imports `acceptedFields` and `judgePulledGrant` from `mcp/oauth/grant-generation.ts`, which imports only types, so there is no cycle.
- `apps/user-client/src/mcp/oauth/grant-store.ts`
  - Adds `export type AdoptOutcome = 'adopted' | 'refused' | 'stale'`. Its JSDoc lists the mapping: `inserted` and `resolved` (pulled) become `adopted`; `refused` stays `refused`; `echo`, `stale`, `rejected`, `tamper`, `suppressed`, `unavailable`, `skipped` and `tombstoned` become `stale`.
  - `GrantStore.adopt` now returns `Promise<AdoptOutcome>`. The Dexie implementation maps the result through a private `adoptOutcomeOf`.
  - I did not change the callers in `ensure-token.ts` or `grant-publish.ts`. They already compile, because they ignore the awaited value. Task 6 will handle the outcome there.
- `apps/user-client/src/sync/worker.ts`: comment only. `refused` is added to the list of successful outcomes. The pull loop already advances `highestApplied` for any outcome other than `unavailable`. Recovery (`recovery.ts:520`) only aborts on `unavailable`. So `refused` moves the watermark forward in both, and neither needed a code change.
- `tests/mcp/oauth/ensure-token.test.ts`: `Device.adopt` returns `AdoptOutcome` and calls `judgePulledGrant` and `acceptedFields`. On refusal it sets `heldGeneration`, records the revision and leaves the rest of the row as it was. New test: `the device harness > device adopt refuses an older generation`. It covers a refusal (row unchanged apart from the hold, revision recorded), then a replay of the same record (`stale`), then an equal generation (`adopted`, hold cleared, pending kept).
- `tests/mcp/oauth/sign-in.test.ts`: the `casStore.adopt` test store uses the same judge and accepted-fields logic. It records the revision on refusal and returns `AdoptOutcome`. Its `push` already sends `stripLocal`-ed bodies to the server side, because `CasServer.push` strips them, so it needed no change.
- New file `tests/sync/apply-grant-generation.test.ts`, a Dexie-level test using `fake-indexeddb`, the session MK and `_setApplyOpenRecord`. It has 6 tests:
  - refuses an older generation and leaves the local row unchanged (rev 8, hash kept, outbox empty, invalidator got `QK.mcpOAuthGrants`);
  - extra: records the refused revision with its ciphertext hash when no base exists;
  - applies generation 9 and clears the hold, and the same for generation 12;
  - legacy rows apply;
  - a fresh device accepts and records seen.

## Deviation / decision

The new test file runs under `// @vitest-environment node` rather than jsdom. Under jsdom, when Dexie re-stores a row that was read from fake-indexeddb, the `Uint8Array` fields come back as plain objects because they cross JS realms. That made the "row unchanged" deep-equality check fail on byte fields, even though the refusal only writes `heldGeneration`. This is a test-environment artefact, not a production one. A comment in the file explains it. The deep-equality checks compare against the row as read back before the pull.

## Commands and outputs

- Before implementing: `vitest run tests/sync/apply-grant-generation.test.ts` gave `Tests 5 failed | 1 passed (6)`, as expected.
- After: the same file gave `Tests 6 passed (6)`.
- `vitest run tests/sync tests/mcp/oauth` gave `Test Files 72 passed (72)`, `Tests 759 passed (759)`.
- Full suite, `pnpm --filter @chatsundere/user-client test`: `Test Files 653 passed (653)`, `Tests 4315 passed (4315)`.
- `pnpm --filter @chatsundere/user-client typecheck`: clean, exit 0.
- `pnpm exec biome check` on the 6 changed files: clean after `--write`, which reformatted the test's blob constants.

## Mutations (after `git add`; each one restored with `git checkout -- apps/user-client/src/sync/apply.ts`)

1. Removed the `syncRows` update/put in the refusal branch. Result: FAIL in "refuses an older generation…" and "records the refused revision…" (2 failed).
2. Removed the `...acceptedFields(...)` overlay in `restoreAppliedRow`. Result: FAIL in "applies generation 9…", "applies generation 12…" and "a fresh device accepts…" (3 failed).
3. Deleted `if (result.refused) collectFor(...)`. Result: FAIL in "refuses an older generation…" at the invalidator assertion (`expected [] to deep equally contain [ 'mcp-oauth-grants' ]`).

## Concerns

None blocking. A resolved local-winner outcome maps to `stale`, as the brief says. It cannot happen for grants today, because the server row always wins.


### Appendix — Task 4

#### Task 4 report — acknowledgements (direct, outbox, recovery) and link reset

Status: DONE. Work is staged (`git add`) and not committed.

## Changes

- `apps/user-client/src/sync/seal-batch.ts` — `PreparedRecord.grantGeneration?: number`. `prepareRecord` sets it from the raw row (`generationOf(entry.row)`) for `mcpOAuthGrants` upserts only. It uses a conditional spread, so other collections carry no key.
- `apps/user-client/src/sync/apply.ts` — new export `collectInvalidation(key)`, a thin public wrapper over the private `collect`. Writers outside the pull path use it together with `flushInvalidations()`.
- `apps/user-client/src/sync/worker.ts`
  - D-5: the link-generation local/parameter `generation` is now `linkGeneration` in `drainOutbox`, `pushRecordDirect`, `applyOk`, `applyConflict` and `applyTombstoned`. I also renamed it in `runPullLoop` for consistency.
  - `pushRecordDirect`: a `wrote` flag tracks whether the `ok` transaction actually wrote the row. If it did and the collection is `mcpOAuthGrants`, it runs `collectInvalidation(QK.mcpOAuthGrants)` and then `flushInvalidations()`. The row write is unchanged: the stamped row is written wholesale (D-1).
  - `applyOk`: `db.mcpOAuthGrants` joins the transaction scope only when `prep.collection === 'mcpOAuthGrants'`. After the link-generation stale check, and before the meta write, an upsert with `grantGeneration` defined calls the new `ackGrant(key, gen)`. `ackGrant` applies `ackFields` to the local row whether or not the meta was written, and never when the ack is stale by link generation. It returns true only when the row actually changed. When it did, the grants query is invalidated after commit.
  - The drain does no stamping: the outbox push carries the row's generation unchanged. `enqueueFullRepush` and `backfill` are untouched.
- `apps/user-client/src/sync/link-reset.ts` — both reset bodies now open their transaction over `[syncRows, syncOutbox, syncState, mcpOAuthGrants]` and call `resetGrantGenerations()`. It modifies only `seenGeneration = generationOf(row)` and `heldGeneration = null`.

## Tests

- `tests/sync/push-record-direct.test.ts` (new describe "pushRecordDirect — grant generations"):
  - "an ok writes generation, raises seen and clears the hold"
  - "a failed push leaves generation and seen untouched"
  - "a committed ok for a grant refreshes the grants query"
- `tests/sync/grant-outbox-ack.test.ts` (new; real drain and pull against a small CAS server with a JSON codec):
  - "an outbox ack at or above seen clears the hold, carrying the generation unchanged"
  - "an outbox ack below seen changes nothing"
  - "an outbox ack that clears a hold refreshes the grants query"
  - "an ordinary drain conflict with our own lost-ack record applies and pushes cleanly"
- `tests/sync/recovery.test.ts` (new describe, real `runRecovery` with a `RestoredServer` harness):
  - "an honest restore heals itself"
  - "a failed recovery drain heals on the re-run and leaves no conflicting entry"
- `tests/sync/link-reset.test.ts` and `tests/sync/link-reset.local-only.test.ts`: "sets seenGeneration to the row generation and clears the hold, touching nothing else". Rows are `{gen 6, seen 9, held 4}` → seen 6, held null, and a row without generation → seen 0. Each test checks the whole row with `toEqual`.

Step 2 (before implementation), the five named files: `Tests 8 failed | 25 passed (33)`. At that point the failures included two test-only mistakes, fixed before implementing:
- The "failed push" test compared Uint8Array fields across realms; it now asserts the generation fields.
- The re-run test hard-coded rev 21, but the default settings row is pushed first and takes rev 21. The test now asserts against the rev the server actually stored our record at.

After those fixes, the remaining failures were the expected new-behaviour tests.

These tests already passed before this task, because the behaviour comes from Task 3 / D-7:
- "a failed recovery drain heals on the re-run…": the pull-all applies our own record at equal generation.
- "an ordinary drain conflict with our own lost-ack record…"
- "an ok writes generation…" (direct): `pushRecordDirect` already wrote the stamped row wholesale.

They stand as regression guards.

Step 4: `pnpm --filter @chatsundere/user-client exec vitest run tests/sync` → `Test Files 61 passed (61)`, `Tests 476 passed (476)`.

Full suite: `pnpm --filter @chatsundere/user-client test` → `Test Files 654 passed (654)`, `Tests 4326 passed (4326)`.

Typecheck: `pnpm --filter @chatsundere/user-client typecheck` → clean.

Biome: `pnpm exec biome check apps/user-client/src/sync apps/user-client/tests/sync` → "Checked 85 files … No fixes applied."

## Mutations (after `git add`; each restored with `git checkout -- <file>`)

1. Removed `'seenGeneration'` and `'heldGeneration'` from the deny-list in `src/sync/strip.ts` (sed). Ran `vitest run tests/sync/push-record-direct.test.ts tests/sync/grant-outbox-ack.test.ts` → `2 failed | 16 passed`. The sealed-body assertions failed in "an ok writes generation…" and "an outbox ack at or above seen…". Restored.
2. Skipped `ackFields` in `applyOk` by replacing `grantAcked = await ackGrant(...)` with `grantAcked = false` in `src/sync/worker.ts`. Ran `vitest run tests/sync/recovery.test.ts tests/sync/grant-outbox-ack.test.ts` → `3 failed | 8 passed`. The failures were "an honest restore heals itself", the outbox ack test and the outbox invalidation test. Restored.
3. Set seen to 0 in link reset (`row.seenGeneration = 0` in `src/sync/link-reset.ts`). Ran `vitest run tests/sync/link-reset.test.ts tests/sync/link-reset.local-only.test.ts` → `2 failed | 6 passed`. Restored.

## Decisions and deviations

- Invalidation seam: I added the exported `collectInvalidation` to `apply.ts` rather than exporting `collect` itself. Tests observe it through the existing `setInvalidator`.
- `ackGrant` reports "changed" only when `seenGeneration` or `heldGeneration` actually differ, so an ack that changes nothing does not invalidate.
- The `runPullLoop` rename goes slightly beyond the functions D-5 lists. It is the same link-generation variable, and renaming it keeps the worker consistent.
- No commit was made; the controller commits as `Acknowledge OAuth grant generations and heal on epoch recovery`.

## Review fixes (after e561a86)

Staged and not committed.

1. **Stale-ack drain test** (`tests/sync/grant-outbox-ack.test.ts`): "an ack made stale by a link-generation change leaves the hold alone". The push transport bumps `syncState.linkGeneration` directly, not through a link reset (a reset would clear the hold itself), and then answers `ok`. The local row is `{gen 9, seen 9, held 4}`, so the pushed generation is ≥ seen. The test asserts that `heldGeneration` stays 4 and that `QK.mcpOAuthGrants` is not invalidated.
   - Mutation: I moved the `ackGrant` call above the `generationStillCurrent` check in `applyOk`. Running `vitest run tests/sync/grant-outbox-ack.test.ts` gave `1 failed | 5 passed`, with "expected null to be 4". Restored with `git checkout -- src/sync/worker.ts`.
2. **`ackGrant` no-change check** (`src/sync/worker.ts`): `row.heldGeneration === null` is now `== null`, so a legacy row whose `heldGeneration` is undefined no longer gets a redundant write and invalidation. New test: "an ack on a legacy row without a hold field writes nothing and refreshes nothing". The row is `{gen 5, seen 5}` with no `heldGeneration` key. After the ack the key is still absent and the grants query is not invalidated.
   - Mutation: I reverted the check to `=== null`. The same command gave `1 failed | 5 passed`, with "expected true to be false". Restored.

Verification:
- `pnpm --filter @chatsundere/user-client exec vitest run tests/sync`: `Test Files 61 passed (61)`, `Tests 478 passed (478)`.
- Typecheck: clean, 0 errors.
- `pnpm exec biome check` on both changed files: "No fixes applied".


### Appendix — Task 5

#### Task 5 report: stamping every compare-and-set write; storeGrant keeps the mark

Status: DONE_WITH_CONCERNS (one concern, about fixtures, below). Work is staged and not committed, as common.md requires. The brief's Step 6 "Commit" is left to the controller.

## Changes

### Source (`apps/user-client/src/mcp/oauth/`)
- `ensure-token.ts`
  - The claim is now `stampForPush({ ...row, claim }, generationOf(row))`. The in-memory `claimed` row carries the claim generation.
  - `releaseClaim` pushes `stampForPush({ ...claimed, claim: null }, generationOf(claimed))`.
  - The `invalid_grant` push is `stampForPush({ ...claimed, tokens: null, claim: null, updatedAt }, generationOf(claimed))`.
  - `unlinkedFlow` is untouched.
- `grant-publish.ts`
  - In `publishPending`, the body is stamped on every attempt with `stampForPush(body, baseGeneration)`. The first attempt uses `generationOf(row)` as its base.
  - Ordinary re-push after "nothing newer": the base becomes `generationOf(current)`.
  - New family after a conflict: the base becomes `generationOf(opened)` when `store.open(result.current)` returns a row, otherwise `generationOf(row)`.
  - The unlinked promotion is untouched, so the generation stays as it was.
  - New export `revokeOrdinaryPending(row, mk, deps: PublishDeps)`. It wraps `revokePair` and does nothing unless `row.pendingTokens` is set and `pendingNewFamily !== true`.
- `sign-in.ts` (`storeGrant`)
  - `base` carries `generation`, `seenGeneration` and `heldGeneration` over from `snap?.row`, so both the unlinked row and the pending row keep them.
  - D-10: inside the lock and before either `putLocal`, it calls `revokeOrdinaryPending(snap.row, mk, ensure)` in a try/catch that swallows errors. `EnsureDeps` is structurally a `PublishDeps`, so `ensure` is passed directly.
  - The unlinked path also revokes a stranded ordinary pair, because it too drops that row.

### Tests
- `tests/mcp/oauth/ensure-token.test.ts`
  - New describe `grant generations on compare-and-set writes`:
    - "each push kind pushes max(seen, base)+1": the full refresh pushes claim 8 then publish 9, and the row ends at generation 9 with seen 9. A release after a 503 pushes 9 over claim 8. `invalid_grant` pushes `tokens: null` at 9.
    - "a failed push leaves local generation and seen untouched".
  - In `publishNewFamily`: "new family re-push after conflict stamps max(seen, current)+1" (pushes are `[10, 13]`) and "new family falls back to the local generation when current does not open" (seen 9, local 11, poison conflict, pushes `[12, 12]`).
  - In `the device harness`: "a v0.3.5-shaped push is accepted".
  - New helper `putNewer(s, row)`, which writes at the server's generation + 1.
- `tests/mcp/oauth/sign-in.test.ts`
  - New describe `grant generations on a new sign-in`:
    - "storeGrant keeps the high-water mark": pushes `[10]`, and the hold is cleared on ok.
    - "a refused record mid-sign-in keeps the pending pair and the push still carries the mark": adopt returns `refused`, the pending new-family pair is intact with held 4, and every push carries generation 10.
    - "sign-in revokes an ordinary pending pair it replaces": exactly one revocation, and it matches that pair's refresh token. Comparisons are by count or boolean only, so no token is printed.
    - "a new-family pending pair a sign-in replaces is not revoked".
  - Fixed the test store's `ciphertextHash` on refusal: it now keeps `meta?.ciphertextHash`.

## Concern: fixtures changed in existing tests
Five existing ensure-token tests (13, 15, 18, 31, 27e) started failing after implementation. They simulate another device writing a newer row with `s.cas.put(grantRow(...))`, which carries no generation (= 0). The device's own claim had already raised its seen mark to 1 or more, so the correct new rule refused those writes. Those writes now go through `putNewer`, which models an up-to-date v0.3.6 writer. A writer without a generation is exactly the §5.6 rollout case where a refusal is accepted. No assertions changed; only the generation on these simulated foreign writes did.

## Order of work
The implementation was written before the new tests. Red was then shown by stashing only `src`: `git stash push -- apps/user-client/src`, run, `git stash pop`. With the old source, 7 of the new tests fail, and every pre-existing test still passes:
```
Tests  7 failed | 94 passed (101)
```
The 7 are every new test except "v0.3.5-shaped push is accepted" and "new-family pending pair ... not revoked". Those two pin behaviour that already held, as intended.

## Command outputs
- `pnpm --filter @chatsundere/user-client exec vitest run tests/mcp/oauth/ensure-token.test.ts tests/mcp/oauth/sign-in.test.ts`: `Test Files 2 passed (2) / Tests 101 passed (101)`
- `pnpm --filter @chatsundere/user-client test`: `Test Files 654 passed (654) / Tests 4337 passed (4337)`. The output also contains stack-trace lines from vitest-runner, but every file and test passed.
- `pnpm --filter @chatsundere/user-client typecheck`: clean (exit 0).
- `pnpm exec biome check` on the 5 changed files: `Checked 5 files in 50ms. No fixes applied.`

## Mutations (after `git add`; each restored with `git checkout -- <file>`)
1. Release left unstamped (`{ ...claimed, claim: null }`) in `ensure-token.ts`. FAILS "each push kind pushes max(seen, base)+1" (1 failed / 100 passed).
2. Carry-over in `storeGrant` dropped (the three generation lines removed). FAILS "storeGrant keeps the high-water mark" and "a refused record mid-sign-in ..." (2 failed / 99 passed).
3. Local base used on a new-family conflict (`opened ? generationOf(row) : ...`). FAILS "new family re-push after conflict stamps max(seen, current)+1" (1 failed / 100 passed).

After the restores, `git status` shows only the staged changes.


### Appendix — Task 6

#### Task 6 report: `held` in the refresh algorithm

Status: DONE (work staged, not committed).

## Changes

### `apps/user-client/src/mcp/oauth/ensure-token.ts`
- `EnsureResult` reason union gains `'held'`.
- New internal `blocked(row) = isGrantHeld(row) && !(row.pendingTokens && row.pendingNewFamily === true)`.
- `linkedFlow`: `blocked` check after the step-2 snapshot (top of every iteration) and after step 3's re-snapshot; claim conflict returns `held` when `adopt` is `'refused'`.
- `releaseClaim` now returns `AdoptOutcome | null` (null when no conflict); `frozen` (unsent), `failed` and `in-doubt` callers return `held` on `'refused'`.
- `invalid` conflict: refused adopt → `held`; `adoptedOr` returns `held` when the re-snapshot is blocked.
- After `publishPending` in `refreshUnderClaim`: `adopted` → `adoptedOr` (which re-checks the hold); `kept` → re-snapshot, blocked → `held` (plan D-9: pair stays pending, claim not released).

### `apps/user-client/src/mcp/oauth/grant-publish.ts`
- Entry: `isGrantHeld(row) && !newFamily → 'kept'`. Placed **after** the unlinked branch, deliberately: an unlinked device must still promote its pending pair, otherwise `unlinkedFlow` would present the token the pair replaced. (Link reset clears the hold anyway, so a held unlinked row should not arise.)
- Ordinary conflict with an opened `current` where `generationOf(current) < seenOf(row)` → `adopt(result.current)` and `'kept'`, no `CLEARED_PENDING`.
- "Newer rotation won" adopt returning `'refused'` → `'kept'` without `CLEARED_PENDING`.
- New-family branch unchanged (never blocked).

### `apps/user-client/src/mcp/oauth/grant-store.ts`
- `adoptOutcomeOf` exported (for its unit test).

### Tests
- `tests/mcp/oauth/ensure-token.test.ts`: new `describe('a held grant (hardening spec §5.3, §5.4)')`:
  - held returns without pushing or fetching (also a still-valid access token is not returned while held);
  - §5.6 rollout: a v0.3.5-shaped new sign-in (no `generation`) after seen 3 → `heldGeneration 0`, `ensure()` → `held`;
  - claim conflict with an older current → `held`, exactly one push, no token POST;
  - adopting the same refused current twice still holds (a pull refuses first, the claim conflict's adopt is `stale`, the top-of-loop check returns `held`);
  - `it.each` over the four §5.3 paths (claim conflict, release conflict via 503, `invalid_grant` conflict, publish adopt): older current → `held`, push count stops at the raced push, refused revision in `device.revs`, local row equal to before except `heldGeneration`; equal current → applied, `heldGeneration null`, `seenGeneration` raised, adopted tokens in the row, token returned (release path returns `waiting` as before);
  - a refusal during publish keeps the pending pair (direct `publishPending` → `kept`, four pending fields unchanged, held set);
  - an ordinary pending pair stays unpublished while held (`publishPendingTokens`, `publishNewFamily`, `ensure()` push nothing) and publishes once a pull at the seen generation clears the hold;
  - D-9: refusal injected after the claim's `ok` → `held`, one push only (no release, no publish), pending pair and own claim kept;
  - a new sign-in publishes while held: `storeGrant`-shaped row (generation fields carried over), first publish `network` → `ensure()` returns the new family's token; `publishPendingTokens` then publishes at generation 6 and the row ends `heldGeneration null`.
- `tests/mcp/oauth/grant-store.test.ts` (new): `adoptOutcomeOf` maps `inserted`/`resolved(pulled)` → adopted, `refused` → refused, `resolved(local)`/`echo`/`stale` → stale.

### Exhaustive switches
`pnpm --filter @chatsundere/user-client typecheck` was clean after adding `'held'`: no switch on `EnsureResult['reason']` is exhaustive at the type level, so nothing needed a passthrough. No Task 7 copy written; `held` currently falls into the existing default branches.

## Command outputs
- Red (implementation stashed): `vitest run tests/mcp/oauth/ensure-token.test.ts` → `Tests 11 failed | 56 passed (67)`. The new-sign-in test passed pre-implementation as expected (no hold check existed); it guards the exemption mutation below.
- Green: `vitest run tests/mcp` → `Test Files 21 passed (21)`, `Tests 448 passed (448)`.
- Typecheck: clean (both tsconfig passes).
- Biome on the five changed files: clean after `--write` (formatting only).
- Full user-client suite (`pnpm --filter @chatsundere/user-client test`): `Test Files 655 passed (655)`, `Tests 4356 passed (4356)`.

## Mutations (each after `git add`, restored with `git checkout -- <file>`)
1. Removed the top-of-loop `blocked` check in `linkedFlow` → 3 failed (held-entry, §5.6 rollout, "adopting the same refused current twice still holds"). Restored.
2. `blocked` without the `newFamily` exemption (`return isGrantHeld(row)`) → 1 failed ("a new sign-in publishes while held…"). Restored.
3. Cleared pending on the refused-older-current adopt in `publishPending` (added `writeLocal(CLEARED_PENDING)` before `'kept'`) → 2 failed ("publish adopt: an older current holds…", "a refusal during publish keeps the pending pair"). Restored.
4. Extra: removed `publishPending`'s entry hold check → 2 failed ("an ordinary pending pair stays unpublished…", D-9 test). Restored.

## Notes for the controller / Larissa
- D-9 behaviour as planned: a refusal between a won claim and its publish returns `held`, keeps the fresh pair pending and leaves our claim unreleased. The refresh POST under the won claim is still sent if the refusal lands after the claim `ok` but before `present` (the device did win that token); there is no snapshot between claim and present.
- `unlinkedFlow` does not check the hold (sync concept; link reset clears it).

---

## Fix round 1 (review minors on 9108bb4)

Status: DONE (staged, uncommitted). Touched only `src/mcp/oauth/ensure-token.ts`, `src/mcp/oauth/grant-publish.ts`, `tests/mcp/oauth/ensure-token.test.ts`. The other agent's discovery-related files were not touched.

1. **`ensure-token.ts`**: new `heldAfterRelease(run, outcome)`. Without a conflict (null) it returns false, and on `'refused'` it returns true. For any other outcome (e.g. `'stale'`, because a pull already recorded the refusal) it re-snapshots and returns `blocked(row)`. The unsent `frozen` path and the `failed` and `in-doubt` paths now use it to return `held`.
   Test: "a release conflict whose current a pull already refused still holds". This is a failed refresh (503). Before the release push, an older body (generation 2) is put and the device pulls it, so the release conflict's adopt is `stale`. The result is `held`, with two pushes and `heldGeneration 2`.
2. **`grant-publish.ts`**: before each re-push attempt (attempt > 0), the hold and the seen generation are read from a fresh snapshot.
   - No snapshot → `kept`.
   - Held and not a new family → `kept`.
   - Otherwise `seen` is updated to the higher of the old value and the snapshot's seen generation. The older-current comparison uses `seen`, and the stamp gets it via `stampForPush({ ...body, seenGeneration: seen }, …)`, so a raised mark also lifts the pushed generation.
   - The new-family exemption is kept.
   Test: "a hold that lands between publish re-pushes stops the next one". The first publish push conflicts with a current at generation 6 that holds the spent token, which would normally be re-pushed. The hold is set after that push, and `publishPending` → `kept` with no second push and the pending pair intact.
3. **`grant-publish.ts`**: the older-current branch now has a why-comment: the adopt outcome is ignored on purpose, because whether it is refused or stale, the pair is kept.

Commands:
- `pnpm --filter @chatsundere/user-client exec vitest run tests/mcp/oauth` → `Test Files 13 passed (13)`, `Tests 330 passed (330)`.
- typecheck exit 0.
- biome clean on the three files.
- Full suite not run, as instructed.

Mutations (after `git add` of the three files, restored with `git checkout -- <file>`):
- M5: `heldAfterRelease` reduced to `released === 'refused'` → 1 failed ("a release conflict whose current a pull already refused still holds"). Restored.
- M6: removed the fresh-snapshot hold check before a re-push → 1 failed ("a hold that lands between publish re-pushes stops the next one"). Restored.


### Appendix — Task 7

#### Task 7 report — what the user and the model see for a paused grant

Status: DONE. Work is staged (`git add`), not committed.

## Changes (apps/user-client)

- `src/mcp/server-status.ts` — `oauthStatus` uses `isGrantDead` then `isGrantHeld`: signing in, no grant, dead (`⚠ Sign in again`), held (`⚠ Sign-in paused here`), then proxy waits and the rest.
- `src/components/mcp/OAuthConnectionPanel.tsx` — the paused paragraph (verbatim spec copy) sits under the "Signed in at" line in the page's note style (aurora border/bg, `text-xs text-paper-soft`) when `isGrantHeld(grant)`. *Sign in again* shows when the grant is present and `!isGrantLive(grant)`, i.e. dead or held. The disabled reasons it already had are unchanged. An absent grant still gets no button, as before.
- `src/components/mcp/McpAuthNotice.tsx` — `live = isGrantLive(grant)` drives the `dead`/`scope` flips and the new `held → ● X: in use`. A `held` pill whose grant `isGrantHeld` reads `⚠ X: sign-in paused on this device` with *Sign in again* (same `open({serverId, extraScopes: []})` and class-2 gate). If the grant is dead or missing it falls through to `⚠ X: sign-in ended`. Local `held` renamed to `granted` (D-5).
- `src/mcp/mcp-tools.ts` — `McpAuthNotice['variant']` gains `'held'`. The `why` wording for held gives the verbatim model copy, and `tokenFailure` maps `case 'held'` to `notice(server, 'held')`.
- `src/mcp/oauth/connect-server.ts` — `HELD_ERROR` const. `tokenError` has a `'held'` case, and `testOAuthConnection` returns `{ ...failed(HELD_ERROR), held: true }` on a `held` token result.
- `src/mcp/types.ts` — `McpConnectionResult.held?: true`.
- `src/routes/app/integrations/server.tsx` — new `testNote` state. On `result.held`, `applyTestResult` sets only `testNote` and `test: done` and returns. `routing`, `resolvedEndpoint`, `lastTestedAt`, `lastError`, `tools` and `dirty` are left as they were. Any other result clears `testNote`, and so do `onTest` (at its start) and `clearTestResult`. The note renders in the test-result block in note style.

## Tests

- `tests/mcp/server-status.test.ts` — held with tokens gives paused; held + dead gives Sign in again; held + proxy tokens without proxy gives paused (above waiting).
- `tests/components/oauth-connection-panel.test.tsx` (new) — held shows the paragraph and an enabled *Sign in again* that calls the handler; held + `backendUnreachable` is disabled with `SIGN_IN_WAITS_FOR_BACKEND`; a live grant shows neither; an absent grant has no button.
- `tests/components/mcp-auth-notice.test.tsx` — held + held grant shows paused text and the button opens `{ serverId: 's1', extraScopes: [] }`; held + gate is disabled; held + live grant shows `● Kumbu: in use` with no sign-in button; held + dead grant and held + no grant (it.each) show `sign-in ended` and the button; dead + held grant (tokens present) shows ended, not connected again; scope + held shows Grant access, not access granted.
- `tests/mcp/mcp-tools.test.ts` — the reason table gains `['held','held']`, plus an exact-string test of the model copy (`not.toMatch(/has ended/)`, `variant: 'held'`).
- `tests/mcp/oauth/connect-server.test.ts` — `held` gives `{ ok:false, held:true, error:'Sign-in paused on this device. Sign in again to carry on.' }` and makes no server contact.
- `tests/component/integration-server.test.tsx` — row with `lastError: 'HTTP 503', lastTestedAt: 5`. Test connection on held shows the paused line, and the test block does not repeat `HTTP 503` (only the status line names it). A following Save writes `lastError: 'HTTP 503'`, `lastTestedAt: 5`, `routing: 'proxy'` and the resolved endpoint unchanged, and no consent is recorded.

### Runs
- Step 2, with src stashed: `vitest run <6 files>` gave `Test Files 6 failed (6)`, `Tests 12 failed | 116 passed (128)`. The held+dead status and held-on-dead/missing-grant pill cases already passed through the old fallbacks, as intended.
- Step 4: `Test Files 6 passed (6)`, `Tests 128 passed (128)`.
- Full suite `pnpm --filter @chatsundere/user-client test`: `Test Files 656 passed (656)`, `Tests 4382 passed (4382)`.
- `pnpm --filter @chatsundere/user-client typecheck`: clean.
- `pnpm exec biome check <13 files>`: "Checked 13 files … No fixes applied." (`--write` had earlier fixed formatting in 3 files.)

### Mutations (each restored with `git checkout -- <file>`)
1. `server-status.ts`: held check moved above the dead check. `vitest run tests/mcp/server-status.test.ts` FAILED: "reads as Sign in again when the held grant is also dead" (1 failed | 4 passed).
2. `McpAuthNotice.tsx`: `dead` flip reverted to the old local test `grant.tokens !== null || pendingTokens`. `vitest run tests/components/mcp-auth-notice.test.tsx` FAILED: "a dead notice whose grant is held never reads as connected again" (1 failed | 20 passed).
3. `mcp-tools.ts`: `case 'held'` changed to `notice(server, 'dead')`. `vitest run tests/mcp/mcp-tools.test.ts` FAILED: both held tests (2 failed | 37 passed).

## Decisions / deviations
- While `testNote` shows, the test block hides the `✗ lastError` and `● Connected` lines. Otherwise a stale earlier result would sit next to the paused note and read as this test's result. The status line in the panel still shows the row's saved `lastError`, as it is the row's saved status.
- The test note shows the copy verbatim with no `⚠` prefix, to keep the spec string exact.
- Panel: the paused paragraph shows whenever the grant is held, including held + dead; the status line then says `⚠ Sign in again`. The paragraph is still true in that case.
- `tokenError` also maps `'held'`, even though `testOAuthConnection` short-circuits before reaching it. This keeps the switch complete.
- `discovery.ts` and its tests were not touched.

## Fix round after review (on top of bf1887a)

Staged, not committed. Only my four files were touched and staged; the other agent's SignInScreens/OAuthSignInFlow files were left alone.

1. `src/components/mcp/OAuthConnectionPanel.tsx` — the paused paragraph now shows only when `isGrantHeld(grant) && !isGrantDead(grant)` (dead first, as in the list status). New test in `tests/components/oauth-connection-panel.test.tsx`: a held+dead grant has no paragraph and an enabled *Sign in again*. This replaces deviation 3 above.
2. `tests/component/integration-server.test.tsx` — the held Test-connection test now uses a genuinely held grant (`heldGeneration: 4, seenGeneration: 9`). It asserts the panel status `⚠ Sign-in paused here` and that `HTTP 503` appears nowhere on the page, because the pause outranks the saved error in the status line. The comment is corrected to match. The Save assertions (lastError/lastTestedAt/routing/endpoint unchanged) are as before.
3. `tests/components/mcp-auth-notice.test.tsx` — held pill with a held grant whose only access is a pending pair: reads as paused (not in use), with *Sign in again*.

Runs:
- `pnpm --filter @chatsundere/user-client exec vitest run tests/components/oauth-connection-panel.test.tsx tests/component/integration-server.test.tsx tests/components/mcp-auth-notice.test.tsx` → `Test Files 3 passed (3)`, `Tests 79 passed (79)`.
- typecheck: clean. `pnpm exec biome check` on the 4 files: "Checked 4 files … No fixes applied."
- Mutation: dropped `&& !isGrantDead(grant)` from the panel. `vitest run tests/components/oauth-connection-panel.test.tsx` FAILED with "a held grant that is also dead offers Sign in again without the paused paragraph" (1 failed | 4 passed). Restored with `git checkout -- src/components/mcp/OAuthConnectionPanel.tsx`; the re-run is green.


### Appendix — Task 8

#### Task 8 report

Status: DONE

## Changes
- `apps/user-client/src/mcp/oauth/discovery.ts`: added required `OAuthDiscovery.viaProxy: boolean`. One helper `getDirectFirst(target)` (direct; on a `TypeError` with `hasProxy`, proxy; otherwise `'network'`) now serves the pointer, the well-known guesses and the authorisation server candidates (replacing `getResource` and `getAs`). Pointer `'network'` throws `OAuthError('network', "Couldn't reach this server's sign-in details.")`; a guess `'network'` counts as missing. The probe keeps its `route`. `viaProxy` = PRM source || AS metadata source.
- `tests/mcp/oauth/discovery.test.ts`: new describe "direct first and viaProxy" (6 tests: probe on proxy but pointer direct, TypeError-only fallback with non-TypeError giving `network` and no proxy call, guesses, AS-only proxy, all direct false, Review Focus 5 no-proxy guess gives `no-oauth`).
- Fixtures given `viaProxy: false`: `tests/component/integration-server.test.tsx`, `tests/components/oauth-sign-in-flow.test.tsx`, `tests/mcp/oauth/check-server.test.ts`, `tests/mcp/oauth/sign-in.test.ts`.

## Results
- discovery test: 42 passed. Typecheck clean. Biome clean on changed files.
- Full user-client suite: 655 files, 4362 tests passed.

## Mutations (each restored with git checkout)
1. Fallback on any error (`if (!hasProxy) return 'network'`): "falls back to the proxy for the pointer only on a TypeError" FAILED (1 failed, 41 passed).
2. `viaProxy` from AS only: "falls back ... pointer" and "applies the same rule to the well-known guesses" FAILED (2 failed).

## Notes
- Deviation: I wrote implementation before running the red step, so the red run was not observed; the mutations show the tests bite.
- I staged only my files (discovery.ts, the 5 test files). Other working-tree changes (ensure-token.ts, grant-publish.ts, ensure-token.test.ts) belong to another agent and are unstaged.


### Appendix — Task 9

#### Task 9 report: L3 confirmation line

Status: DONE_WITH_CONCERNS

## Changes (staged, uncommitted)
- apps/user-client/src/components/mcp/SignInScreens.tsx: `SignInConfirm` gains `viaProxy: boolean`; renders the verbatim spec line as `<p className={noteClass}>` directly after the "You'll sign in at ..." paragraph.
- apps/user-client/src/components/mcp/OAuthSignInFlow.tsx: `hosts` state gains `viaProxy` (from `props.discovery.viaProxy`, default false); the re-check in `startAgain` sets it from `d.viaProxy`; the resume path keeps the existing flag (`setHosts((h) => ...)`); passed to `SignInConfirm`.
- tests/components/sign-in-screens.test.tsx (new): true shows line directly after the sign-in-at paragraph with Continue enabled; false hides it.
- tests/components/oauth-sign-in-flow.test.tsx: discovery viaProxy true shows the line; false omits; re-check true shows; re-check false omits.

## Results
- Targeted: 2 files, 47 tests passed.
- Full user-client suite: 657 files / 4390 tests passed (one first run had 1 unidentified failure, not reproduced on a clean rerun; output was grep-filtered so the test was not identified; likely flake).
- typecheck clean; biome clean on the 4 files.

## Mutations
1. SignInScreens: `props.viaProxy ?` -> `true ?`: 3 failed (both "omits" flow tests, screens "omits").
2. OAuthSignInFlow re-check `viaProxy: d.viaProxy` -> `false`: 1 failed ("takes the proxy flag from the re-check").
Both restored via git checkout.

## Deviations / concerns
- Red step (Step 2) was not run before implementing; mutations prove the tests bite.
- The re-check only occurs when the flow has no discovery (resumed via `state`), where the initial flag is false (pending rows carry no flag). So "re-check false removes a true line" cannot be staged literally; the test covers re-check true shows and re-check false omits.
- Resumed flows without a re-check never show the line (flag unknown); acceptable per the brief's scope.


### Appendix — audit fix wave

#### Audit fix wave (Larissa + Laura) — report

Status: DONE. All work is staged (`git add`), nothing committed. Only `apps/user-client` touched.

## F1 (Larissa M1) — drop D-10

- Change: removed `revokeOrdinaryPending` from `src/mcp/oauth/grant-publish.ts` and its call (plus import) in `src/mcp/oauth/sign-in.ts` `storeGrant`. An ordinary pending pair is again dropped without revocation when a sign-in replaces the row.
- Test: `tests/mcp/oauth/sign-in.test.ts` — the two D-10 tests were replaced by one: "sign-in replacing an ordinary pending pair sends no revocation" (no revocation POST, new family published, pending cleared).
- Red: 1 failed (`expected 1 to be +0`). Green: 49/49.
- Mutation: put back a revocation of the ordinary pending pair in `storeGrant` (via `revokeHeld`) → the new test FAILS; restored.
- Docs: `obsidian/insights/security-deferrals.md` already describes M1 as fixed; nothing else to change.

## F2 (Larissa L1) — viaProxy from a proxied challenge

- Change: `src/mcp/oauth/discovery.ts` — `challengeViaProxy = route === 'proxy'`. `viaProxy` is set when the protected resource metadata came from the challenge's `resource_metadata` pointer on a proxied probe, or when the challenge's `scope` is the scope base on a proxied probe. Field JSDoc updated.
- Tests (`tests/mcp/oauth/discovery.test.ts`): "reports viaProxy when the metadata pointer came from a proxied challenge" (proxy → true, direct → false); "reports viaProxy when the scope came from a proxied challenge" (well-known PRM + challenge scope on a proxied probe → true; the control with no challenge scope or pointer → false). The existing "goes direct first for the pointer even when the probe used the proxy" now expects `viaProxy: true` (it still checks the PRM was fetched direct).
- Red: 3 failed. Green: 44/44.
- Mutations: (a) pointer branch back to `viaProxy = got.viaProxy` → the pointer test FAILS; (b) drop the challenge-scope term → the scope test FAILS. Both restored.

## F3 (Larissa L2) — `written` on a direct ok

- Change: `src/sync/worker.ts` — `DirectPushResult` is now `(ok & { written?: boolean }) | other SyncPushResult | network | epoch-mismatch` (compatible); `pushRecordDirect` returns `{ ...result, written }` on every ok, false when the write-back was skipped (stale link generation or `result.rev <= existing.rev`). `src/mcp/oauth/grant-publish.ts` `publishPending`: on ok with `written === false` it re-snapshots; held → `'kept'` with all four pending fields intact; otherwise clears the pending pair as before.
- Test doubles: `ensure-token.test.ts` `Device.store.push` reports `written` (from `writeIfHigher`, now returning boolean) and gains a `beforeWriteBack` hook that runs between the server accepting a push and the local write-back; `sign-in.test.ts` `casStore.push` reports `written`.
- Tests: `ensure-token.test.ts` (in "a held grant"), for an ordinary pair and a new-family pair each: "…accepted but not written back while a hold lands is kept" (a replay at generation 2 lands above the accepted revision and is refused → `kept`, held 2, all four pending fields equal) and "…accepted but superseded before the write-back is cleared" (a newer accepted generation 50 → `published`, pending cleared). `push-record-direct.test.ts`: existing ok results now expect `written: true`, the lower-revision case `written: false`, and a new "an ok after an engine reset reports written: false and writes nothing".
- Red: 2 failed in ensure-token (`expected 'published' to be 'kept'`), 5 in push-record-direct (missing `written`). Green: all pass.
- Mutations: (a) ignore the re-snapshot hold in `publishPending` → both "kept" tests FAIL; (b) `written: true` always in the worker → lower-revision and engine-reset tests FAIL. Both restored.

## F4 (Larissa L3) — direct ack never lowers the mark

- Change: `src/sync/worker.ts` — new private `ackedGrantRow(stored, pushed)`, used inside the same `pushRecordDirect` transaction for `mcpOAuthGrants`: `seenGeneration = max(seenOf(stored), seenOf(pushed))`; `heldGeneration` = null only when `ackFields(stored, generationOf(pushed))` grants it (pushed generation ≥ stored seen), else the stored hold is kept. Uses `seenOf`, `generationOf`, `ackFields`.
- Tests (`push-record-direct.test.ts`): "an ok never lowers seen nor clears a hold below the stored mark" (stored seen 12 held 4; ok of gen 9/seen 9 → seen 12, held 4, generation 9); "an ok at or above the stored mark raises seen and clears the hold" (gen 13 → seen 13, held null).
- Red: the first failed. Green: 17/17.
- Mutation: `ackedGrantRow` returns the pushed row unchanged → "never lowers" FAILS; restored.

## F5 (Laura H1) — display liveness

- Change: `src/mcp/oauth/grant-generation.ts` adds `isGrantPaused(row)` = `isGrantHeld(row) && !(row.pendingTokens && row.pendingNewFamily === true)` (JSDoc: display only, never a gate); `isGrantLive` uses it. `src/mcp/server-status.ts`, `src/components/mcp/OAuthConnectionPanel.tsx`, `src/components/mcp/McpAuthNotice.tsx` use `isGrantPaused` where they tested held. The gates (`ensure-token.ts` `blocked`, `grant-publish.ts`) keep `isGrantHeld` + their own exemption.
- Grep: `grep -rn "isGrantLive\|isGrantPaused" src/mcp/oauth/ensure-token.ts src/mcp/oauth/grant-publish.ts src/sync/` → no matches (exit 1).
- Tests: `grant-generation.test.ts` (`isGrantLive` held + new-family pair → true, held + ordinary pair → false; new `isGrantPaused` cases, including a new-family flag with no pair, which exempts nothing); `server-status.test.ts` "a held grant with a new sign-in pending shows its normal status" (`● Connected (direct)`); `oauth-connection-panel.test.tsx` "…shows no paused paragraph and no Sign in again"; `mcp-auth-notice.test.tsx` "held: a held grant with a new sign-in pending says in use and offers no action".
- Red: 5 failed. Green: 49/49 across the four files.
- Mutations: (a) `isGrantPaused` loses the exemption → 5 FAIL; (b) `isGrantLive` back to `isGrantHeld` → 3 FAIL (live, panel, pill). Both restored.

## F6 (Laura S3) — stale comment

- `McpAuthNotice.tsx`: the comment now reads "A held pill with no grant on this device falls back to the ended rendering." Comment only, so no test and no mutation.

## Commands (real output summaries)

- `pnpm --filter @chatsundere/user-client exec vitest run tests/mcp tests/sync tests/components tests/component` → Test Files 213 passed (213), Tests 1721 passed (1721) (run before the last biome-only edits; the touched files were re-run green afterwards).
- `pnpm --filter @chatsundere/user-client test` (full suite, final) → Test Files 657 passed (657), Tests 4402 passed (4402), 281 s. Stack traces appeared on stderr during the run, but no test failed.
- `pnpm --filter @chatsundere/user-client typecheck` → clean (an earlier run caught a test cast in `server-status.test.ts`, now fixed).
- `pnpm exec biome check <16 changed files>` → "Checked 16 files … No fixes applied", no errors (after `--write` formatting and removing one comma operator in a test).

## Decisions / deviations

- `written` is optional on the ok type, so a store without it counts as written (today's behaviour). `pushRecordDirect` always sets it explicitly.
- F3 "kept" applies to the new-family pair too, as the brief says. Its later re-publish uses the new-sign-in rule, so it overwrites the refused revision with this device's own fresh family.
- The `Device` double copies the pushed row verbatim on write-back and does not mirror F4's merge. The F4 behaviour is tested against the real `pushRecordDirect`.

---

#### Follow-ups after 974aa03

Staged, not committed. Only `apps/user-client` touched; the unrelated `obsidian/` changes already in the tree were left alone.

## FU1 — a direct ok below the stored mark never replaces the row

- Change: `src/sync/worker.ts`. `ackedGrantRow` returns null when `ackFields(stored, generationOf(pushed))` is null. When that happens, `pushRecordDirect` keeps the stored content and only moves `syncRows.rev` to `result.rev`. It keeps the old ciphertext hash, or uses `''` if there was no row, and writes no `localContentHash`. It reports `written: false` and invalidates the grants query.
- **Deviation (stricter than the brief):** the same transaction also sets `heldGeneration` to the pushed generation, the way a refused pull does (spec §5.3). Without a hold, the `written: false` result would send `publishPending` down its "superseded" branch. That branch clears the pending pair, so a pair this device may be the only holder of could be discarded after a hostile ack. With the hold, `publishPending` returns `kept`. This uses `table.put({ ...stored, heldGeneration })`, not `update`: in fake-indexeddb, Dexie's `update` turned the stored `Uint8Array`s into plain objects. That is a test-environment quirk, but `apply.ts`'s refused branch uses `update` and would show the same thing in tests.
- Test (`tests/sync/push-record-direct.test.ts`): "an ok below the stored mark moves only the revision, never the row". It replaces the earlier "never lowers seen" test, whose expectation (generation-9 content written) this change makes obsolete. Stored row: tokens A, generation and seen 12. Direct ok of a row stamped 9 with tokens B gives `written: false`, tokens still A, generation and seen 12, `heldGeneration` 9, `syncRows.rev` 3, ciphertext hash unchanged.
- Mutations: (a) `if (!ack) return pushed;` makes the test FAIL; (b) the hold not set makes the test FAIL. Both restored.

## FU2 — display and gate agree

- Change: new `hasPendingNewSignIn(row)` in `grant-generation.ts`, used by both `isGrantPaused` (display) and the gate in `ensure-token.ts`. The gate is now exported as `isHoldBlocking`, renamed from the private `blocked`; all call sites were updated and the gate name is kept apart from the display one.
- Test (`tests/mcp/oauth/grant-generation.test.ts`, "display and gate agree"): held null/0/4 × no pending pair / ordinary pair / new-family pair / a new-family flag with no pair. `isGrantPaused === isHoldBlocking` in every case, and both match `held && !hasPendingNewSignIn`.
- Mutation: the gate exempts on `pendingNewFamily` alone, so the two stray-flag cases FAIL; restored.

## Commands

- `pnpm --filter @chatsundere/user-client exec vitest run tests/sync tests/mcp`: 82 files passed, 962 tests passed.
- `pnpm --filter @chatsundere/user-client typecheck`: clean.
- `pnpm exec biome check` on the 5 changed files: no errors.
