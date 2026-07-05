# Session brief — pre-release blocker fixes (v0.2.0)

**Author:** Liz · **Date:** 2026-07-05 · **For:** the next fresh session
**Branch:** `full-backend-transition` (working tree confirmed at Dexie **v34** with the
full trashcan/blob/sync engine present — the STATUS-TRANSITION "diverged to v32"
note is stale; integration has happened).

## What this session is

Fix the six release-blockers surfaced by the 2026-07-05 three-way deep audit
(auth / device-pairing / client-sync), **one commit per solved blocker → six
commits total**, in one run. Every finding below was traced in actual code and
independently re-verified by Liz; the file:line anchors are current as of
`89b2b7ad`.

This is also Chris's Claude Code learning path, so the brief is deliberately
explicit about *why* each fix is shaped the way it is and *how* the workflow
(TDD → gates → audit → commit) hangs together. Chris reads each fix approach
before it is implemented (spec-review is how he learns the feature) — pause for
his read on #4 and HIGH-1 specifically, which carry a genuine design micro-choice.

## Where to work (CLAUDE.md §8)

Cut a dedicated worktree from the `full-backend-transition` tip — do **not** fix
in the shared main tree:

```
git worktree add .claude/worktrees/pre-release-blockers -b fix/pre-release-blockers full-backend-transition
```

Do the six commits there. This keeps the main tree free and — crucially — lets
Larissa audit against **absolute worktree paths** (a relative path reads the stale
main-tree copy and can vacuously "pass" — see memory `worktree-audit-absolute-paths`).
After the audit + Chris's device-verify, fast-forward `full-backend-transition`
onto the branch. Pushing `full-backend-transition` is inert (no CI, no deploy —
workflows trigger only on `master`/tags), so checkpoint-push freely.

## The 6-commit contract

Order groups the audit surfaces: onboarding (client-only) → sync cluster (Larissa)
→ auth (Larissa). None depend on another to compile, so the order is about review
ergonomics, not build order.

| # | Commit | Blocker | Audit path |
|---|---|---|---|
| 1 | Probe the linked server after onboarding so a fresh device syncs | Pairing empty-vault | client-only |
| 2 | Surface a wrong passphrase inline during pairing and align the error code | Pairing dead-end | client-only |
| 3 | Cascade attachments and artefacts when a persona is deleted | Persona orphan leak | sync (Larissa) |
| 4 | Upload seal-time-minted blobs instead of dropping them in the drain | newBlobs dropped | sync (Larissa) |
| 5 | Preserve blob bytes when a restore is de-duplicated cross-device | HIGH-1 byte loss | sync (Larissa) |
| 6 | Revoke existing sessions on recovery | Auth recovery | auth-service (Larissa) |

**Gate before every commit** (memory `typecheck-is-the-ci-gate`,
`turbo-caches-typecheck`): `pnpm typecheck --force` + Biome clean + the touched
test suite. Run the **full** user-client vitest (not just the touched dir) on the
sync commits (memory `per-task-review-runs-full-suite`). Baseline: 8 Node-localStorage
failures may or may not manifest depending on the runner; a 9th is the known
`stream-manager-store` parallel-load flake (passes in isolation) or real.

Commit message style: free-form imperative, capitalised subject, no Conventional
Commits prefix, `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`. All
six touch code, so **no `[skip ci]`** (and the branch is inert anyway).

---

## Commit 1 — Pairing empty-vault

**Severity:** release-blocker. **Path:** client-only.

**Mechanism (verified):** after a join succeeds, the confirm handler calls
`setLinked(linkedRow)` and navigates to `/app` — but nothing re-probes the
discovery endpoint. `probeServer` only persists the config when the URL is already
the linked one (`packages/ui-shared/src/state/discovery.store.ts:55-86`), which it
was not during onboarding. `canRunCycle` then fails on `!config?.syncUrl`
(`apps/user-client/src/sync/worker.ts:821-823`), so the engine no-ops — no pull,
no backfill pump — until a reload or an `online`/`visibilitychange` event chains
`maybeProbeLinkedServer`. Net effect: a freshly paired device lands in an **empty
vault** with no "pulling your data…" line.

