# Pre-Go-Live Fix Bundle — Design

**Date:** 2026-07-13
**Author:** Liz (spec), from four read-only pre-release audits (pairing, client sync, CORS proxy, recovery)
**Executor:** next session (Opus 4.8), subagent-driven per plan
**Status:** approved by Chris (design conversation 2026-07-13); **Laura spec-pass done 2026-07-13** — 1 HARD (probe-fail branch on `/join`) + 4 SOFT, all folded into this text

## 1. Context

Four parallel audits of the go-live surfaces (pairing, client sync, CORS proxy, recovery-key restore) ran on 2026-07-13, ahead of tonight's v0.2.0 backend go-live. Verdict: one BLOCKER (the pairing QR encodes a URL that 404s on the production topology), one HIGH (system-camera scans of either QR dead-end on a raw 404), plus a set of MEDIUM error-surface and robustness findings. Chris decided to fix **all** of them in one bundle, executed by a follow-up session.

This spec covers six squash units (A–F). Each is independently squashable; the suggested order is A, B, C, D, E, F (A is the blocker; F is doc-only).

Out of scope (stay on Chris's manual go-live checklist, not code):

- One real xAI or wafer send through the proxy with a real key (the `bad_target` fix `62874ec4` is on master and regression-tested, but the end-to-end device probe was never recorded).
- One live scan of both QR forms against the production topology (closes follow-ups F7).

## 2. Unit A — Point join QR codes at the client origin (`/join`)

**Fixes:** BLOCKER B1 (pairing QR unusable in production) + HIGH H1 (system-camera scan dead-end). Closes follow-ups-index F7 ("QR base-URL convention split").

### 2.1 Problem

- `apps/auth-service/src/routes/me-pairing-codes.ts:53` and `apps/auth-service/src/cli/bootstrap.ts:46` mint `${env.API_BASE_URL}/join#${code}` **without** stripping the `/auth` suffix; `apps/auth-service/src/routes/admin/invitations.ts:105-106` strips it. The deploy kit sets `API_BASE_URL=https://$HOST_AUTH/auth` (`deploy/generate.sh:59`) and Traefik routes the auth host only for `PathPrefix(/api)` (`deploy/compose.template.yml:55`), so the pairing QR base probes `…/auth/api/v1/config` → 404 → "not a Chatsundere server". QR pairing is entirely broken as deployed.
- Independently, scanning **either** QR with a phone's native camera opens the auth origin in a browser; nothing serves `GET /join` there → raw Traefik 404. The most natural first gesture on an un-onboarded phone is a dead-end.

### 2.2 Decision (Chris, 2026-07-13)

One canonical convention: **QR codes point at the client origin**, which serves a real `/join` landing route. The auth origin stops being a QR target.

### 2.3 Server side (auth-service) — Larissa path

1. **New optional env `APP_PUBLIC_URL`** in `apps/auth-service/src/env.ts`, validated exactly like `ADMIN_PUBLIC_URL` (https required; http accepted on loopback hosts for dev). It is the public origin of the user-client (no trailing path expected; tolerate and strip a trailing `/`).
2. **All three mint sites** (`me-pairing-codes.ts`, `admin/invitations.ts`, `cli/bootstrap.ts`) go through **one shared helper** (new `apps/auth-service/src/codes/qr-url.ts` or similar — single source of truth, the current three-site drift is the root cause of B1):
   - Let `serverBase` = `API_BASE_URL` with the trailing `/auth` stripped (the invitation regex, applied uniformly).
   - If `APP_PUBLIC_URL` is set: `qr_url = ${APP_PUBLIC_URL}/join?server=${encodeURIComponent(serverBase)}#${code}`.
   - If unset (self-hoster who has not configured it): legacy form **with the strip fixed**: `${serverBase}/join#${code}`. This alone closes B1 even without the new env.
3. **No new route on the auth-service.** No Traefik change.
4. Wire shape: `qr_url` remains an opaque string in `PendingCodeReveal`/invitation responses — no shared-types change expected; verify.

### 2.4 Deploy kit + docs

- `deploy/generate.sh`: emit `APP_PUBLIC_URL=https://$HOST_APP`.
- `deploy/deployment.env.template`: add the row with a comment (what it does, that QR deep links degrade to the legacy auth-origin form when unset).
- `apps/auth-service/.env.example` + `.env.dev`: add (`.env.dev` uses the dev client origin, `http://localhost:3000`).
- `obsidian/DEPLOYMENT.md`: document the variable and the QR behaviour for operators.

### 2.5 Client side — Laura path

1. **`parseJoinUrl` (`apps/user-client/src/lib/qr.ts`) accepts both forms:**
   - **New form:** path ends with `/join`, a `server` query parameter holds the url-encoded server base, fragment holds the code. `baseUrl` = the decoded `server` value (same scheme validation as today: https, or http on loopback — applied to the *decoded* value). The URL's own origin is irrelevant to the result (a QR minted by instance X scanned inside instance Y's app must still join X's server).
   - **Legacy form (unchanged):** no `server` param → today's behaviour (base = origin + path up to `/join`). Old printed invitation QRs keep working.
   - Paste auto-split in `JoinFormFields.tsx` gains the same tolerance (it reuses or mirrors `parseJoinUrl`).
2. **New public route `/join`** in `apps/user-client/src/App.tsx` (outside `ProtectedRoute`, reachable with no session — like the onboarding routes):
   - Parses `?server=` + `#code` via `parseJoinUrl` semantics (accepting both forms so a legacy QR opened in the browser also lands here if its origin is the client).
   - **Valid parse →** a minimal chooser screen in the design language: `Welcome` eyebrow + wordmark (reuse the onboarding-matrix chrome), one sentence ("You scanned a Chatsundere code"), and the **two account-backed intents as gold `NavTile`s** — "I have an invitation" and "Link this device to my account" (mirroring the matrix's two-gold pairing; one intent per screen, ND-calm). Choosing a tile **seeds the onboarding store and navigates exactly as the `kind_mismatch` handoff already does** (`invitation_input` / `pairing_input` with `{ baseUrl, code }`, then navigate to the flow **root** `/onboarding/{invitation,pairing}` and let the flow's own guard carry the user to confirm — one code path, already tested; do **not** deep-link a `/confirm` sub-route directly, Laura SOFT). A wrong choice is caught by the existing constructive `kind_mismatch` handoff (invitation confirm.tsx:518-519 / pairing confirm.tsx:253), which preserves state and burns no attempt (wrong-kind starts are attempt-free, `codes/rate-limit.ts:35-55`).
   - The server probe reuses the existing discovery probe the form screens use, run on entry. **On probe failure the tiles stay enabled but route to the respective prefilled *form* screen instead of confirm** (Laura HARD, folded): the form already owns the probe-retry and unreachable copy, and the seeded `{ baseUrl, code }` ride along — so the scanned inputs are preserved by construction and there is no kind-less "manual" escape. No disabled-tiles state exists on this screen.
   - **Invalid/missing params →** a calm notice ("That link didn't carry a valid code") whose single action is labelled for its destination ("Choose how to join" → onboarding matrix; Laura SOFT — no bare "OK"/"Continue").
   - If a **local account already exists** on the device, do not offer the invitation path silently into data loss: the existing confirm-flow guards (`conflict` backstop, wipe chokepoint `wipeClientDataForFreshOnboarding` which no-ops when an account exists) remain the enforcement point — the `/join` route adds **no new wipe path** (Larissa INFO 2026-07-06 honoured: any new onboarding route must not wipe unconditionally; this one never wipes at all).
3. A session-holding device that opens `/join` **redirects to `/app` with a constructive toast — no chooser** (Laura arbitration, folded): a session-holder scanning a pairing code is the displaying device, and an invitation join would dead-end at the existing `conflict` guard, so both intents would terminate one click in. The toast copy branches on link state (Laura SOFT): server-linked → "This device is already linked to your account."; local-only → copy that names, without dismissing, that joining a server from a local account isn't available yet. The local→server upgrade gap gets a follow-ups-index row (Unit F).

### 2.6 Tests

- Server: unit tests on the shared QR-URL helper (set/unset `APP_PUBLIC_URL`, strip with and without `/auth` suffix, encoding of the `server` param); the three mint sites pinned to use it.
- Client: `parseJoinUrl` new-form/legacy-form/bad-scheme/bad-fragment/decoded-server-validation; `/join` route tests (valid → chooser → store seeded + navigation, invalid → notice, probe-fail → disabled tiles + manual path, existing-session behaviour).

## 3. Unit B — Sync robustness (tamper guard, empty-account status, blind-id cache)

Client-only sync engine; not a Larissa path by the letter (no `apps/sync-service` change), but the executor should treat the tamper guard with security-adjacent care in review.

### 3.1 Tamper attention must not be clobbered (new MEDIUM)

`setAttention` (`apps/user-client/src/sync/watermark.ts:180-184`) overwrites unconditionally. A pulled-tombstone wave (`apply.ts:554-557` raises `tombstone_threshold` unconditionally) or a quota/rate-limit `applyError` replaces a persisted `tamper` — the one attention documented as "sticky by design" — and `settleTombstoneNotice` then clears the slot entirely. A security alarm silently vanishes behind a routine notice.

**Fix:** guard inside `setAttention` — when the persisted attention is `kind: 'tamper'`, ignore any write that is not itself `{ kind: 'tamper' }`. Tamper today is raised from `blob-repair.ts:243`, `recovery.ts:449`, `apply.ts:846` and legitimately disappears only when the engine state is reset wholesale (decouple/relink/wipe reset `syncState` directly, not through `setAttention` — the executor must verify this claim against `link-reset.ts` and the wipe path before relying on it; if any legitimate clear routes through `setAttention(null)`, add an explicit `force` escape hatch for that caller only).

**Test:** raise tamper → tombstone wave / quota error / `settleTransientAttention` → tamper still persisted; engine-state reset still clears it.

### 3.2 Empty linked account shows "Pulling your data…" forever (LOW, cosmetic but universal tonight)

`deriveSyncStatus` step 6 (`components/SyncStatusLine.tsx:158-160`) treats `watermarkRev === 0 && online` as first-sync pulling; on a genuinely empty account the watermark never leaves 0.

**Fix:** the first-sync-pulling branch additionally requires `lastSyncAt === null` (the same discriminant `useFirstSyncPending` already uses — a completed cycle stamps `lastSyncAt` even on a zero-record pull, `watermark.ts:258-263`). Once stamped: fall through to the normal synced/waiting vocabulary.

**Test:** status derivation with `watermarkRev 0 + lastSyncAt null` → pulling; `watermarkRev 0 + lastSyncAt set` → synced.

### 3.3 Mass-delete blind-id CPU (known MEDIUM-3)

`findKeyByBlindId` stage 1 (`sync/apply.ts:490-494`) re-derives the blind id of every `syncRows` meta in the collection **per tombstone**, no memoisation; the per-cycle reverse-map cache exists but only serves stage 2 (`apply.ts:496-506`). A 200-tombstone cycle against a chatsune-imported vault (10k+ messages) is minutes of busy CPU under the sync Web Lock — reads as a hang. Unit C multiplies tombstone volume, so this lands in the same bundle.

**Fix:** route stage 1 through the same per-cycle reverse-map cache (populate it on first miss per collection, then look up; invalidate on writes within the cycle exactly as stage 2's cache already handles). No behaviour change, only derivation count.

**Test:** a unit test pinning derivation-call counts (spy on the derive function): N tombstones over an M-row collection derives each row's blind id at most once per cycle, not N×M.

## 4. Unit C — Tombstone vectors server-side on document delete (known MEDIUM-1)

`deleteDocumentCascade` (`apps/user-client/src/data/knowledge.ts:74-96`) deletes vectors locally and enqueues only the document tombstone; `deleteLibraryCascade` likewise. Pushed `vectors` ciphertext rows accumulate on the server forever: charged against the shared 2 GiB quota (the quota banner's "free space by deleting documents" is thereby partly false) and re-delivered to every fresh device's pull-from-zero (applied as `skipped` — no correctness harm, pure waste).

**Design note:** the in-code comment at `knowledge.ts:82` ("never tombstoned individually — the document tombstone is the signal") records the original sync-spec decision. This unit deliberately **supersedes** that decision for document/library **deletes** (Chris, 2026-07-13). The separate rule that document-edit **shrinks** use cleared-state updates rather than tombstones (blob-spec cross-flag) is untouched.

**Fix:**

1. In the same transaction that deletes a document's local vectors, enqueue a `vectors` tombstone per synced vector row belonging to that document (and per document in `deleteLibraryCascade`). Reuse the existing enqueue/tombstone mechanics — nothing new server-side (the sync-service already handles tombstones generically; terminality per uuid holds, `records/store.ts:117-121`).
2. Update the `knowledge.ts:82` comment to record the new rule and its date.
3. **Cross-effects to pin (this is where reviews will otherwise miss):**
   - **Tombstone user notice:** pulled vector tombstones must **not** count toward the `tombstone_threshold` "items were removed on another device" tally (`apply.ts:554-557`) — vectors are invisible infrastructure; one document delete can carry hundreds of chunks and would otherwise alarm every peer. Exclude the `vectors` collection from the tally.
   - **Delete-rate ceiling:** a mass document delete may bounce off the server's per-account delete-rate limit; the existing self-healing `delete_rate_limited` attention + outbox retry is the accepted behaviour — verify the outbox actually retries bounced tombstones rather than dropping them.
   - **Blind-id cost:** covered by Unit B §3.3 (same bundle, deliberate).
4. Pre-existing server-side orphans need no migration: no production data exists before v0.2.0 go-live.

**Tests:** document delete enqueues tombstones for exactly its vector rows; library delete cascades; peer apply of a vector tombstone deletes the local vector and does not raise the user-facing tombstone notice; rate-limited tombstone pushes are retried.

## 5. Unit D — Recovery error surfaces

Client-only, copy + branch fixes. Not a Larissa path; Laura pre-squash (error states are user-reachable flows).

### 5.1 Onboarding recovery (`apps/user-client/src/routes/onboarding/recovery.tsx`) — two dead branches (MEDIUM-1/-2 of the recovery audit)

The handler's CryptoError branch (`:102-109`) lists only `integrity_check_failed`/`wrong_recovery_key`; the HttpError branch (`:110-123`) never sees the 404 because `recoverFromScratch` wraps it into `CryptoError('not_found')` (`packages/crypto/src/flows/recover-from-scratch.ts:113-118`). Result: unknown username **and** malformed key (typo → `CryptoError('invalid_recovery_key_format')`, `packages/crypto/src/encoding/recovery-key.ts:37,45,56`) both fall through to "Something went wrong."

**Fix, in that file:**

- `not_found` (CryptoError) → the existing (currently unreachable) fatal copy "No account with that username on this server."
- `invalid_recovery_key_format` → **inline, non-fatal** key-field error ("That recovery key doesn't look right — check it for typos.") with input preserved and `screen: ready` (mirror the `wrong_recovery_key` handling; the login surface already maps this code, `routes/login/recovery.tsx:234` — reuse its copy for consistency).
- Remove the phantom `rate_limit_exceeded` literal (`:115`; the server emits `rate_limited`) and make the 429 copy honest: the window is 10 attempts / 15 min — "Too many attempts. Please wait a few minutes." Use the parsed `Retry-After` if present to say "about N minutes".

### 5.2 Login-surface full recovery, flow R (`apps/user-client/src/routes/login/recovery.tsx`) — dead-end + collapsed statuses (MEDIUM-3 of the recovery audit)

The `step2-deferred` path verifies the key only after the passphrase step; a wrong key then errors on the passphrase screen (`:297-378`), which has **no key field and no back affordance** — the user must reload. And `mapOnlineRecoveryError` (`:244-256`) folds 429/404/409/401 into one "server unreachable" message — wrong for a rate limit.

**Fix:**

- Add a back affordance on the passphrase screen ("Re-enter recovery key") that returns to the key step with the username preserved and the key field cleared + focused.
- `mapOnlineRecoveryError`: distinguish at minimum `429` ("Too many attempts — wait a few minutes.") from genuine unreachable; map 404 to the unknown-username copy. 409/401 may keep the generic copy if a specific one would guess.

**Tests:** each new branch pinned (message + surface + input preservation), plus the back affordance round-trip.

## 6. Unit E — Constructive failure for old-relay alpha users (proxy M1)

The promised "constructive in-client cut message" (STATUS-BACKEND 2026-07-01 entry) was never built. Today a requires-proxy send with no linked account throws a bare `Error('transport: cors-proxy routing selected but no proxy is available')` (`packages/llm-unified/src/transport.ts:92-97`), which surfaces as the generic toast "*{persona} couldn't reach the model — retry from the chat*" (`state/stream-manager.store.ts:1121-1125`) and the generic `StreamInterruptedFooter`. The real explanation lives two screens away.

**Fix:**

1. `packages/llm-unified`: throw a **typed error** (e.g. exported `ProxyUnavailableError`, carrying which of url/token was missing) from the two guards in `transport.ts:92-97`, instead of bare `Error`s. (Check `one-shot-completion.ts` and the web/MCP adapters route through the same guard — they do if they use `buildRequest`; verify.)
2. `apps/user-client`: the stream failure path (both the away-from-chat toast **and** the in-chat `StreamInterruptedFooter`) branches on `instanceof ProxyUnavailableError`:
   - Toast copy: "*{persona} needs your account link to reach this model — open My Account → Server linking.*" (toasts carry no actions; the copy names the destination).
   - Footer: alongside Retry/Discard, a link-button "Open Server linking" → `/app/account/server-linking`. The thrown message itself must reach the surface, not a generic (trace the DOM path in the failure state — an unrendered error surface is a known failure class).
   - **Naming parity (Laura SOFT):** verify the destination screen's title and its My-Account tile both read "Server linking" verbatim; toast, footer button, and arrival must use the identical name.
3. Title-gen/memory background failures stay silent as today (they are background jobs); only the interactive send path gets the new surface.

**Tests:** typed error propagation from transport; stream-manager maps it to the specific toast; footer renders the link-button in that failure state (state-driven render test, not just unit).

Laura pre-squash covers the copy and the footer affordance.

## 7. Unit F — Hygiene (doc-only parts `[skip ci]`)

1. `obsidian/insights/follow-ups-index.md`:
   - wafer/xAI row (~:160): mark resolved — squash `62874ec4` landed 2026-07-04; note the real-key device probe stays on the go-live checklist.
   - `/linking/scan` camera row (~:151): strike — the route was deleted by the 2026-05-22 onboarding overhaul; the current scanner (`routes/onboarding/pairing/scan.tsx:28-51`) stops the camera on unmount and on success.
   - F7 row (~:76): update to point at Unit A; keep the "one live scan" verification step until Chris performs it.
   - Add resolved/new rows for the items this bundle fixes (tamper guard, MEDIUM-1, MEDIUM-3, recovery branches, flow R, relay-cut toast).
   - New row: **local→server account upgrade path** does not exist (a local-only session-holder who scans an invitation is redirected with a named limitation, §2.5(3)) — design question for Lyra/Chris.
2. **Orphaned relay secret:** alpha users keep a sealed `sharedKey` under `settings.corsProxy` forever (`boot/client-data-db.ts:25`; nothing reads it since the cut `94bdcdd6`). Clear it with a load-time normaliser in the settings coercion path (the pattern `settings.ts` already uses) — non-indexed field, **no Dexie version bump** required.
3. STATUS files updated per §16 at session end (executor's duty).

## 8. Cross-cutting constraints for the executing session

- **Worktree discipline:** all work in a dedicated worktree under `.claude/worktrees/<name>`; the main tree stays on `master`. Subagents never merge, push, or switch branches.
- **Gates per unit:** `pnpm typecheck --force` (14/14), full user-client vitest, relevant `bun test` suites (auth-service for Unit A), Biome on changed files; `pnpm build` before the final squash.
- **Audits:** Larissa pre-squash on Unit A (auth-service) and a courtesy pass on Units B+C (sync-engine semantics); Laura pre-squash on Units A, D, E. Laura's spec-pass of this document ran 2026-07-13 (1 HARD + 4 SOFT, all folded — see Status line).
- **Squash granularity:** one squashed commit per unit (A–F), free-form imperative subjects, `[skip ci]` only on the doc-only commit(s).
- **British English** everywhere in the repo, including all new copy above.

## 9. Manual verification (Chris, on device, before tonight's announcement)

1. **Unit A:** mint a fresh invitation + a fresh pairing code on the staged prod stack → scan each with the **system camera** on an un-onboarded phone → lands on `/join`, chooser shown, chosen flow prefilled and completes. Scan the same QRs with the **in-app scanner** → same outcome. One legacy-form QR (or pasted legacy URL) still parses. *(This closes F7's "one live scan".)*
2. **Unit D:** onboarding recovery with a mistyped key → inline "doesn't look right", input preserved; with an unknown username → the named message. Flow R with a wrong key → back affordance returns to the key step.
3. **Unit E:** on a device with a requires-proxy provider and **no** linked account: send → footer shows the constructive message + "Open Server linking" works; toast copy names the destination.
4. **Unit B/C (spot):** a fresh empty linked account shows "Synced" (not eternal "Pulling…") after its first cycle; delete a document with many chunks on device 1 → device 2 removes it without an "items removed" alarm and without a visible hang.
5. **Checklist (non-code):** one real xAI or wafer send through the proxy with a real key.