**Fix:** call `maybeProbeLinkedServer()` immediately after each `setLinked` in the
onboarding confirm paths. It is already exported from `@chatsundere/ui-shared` and
guards on `linkStatus === 'linked'` internally, so it is safe to call right after
`setLinked`. Sites:
- `apps/user-client/src/routes/onboarding/pairing/confirm.tsx:110`
- `apps/user-client/src/routes/onboarding/invitation/confirm.tsx:178` **and** `:214` (both the late-link and fresh branches)
- `apps/user-client/src/routes/onboarding/recovery.tsx:83`

**Test:** a route/unit test that, after a stubbed successful join, asserts the
discovery store's config is populated (or that `probeServer` was invoked) so
`canRunCycle` can pass. If the existing onboarding tests stub the store, extend
them; otherwise a focused test on the confirm handler.

**Verify on device (Chris):** pair a fresh browser profile → land in `/app` →
data pulls **without** a reload or tab-switch. This is the one finding whose exact
severity a ten-minute device test settles.

---

## Commit 2 — Pairing wrong-passphrase dead-end + error-code drift

**Severity:** release-blocker (violates the constructive-error hard rule; burns the
3-attempt code budget). **Path:** client-only.

**Mechanism (verified, two stacked breaks):**
1. The common case never reaches the server: `opaqueLoginFinish` throws
   `CryptoError('wrong_passphrase')` client-side
   (`packages/crypto/src/opaque/client.ts:137`) *before* `/join/finish`. The
   pairing `mapError` handles only `CryptoError('conflict')`
   (`apps/user-client/src/routes/onboarding/pairing/confirm.tsx:266`), so
   `wrong_passphrase` falls through to the generic fatal
   "Something went wrong. Please try again."
2. Even the server path is mis-wired: the server emits
   `opaque_authentication_failed` (`apps/auth-service/src/routes/join.ts:442`),
   but the client checks `opaque_evidence_invalid`
   (`confirm.tsx:237`; the shared-types constant
   `packages/shared-types/src/join.ts:74`; the crypto `isEvidenceInvalidError`
   at `packages/crypto/src/flows/join-by-pairing.ts:330`). **The codebase proves
   the right pattern already:** `packages/crypto/src/flows/step-up.ts:120-121`
   matches *both* `wrong_passphrase` and `opaque_authentication_failed`.

**Fix (canonical form):**
- Add a `CryptoError('wrong_passphrase')` branch to the pairing `mapError` →
  `passphrase_inline` "Wrong passphrase." (mirror the existing `conflict` branch).
- Align the wire string in **one** place: change the shared-types constant
  `OpaqueEvidenceInvalid` value from `'opaque_evidence_invalid'` to
  `'opaque_authentication_failed'` (matching what the server actually sends and
  what step-up already expects). This fixes both consumers
  (`confirm.tsx:237` and `join-by-pairing.ts:330`) at the source. **Grep for
  every consumer of the constant before changing its value** and update any test
  that pins the old string (mock-vs-real drift class — memory
  `verify-tool-loop-answers`).
- Apply the same `wrong_passphrase` mapping to the **invitation** confirm handler
  (`apps/user-client/src/routes/onboarding/invitation/confirm.tsx:415`, the
  `CryptoError` branch) — the same dead-end exists there.

**Test:** feed each confirm handler's `mapError` a `CryptoError('wrong_passphrase')`
and an `HttpError('opaque_authentication_failed')` and assert both resolve to the
inline passphrase error, not the fatal screen. Add a regression asserting the
shared-types constant equals the string the server route throws (a cheap guard
against future drift).

**Verify on device (Chris):** on a second device, mistype the passphrase during
pairing → inline "Wrong passphrase", the code is **not** consumed, retry works.

---

## Commit 3 — Persona-delete cascade omits attachments and artefacts

**Severity:** release-blocker (permanent, uncleanable server orphans once accounts
are live). **Path:** sync (Larissa).

**Mechanism (verified):** `deleteChatCascade`
(`apps/user-client/src/data/chats.ts:212-278`) fully handles `attachments` and
`artefacts` — local delete, tombstone, trash snapshot, and `blob-delete`.
`deletePersonaCascade` (`apps/user-client/src/data/personas.ts:126-218`) enumerates
chats/messages/pills/avatar/memoryJournal/memoryBody but **not** attachments or
artefacts, and it does not delegate to `deleteChatCascade` per chat — it inlines.
So deleting a persona leaves the attachments/artefacts of all its chats: (a)
orphaned locally against dead chatIds (still visible in Treasury); (b) their server
records + blobs are never removed on any device — a permanent quota charge no later
client fix can reclaim without a migration; (c) restoring the persona re-materialises
chats under new ids while the orphans float against the dead ones.

**Fix:** in `deletePersonaCascade`, mirror the chat cascade. Enumerate
`attachments`/`artefacts` for the collected `chatIds`
(`db.attachments.where('chatId').anyOf(chatIds)`, same for artefacts), collect their
blob ids (attachments: `blobRef?.blobId`; artefacts: both `blobRef` and
`thumbBlobRef`), add both collections to `tables` and `cascade`, snapshot them in the
`intoTrash` branch, `bulkDelete` them in `write`, and enqueue their `blob-delete`s in
`blobOps`. Set each snapshot's `resolvePersona` to `id` (they lift to the persona
card). Keep it byte-identical when a persona has no chats with media (existing
persona-delete tests seed none).

**Also fold in MEDIUM-2 while here (cheap, same file class):** the chat cascade
omits `compactionCheckpoints`, contradicting the row's own doc-comment
(`apps/user-client/src/boot/client-data-db.ts:516`) and the trashcan spec. Add
`compactionCheckpoints` to `deleteChatCascade` (and by inheritance the persona
path) — enumerate by chatId, delete + tombstone + snapshot. If this widens the diff
uncomfortably, split it into its own commit **7** rather than bloat commit 3 (Chris's
call — the six-commit contract is about the blockers; MEDIUM-2 is a rider).

**Test:** delete a persona whose chat has an attachment and an artefact → assert the
attachment/artefact rows are gone locally, tombstones + blob-deletes are enqueued,
and (intoTrash) they are snapshotted under the persona card. Restore → they
re-materialise under the new chat id (this leans on commit 5's remap, so order 3
before 5 or assert only the delete side here).

---

## Commit 4 — Drain drops seal-time-minted blobs (`newBlobs`)

**Severity:** release-blocker (borderline; latent but converts a missed mint into
silent cross-device image loss). **Path:** sync (Larissa). **⚠ Design micro-choice —
Chris reads the approach first.**

**Mechanism (verified):** `prepareRecord` produces `PreparedRecord.newBlobs`
(`apps/user-client/src/sync/seal-batch.ts:131-160`) whenever a blob-bearing row
reaches the drain with bytes but no ref — `stripBlobsForSeal` mints a fresh
`blobId` into the wire row (`apps/user-client/src/sync/blob-transform.ts:205-216`).
But **no consumer of `newBlobs` exists in the drain** (`worker.ts`; grep confirms
only producers). Consequences: no `blob-put` is queued (PUT-before-record
violated → peers get a permanently dangling ref), and the ref is not written back
to the live row, so every re-seal mints a *different* id (record churn + more
dangling ids). Reachable today via a local-only-era trash snapshot (no refs)
restored after linking — `restoreCard` enqueues the upsert directly.

**Two candidate fixes — pick one with Chris:**
- **(A) Consume `newBlobs`:** in the drain, for each minted blob, write the new
  `blobRef` back to the live row and enqueue a `blob-put` *before* the record push
  (respecting PUT-before-record ordering). Fixes the fallback properly; keeps the
  image. More moving parts (live-row write-back mid-drain; guard against the row
  having changed).
- **(B) Refuse to mint at seal time:** if a blob-bearing upsert arrives with
  bytes-but-no-ref, treat it as a bug in the write-site path — push the field
  absent (placeholder) rather than fabricate an un-uploaded ref, and assert/log so
  the real missing mint is found. Simpler, but the image is not carried by this
  path (it relies on the write-site having minted correctly).

**Liz's lean:** (A) — the fallback should heal, not silently drop the image. But
this is exactly the kind of call Chris should make with the mechanism in front of
him. Whichever is chosen, the invariant to test is: **no record is ever pushed
carrying a blobRef whose bytes were not (or will not be) uploaded.**

**Test:** drive a drain of a blob-bearing upsert with bytes and no ref; assert
(A) a `blob-put` is enqueued for the minted id, the ref is persisted to the live
row, and a re-seal reuses the same id (no churn); or (B) the pushed record carries
no fabricated ref.

---

## Commit 5 — HIGH-1: preserve blob bytes on cross-device restore de-dup (Option A)

**Severity:** release-blocker by Chris's decision (Option A approved). **Path:**
sync (Larissa). **⚠ Chris approved Option A; read the shape before implementing.**

**Mechanism (verified end-to-end):** Device A soft-deletes a media chat →
snapshot holds the **bytes**, drain deletes the server blob objects → A's trash
snapshot is now the only copy of the originals anywhere (A's live rows gone; B
holds only thumbs). Device B restores the card (`restoreCard` clones the old
`blobRef`, does **not** re-upload bytes), enqueues upserts carrying
`restoredFrom`. A pulls B's upsert → `applyPulledBlobRow` yields a **placeholder**
(bytes absent — `blob-transform.ts:257-268`), then `retireRestoredTrash`
(`apply.ts:644-649` → `trash-repo.ts:127`) **deletes A's snapshot**. Originals now
exist nowhere: A placeholder, A trash gone, B thumbs only, server deleted, repair
heals only from live-row bytes. Irreversible.

**Fix (Option A — retire-time heal + re-PUT):** in `retireRestoredTrash`, before
deleting the snapshot, load it; if it holds bytes for a blob field that the
just-applied live row lacks, **copy the bytes into the live row** and **enqueue a
repair `blob-put` under the same `blobId`** so the server object is re-created and
peers (B) can fetch it. Then retire as before. Key correctness points:
- The restored upsert arrives in the same pull, so the live row exists when retire
  fires — but confirm ordering (apply the row, then retire) holds.
- Reuse the **existing** `blobRef.blobId` carried on the restored row (do not mint —
  it must match B's ref so B's fetch resolves), and go through the existing repair
  path (`resolveBlobFailure` / the §7.1 repair PUT machinery), not a bespoke upload.
- Guard: only heal fields where the snapshot has bytes and the live row does not
  (a no-op when the live row already holds bytes, e.g. single-device restore).

**Test (the regression that currently loses bytes):** simulate a→delete→drain
(server blob deleted) → b→restore→ a pulls the `restoredFrom` upsert. Before the
fix: A's live row is a placeholder and A's snapshot is deleted → bytes lost. After:
A's live row holds the bytes **and** a repair `blob-put` is enqueued under the
original id. Assert both.

**Note for the audit:** this is an escalation of the accepted "blob re-hydration on
restore" deferral. Update `obsidian/insights/security-deferrals.md` (or the ux
one) to record that the byte-loss variant is now **fixed**, so the deferral log
stops implying it is open.

---

## Commit 6 — Recovery does not revoke existing sessions

**Severity:** HIGH (recovery is the only compromise-response tool in a no-forgot-
password model). **Path:** auth-service (Larissa — mandatory).

**Mechanism (verified):** `POST /api/v1/recovery/finish`
(`apps/auth-service/src/routes/recovery.ts:176-209`) deletes all `auth_methods`,
inserts a fresh OPAQUE method, updates the recovery wraps, and issues new tokens —
but never calls `revokeAllForUser` or `denySub`. Refresh tokens are keyed on
`users.id`, not on `auth_methods`, so every pre-existing refresh-token family stays
live and rotatable, and pre-existing access tokens keep passing `bearerAuth`. An
attacker holding a stolen session survives the exact recovery meant to evict them.

**Fix:** mirror the logout-all path (`apps/auth-service/src/routes/auth.ts:25-27`):
after the recovery transaction commits, call `revokeAllForUser(user.id)` and
`denySub(createRedis(), user.id, nowSeconds())`. Order matters — the new tokens are
issued **inside** the transaction (recovery.ts:204) and the Tier-1 grace is seeded
after (line 212); `denySub` is iat-aware (denies tokens issued *before* now), so the
freshly-issued access token (iat ≥ now) survives while all older ones die. Do
**not** clear the new session's step-up keys. Double-check `denySub` semantics in
`apps/auth-service/src/auth/deny-list.ts` before wiring (confirm the iat boundary is
`>= nowSeconds()` inclusive of the new token, or issue the new tokens *after* the
denySub with a fresh timestamp if there is any race).

**Test:** an integration test (or a focused unit with a stubbed refresh store)
asserting that after `recovery/finish`, a pre-existing refresh token for that user
is revoked and a `denySub` entry is written, while the newly returned access token
still verifies. Note: the auth-service integration suite needs
`TEST_DATABASE_URL`; without it those legs skip cleanly.

---

## After the six commits

1. **Gates green on the branch:** `pnpm typecheck --force` 14/14, `pnpm run build`
   9/9, Biome clean, full user-client vitest at baseline, auth-service `bun test`
   (integration legs skip without `TEST_DATABASE_URL`; run them if a dev PG is up).
2. **Larissa** — summon on commits 3, 4, 5, 6 (her paths: client sync
   zero-knowledge boundary + auth-service). Use the **absolute worktree path**.
   Focus: HIGH-1's byte-heal must not leak plaintext or mis-target a blobId;
   the persona cascade's new tombstones/blob-deletes; the drain's newBlobs handling;
   recovery revocation completeness.
3. **Laura** — judgement call, likely a light pass on commits 1 and 2 (they change
   an error-state and a data-appears moment on user-reachable onboarding flows).
   Pure bugfix-to-intended-behaviour may not need her — Liz decides.
4. **Chris device-verifies:** commit 1 (fresh-device pull), commit 2 (wrong-passphrase
   inline, code not burned), commit 5 (two-browser delete→restore→pull, image
   survives), commit 3 (persona delete frees server quota — check the sync-service
   row/blob count), commit 6 (recovery on a fresh device, old session dies).
5. **Integrate:** fast-forward `full-backend-transition` onto
   `fix/pre-release-blockers`, re-run the gate on the integrated tip
   (memory `verify-worktree-squash-captured-full-tree`), remove the worktree.
6. **Update `STATUS-TRANSITION.md`** with what landed and refresh the "diverged to
   v32" note (it is wrong — the tree is v34).

## Not in this session (deferred, tracked)

The should-fix tier from the audit stays open and is *not* release-blocking:
Auth F3 (multi-tab refresh logout — `navigator.locks` around refresh), MEDIUM-1
(vectors never tombstoned server-side → quota leak), MEDIUM-3 (mass-delete
`findKeyByBlindId` CPU — needs a device probe), pairing F4/F5 (unmapped
`code_expired`/`code_already_redeemed`/`rate_limited` — same one-line drift class as
commit 2, a good fast-follow), pairing F7 (QR base-URL convention — settle with one
live scan against prod `API_BASE_URL`). Record these in
`obsidian/insights/follow-ups-index.md` so they are not lost.

## Prod-env preconditions for go-live (not code — Chris's checklist)

`OPAQUE_SERVER_SETUP` set in prod (unset ⇒ a restart bricks all accounts); the
reverse proxy **overwrites** (not appends) `X-Forwarded-For`; the refresh cookie
`SameSite`/domain delivers across the PWA origin ↔ `auth.<domain>` split.
