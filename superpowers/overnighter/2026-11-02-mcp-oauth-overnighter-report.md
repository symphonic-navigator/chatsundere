# Overnighter report: OAuth for MCP connectors

Run of 2026-11-02 (started 22:10 UTC) to 2026-11-03 (last commit 03:46 UTC). Brief: `superpowers/overnighter/2026-11-02-mcp-oauth-brief.md`. Spec: `superpowers/specs/2026-11-02-mcp-oauth-design.md`. Plan: `superpowers/plans/2026-11-02-mcp-oauth.md`. Evidence below is taken from the run ledger (`.superpowers/sdd/2026-11-02-mcp-oauth/progress.md`), the per-task implementer reports, the fix-wave report and the two audit reports in the same folder.

---

## 1. Summary

Chatsundere is now an OAuth client for MCP servers. The 13 commits on the branch (Tasks 1 to 12 plus one pre-squash fix wave) add the proxy header exposure, OAuth discovery, PKCE, a token client, a synced and sealed grant collection (`mcpOAuthGrants`, Dexie v38), the cross-device refresh claim model, the client-metadata document and callback page, the sign-in orchestration, OAuth-aware tool calls with per-device first-use consent, the Add and detail flows, the in-chat notice with a reconnect overlay, and ADR 0038 with docs. Every phase gate and the final verification are green (user-client 4293 tests in 651 files; build 9/9, typecheck 14/14, lint clean). Larissa found 0 Critical, 0 High, 1 Medium (code phishing through the paste fallback) and 4 Low; Laura found 5 hard defects and 15 soft findings. All hard defects, the Medium and the cheap parts of the Lows were fixed before the final commit; L2, L4 and four soft findings are proposed deferrals that need Chris. Nothing was merged, tagged or deployed; the spec §13 device checks (section 11) are Chris's.

Draft PR: https://github.com/symphonic-navigator/chatsundere/pull/34 (draft, from `feature/mcp-oauth` to `master`).

---

## 2. Environment

| Item | Value |
|---|---|
| Node | 22.23.4 (the plan pins 20; there is no `mise`, so the preinstalled Node was used) |
| pnpm | 9.15.0 |
| bun | 1.4.4 |
| Docker | 29.9.2, used for `nginx -t` (`nginx:1.27-alpine`) and for a live nginx container check of the metadata and callback locations in Task 7 |
| Postgres | 16, started natively (`pg_ctlcluster`); role `chatsundere`/`dev`; databases `auth_test_db`, `sync_db_test`, `sync_db` created; auth migrations applied manually (`bun run src/db/migrations.ts`) before the auth tests could pass |
| Redis | started natively (`redis-server`) |
| Container restart | one, around 01:30 UTC (during Task 9 fix round 1). Postgres and Redis were restarted; no work was lost. Task 9 fix round 1 was found complete in its report and re-verified (368/368 and typecheck) |
| Installs | nothing beyond starting the two services; the preinstalled toolchain was used |

Branches. The harness designated `claude/mcp-oauth-brief-in33cg`; the brief says only `feature/mcp-oauth` survives. Work was done on the harness branch and every commit was also pushed to `feature/mcp-oauth`, so the two are identical (both were at `070d86f` at the start; Larissa confirmed the identity at audit time). The PR is opened from `feature/mcp-oauth`. Cost if wrong: one extra remote branch to delete.

Subagent model use (from the ledger): Opus for Tasks 5, 6, 8, 9, 10 and the fix wave; Sonnet for Tasks 7, 11 and 12. The audits ran as read-only Larissa and Laura passes in parallel.

---

## 3. Task 0: planned vs measured

The plan's counts were measured on `master` at `a47cd995`. Task 0 here ran at `070d86f`.

| Item | Plan expects | Measured |
|---|---|---|
| install | not stated | 39 s |
| `pnpm run build` | 9/9 tasks | 9/9 (53 s) |
| `pnpm typecheck` | 14/14 tasks | 14/14 (50 s) |
| `pnpm lint` | Biome clean | clean (1819 files) |
| `user-client` | 3786 passed, 633 files | 3786 passed, 633 files |
| `crypto` | 227 pass | 227 |
| `llm-unified` | 508 pass | 508 |
| `proxy-service` | 87 pass | 87 (at baseline; 89 after Task 1) |
| `admin-client` | 71 passed | 71 |
| `ui-shared` | 78 passed | 78 |
| `embeddings` | 68 passed | 68 |
| `shared-types` | 7 pass | 7 |
| `sync-service` | without services: 39 pass, 24 fail (environmental) | **with** services: 136 pass, 0 fail, 5 skip (141 tests; the skips are live S3 legs needing MinIO) |
| `auth-service` | without services: aborts with `ECONNREFUSED ::1:5432` | **with** services: 215 pass, 12 skip, 0 fail. The first run failed with `audit_log` missing until the auth migrations were applied by hand; that was environmental (migrations), not a code fault |

Tests took 346 s on a forced run. Total Task 0 time was about 10 minutes against the 15-minute budget. No baseline flake was recorded in the ledger during Task 0.

Suites that did not run: none. Both service-dependent suites ran with Postgres and Redis present, so the brief's "say which ones did not" has no entries. The five `sync-service` skips need MinIO, which was not installed.

---

## 4. Per task

Mutation protocol: work staged with `git add`, one mutation applied, task test command run, failure observed, file restored with `git checkout -- <file>`, tree checked equal to the index. Test names are abbreviated.

### Task 1: `5a2e61e` Expose MCP auth and session headers through the proxy

- RED: `bun test tests/proxy.test.ts` gave 7 pass, 1 fail (expected `"Mcp-Session-Id, WWW-Authenticate"`, received `null`).
- GREEN: `apps/proxy-service` `bun test` 89 pass, 0 fail; typecheck and Biome clean.
- Review: clean on the first pass; no fix rounds.
- Mutations:
  1. Removed `WWW-Authenticate` from the exposed-headers constant → "exposes WWW-Authenticate and Mcp-Session-Id on a forwarded response" failed.
  2. Moved the expose header outside `if (matched)` → "does not add expose headers for an unmatched origin" failed.

### Task 2: `1ebfcef` Add OAuth primitives for MCP

- RED: `primitives.test.ts` failed at collection (module not found).
- GREEN: 28 tests, then 35 after fix round 1; typecheck and Biome clean.
- Review: round 1 Needs fixes (userinfo and scheme not rejected in `canonicalResource`; challenge parser mishandled empty and non-token values). Fix round 1 addressed 5, 0 open. Clean.
- Mutations (first run; the same four were re-run after the fix round and still failed as shown):
  1. Keep trailing slash in `canonicalResource` → 3 tests failed (canonicalisation cases).
  2. Accept any `http:` in `assertSecureEndpoint` → "refuses plain http and non-http schemes" and "carries kind not-secure" failed (2 after the fix round).
  3. Break the S256 digest input → RFC 7636 appendix B vector failed; PKCE `plain` → vector and "challenge is S256 of verifier" failed.
  4. Drop the `csm1.` prefix check in `decodeCallbackPayload` → "rejects garbage and a missing prefix" failed.

### Task 3: `371adac` Add OAuth discovery for MCP servers

- RED: `discovery.test.ts` failed at import (0 tests collected).
- GREEN: `discovery.test.ts` 29, then 34; `tests/mcp/oauth` 64, then 78/78 after fix round 2; typecheck and Biome clean.
- Review: round 1 Needs fixes (fake server: `rotate:false` reuse, grace 0, earlier-family order; discovery: explicit PRM network failure; `familyRevoked` boolean). Fix round 1 addressed 9 and left 1 open (`isProxyUnauthorised` cap); fix round 2 closed it (the first round's edit had not been saved to the file). The one-function fix was re-checked by the controller reading the code. Clean.
- Mutations:
  1. Skip the issuer check → "refuses an issuer that differs from the one the URL was built from" failed.
  2. Skip the protected-resource `resource` check → "refuses a protected resource that names another resource" failed.
  3. Retry on any 401 (the `fetchWithProxyAuth` behaviour) → "does not retry a proxied request whose upstream answered 401" failed.
  4. Drop the preflight-forcing header on the direct route → "sends MCP-Protocol-Version on a direct POST to force a preflight" failed.
  5. (Fix round 2) Disable the 4 KiB cap in `isProxyUnauthorised` → the oversized-401-imitating-the-proxy test failed.

### Task 4: `4117375` Add OAuth token client for MCP

- RED: first run failed at import (no `token-client.ts`).
- GREEN: `token-client.test.ts` 30, then 36/36; `tests/mcp/oauth` 108, then 114/114.
- Review: round 1 Needs fixes; fix round 1 addressed 6. The controller re-checked `refreshTokens` and the mutation list. Clean.
- Mutations (final set from fix round 1):
  1. `refreshTokens` falls back to the proxy on `TypeError` → "throws network on a TypeError and makes no proxy attempt", "lost response" and "non-TypeError failure" failed.
  2. Drop `resource` from the refresh request → "sends resource, client_id and grant_type" failed.
  3. Overwrite a missing `refresh_token` with null → "keeps the old refresh token when none is returned" failed.
  4. `exchangeCode` falls through to the proxy on any error, not only `TypeError` → "direct attempt is aborted" and "reading the direct response body fails" failed. (This one survived the first round until a test was added.)
  5. An unusable 200 refresh body mapped to `refresh-failed` again → "treats an unusable 200 as a lost response" failed.
  6. Body-read failure rethrown as `TypeError` → the exchange body-read test failed.
  7. Remove `clearTimeout` → "clears its timeout after a successful refresh" failed.

### Task 5: `1bafbb4` Add synced storage for MCP OAuth grants

- RED: `oauth-grants-sync.test.ts` failed to load; 12 further cases failed (v38 pin, resolution, strip).
- GREEN: brief command 31 files, 148 tests; `tests/sync` plus `tests/boot` 86 files, 520 tests; full user-client 639 files, 3922 tests; `sync-service` 136 pass, 5 skip (collection accepted via `isSyncCollection('mcpOAuthGrants')`, no source change); `shared-types` 7 pass; typecheck and Biome clean. 24 test files carried a mechanical `37` to `38` version pin.
- Review: clean, Approved on the first pass; no fix rounds.
- Mutations:
  1. Remove `pendingTokens` from the grant deny-list → 4 failed (strip, local pending fields kept, applyRecord).
  2. Route `mcpOAuthGrants` through LWW → 3 failed (both resolution cases and applyRecord).
  3. Drop the `BACKFILL_ORDER` entry → 2 failed ("runs straight after mcpServers", "uploads an ordinary grant").
  4. Send a grant tombstone to the trash → "a pulled grant tombstone deletes the row and creates no trash entry" failed.
  5. Let reconcile enqueue grants → "never enqueues a grant" failed.
  6. Neutralise the `pendingNewFamily` backfill filter → the skip/upload backfill test failed.

### Task 6: `509d1a8` Serialise MCP token refresh across devices with a sealed claim

- RED: `ensure-token.test.ts` and `push-record-direct.test.ts` failed to load; the three carried-item tests failed (recovery re-push, `openTokens` shape, grant tombstone alarm).
- GREEN: brief command 51/51 three times in a row, then 56/56 three times after the hardening round; `tests/sync` plus `tests/mcp/oauth` 64 files, 616 tests; full user-client 641 files, 3975 tests; build, typecheck and Biome clean. All timing runs through injected clocks, so there are no real waits.
- Review: round 1 Approved (0 Critical, 0 Important). The controller sent four minors as a hardening round (unknown link status, release the claim on a freeze before the first POST, step-8 throw keeps the pair, unexpected throws map to `waiting`). No separate re-review; the code is inside the Larissa scope.
- Mutations (brief command each time):
  1. Refresh before the claim → 29 failed, including test 5 ("a token from an earlier sign-in is never presented").
  2. Re-read `baseRev` at push time → push-record-direct "seals the row it is given … with baseRev as given" failed.
  3. Acknowledge `ok` in `syncRows` only → "on ok writes the row and its syncRows revision together" and "a won claim is visible in the local row after a simulated restart" failed.
  4. Compare against `row.tokens` instead of `pendingSpentRefresh` → tests 13 and 15 failed.
  5. Claim while a pair is unpublished → test 10 failed.
  6. Skip the pre-POST elapsed check → test 28 failed.
  7. Adopt the old row in the new-family path → tests 27, 27c, 27e failed.
  8. Skip the foreign-claim check → tests 3, 6, 7, 8, 8b, 9, 21, 28 failed.
  9. Refresh from `tokens`, ignoring `pendingTokens` → tests 10, 12, 13, 14, 31, 27b, 27c, 27e failed.
  10. Write `pendingTokens` after publish → test 11 (crash between refresh and publish) and 11 others failed.
  11. Use the current revision in place of `pendingBaseRev` → tests 15 and 13 failed.
  12. On publish conflict always adopt → test 12 failed.
  13. Retry after the 25 s window (in-doubt check disabled) → test 17b failed.
  14. Trust `claim.at` for lease lapse → tests 21, 8b, 28 failed.
  15. Drop the epoch check in `pushRecordDirect` → "an epoch mismatch returns epoch-mismatch and writes nothing" failed.
  16. Share the session key buffer instead of copying → 25 failed, including test 24 ("a key zeroed mid-flight leaves the private copy intact").
  - x1. Recovery re-pushes `pendingNewFamily` grants → the recovery "skips one holding an unpublished new family" test failed.
  - x2. Grant tombstones counted toward the tombstone alarm → "grant tombstones never raise the mass-deletion notice" failed.
  - x3. `openTokens` without the shape check → "rejects a sealed body of the wrong shape" failed.
  - x4. Publisher awaited inside the sync lock → "the sync cycle publishes pending tokens only after releasing the sync lock" failed.
  - x5. `withGrantLock` fallback runs inline (the trap the brief named) → passed at first; after a push-count assertion was added to test 25 and a mutex test 25c, test 25 failed.
  - f1. Link-status guard removed (unknown treated as unlinked) → test 32 failed.
  - f2. No claim release on a freeze before any POST → tests 28 and 28b failed.
  - f3. A write-ahead throw escapes → test 33 failed.
  - f4. Unexpected throws rethrown → tests 11 and 34 failed.

### Task 7: `c42123e` Add OAuth client metadata and callback page

- RED: both new test files failed to load.
- GREEN: 26 tests; after fix round 1 `tests/mcp/oauth` 198 passed; build produced `dist/oauth-callback.html` (3.1 kB); typecheck and Biome clean.
- nginx: `docker run nginx:1.27-alpine nginx -t` gave "syntax ok", re-run after the `Vary: Host` change. Live container with the built `dist` mounted: `Host: app.example` returned 200 `application/json` with `client_id` equal to `https://app.example/oauth/client-metadata.json`; `Host: app.example:8443` kept `:8443`; `Host: evil"}`, `Host: a.b/c` and an empty Host each returned 400; `/oauth/callback?code=x&state=y` returned the page with `Referrer-Policy: no-referrer`, `Cache-Control: no-store` and the three isolation headers, and the container log held 0 lines for that request. A real Traefik in front was not tested.
- Review: round 1 Needs fixes (the callback page pulled a 565 kB crypto chunk). Fix round 1 addressed 4: local base64url helpers instead of `@chatsundere/crypto` (with a regression test that forbids `@chatsundere/` imports), a stricter `isPubliclyFetchableOrigin`, `Vary: Host`, and the dev plugin reading the page from `server.config.root`. The controller verified the built page has no app chunk.
- Mutations:
  1. Removed the `replaceState` call → "removes the query before doing anything else" and the no-state test failed.
  2. Acknowledgement wait 1500 ms to 0 → "waits exactly 1.5 seconds" failed.
  3. Dropped the `/^\/oauth\//` service-worker denylist entry → "the service worker never answers /oauth/ from the cached shell" failed.
  4. Dropped nginx host validation → "nginx serves the metadata document behind a strict host check" failed.

### Task 8: `57da05a` Add OAuth sign-in orchestration for MCP

- RED: `sign-in.test.ts` failed to resolve `sign-in.js`.
- GREEN: 33/33, then 38/38 after hardening; `tests/mcp` plus `tests/sync` 74 files, 748 tests; typecheck and Biome clean.
- Review: round 1 Approved. Hardening round sent (3 items): a publish that throws after the tokens are stored keeps them pending and still succeeds; key check before DCR and client reuse on reconnect; orphan save never overwrites a server row. No separate re-review.
- Mutations:
  1. Skip the `state` check → "an unknown state is refused without any token request" failed.
  2. Skip the `iss` check → "an iss that differs is iss-mismatch" and "a missing iss is iss-mismatch when the server advertises the parameter" failed.
  3. Prefer CIMD on a private origin → "uses DCR on a private origin even when CIMD is advertised" and the no-client-identity test failed.
  4. Delete the pending row before the exchange → "a failed exchange keeps the pending row" failed.
  5. Remove the state lock → "two tabs completing the same callback make one token request" failed.
  6. Remove the grant lock → "a refresh holding the grant lock in another tab cannot overwrite the new family" failed.
  7. Save through `mutateSynced` instead of `putLocal` plus `publishNewFamily` → 6 tests failed (offline publish, full sign-in, locked-during-exchange, reconnect among them).
  - Hardening: remove the publish `catch` → the throwing-push test failed (exchange-failed).
  - Hardening: `add` to `put` for the orphan save → "never overwrites a server row saved between the check and the write" failed.
  - Hardening: disable client reuse → "reuses the registered client" failed (2 registrations).
  - Hardening: ignore the redirect in the reuse rule → "registers again when the redirect URI or the issuer changed" failed.
  - Hardening: check the key only after DCR → the locked test failed (a `TypeError` instead of `OAuthError`).

### Task 9: `3119057` Use OAuth tokens in MCP tool calls and add per-device consent

- MCP spec check: the transports page (`modelcontextprotocol.io/specification/2025-06-18/basic/transports`) was reachable (HTTP 200) and confirms the client MUST send `MCP-Protocol-Version` on all requests after `initialize`. The client sends the negotiated version, falling back to `2025-06-18`. One constant now lives in `src/mcp/protocol.ts`.
- RED: 52 failed, 307 passed of 359 in the brief command's scope.
- GREEN: brief command 355, then 368 after the fix round (16 files); full user-client 644 files, 4121, then 4134 tests, no flakes; typecheck and Biome clean.
- Review: round 1 Needs fixes (the proxy's own `unauthorized` misread as MCP auth; the probe re-sends the token per routing; direct redirect following). Fix round 1 addressed 5, 0 open. Clean.
- Mutations (final table of the fix round; the six originals re-run plus six for the fixes):
  1. Open the key or token before consent → 12 failed, including "sends a call refused… exactly twice", "a lapsed account session never spends…" and "a denied first use stores nothing and opens nothing".
  2. Skip `tokenAllowedFor` → "a grant failing tokenAllowedFor yields no token" failed.
  3. Retry a 401 twice → "retries a 401 once… dead on a second 401", "sends a call refused by the upstream exactly twice" and "a first-use probe refused upstream reaches the server at most twice" failed.
  4. Retry a 500 → "never retries a 500" failed.
  5. Record consent on a denied first use → "a denied first use stores nothing and opens nothing" and "a 'Not now' answers only the waiting calls" failed.
  6. Emit `meta` on every call → "gives one notice per server per send" failed.
  7. Fix 1 undone (return the proxy 401 as an MCP auth signal) → the three proxy-session tests failed.
  8. Fix 2 undone (no stop on the first auth answer) → "stops at the first auth answer" and the at-most-twice probe test failed.
  9. Fix 3 undone (always follow redirects) → "a direct request carrying a credential refuses redirects" failed.
  10. Fix 4 undone (no first-use cache) → "two parallel calls to one server ask one first-use question" and the "Not now" test failed.
  11. Fix 4 undone (no notice re-check) → "two parallel calls that both fail on the token give one notice" failed.
  12. Fix 5 undone (`no-grant` for a key row) → "a non-OAuth row asks for no token" failed.

### Task 10: `64e8205` Add sign-in flow for MCP servers in My Integrations

- RED: four new modules failed to import; 32 cases failed in `integrations.test.tsx` and `integration-server.test.tsx` (all new cases plus the three add-mode tests that now need *Enter details manually*).
- GREEN: brief command 88/88, then 97/97 after the fix round; neighbours plus `tests/routes` 483/483; full user-client run once at 4211 of 4212 (648 files). The one failure was `tests/sync/doorbell.test.ts` "schedules a cycle when rev is ahead of the watermark", unrelated to the task and green 3 of 3 alone (9/9 each time). Typecheck and Biome clean.
- Review: round 1 Needs fixes (a resumed reconnect offered *Use a key* and would add a second server) plus 5 minors sent. Fix round 1 addressed 6 per its report (reconnect key switch disabled with a reason; *CheckServerStep* copy; relay-down copy for linked devices; a failing save after a good exchange is "connected, saving will finish shortly"; pending page decides by `draft === null`; overlay focus, Escape and focus return). No separate re-review; UX was left to Laura in Task 13.
- Mutations:
  1. `server.tsx` onSave OAuth branch sets `auth = null` → "saving a setting leaves the row's auth and grant unchanged" failed.
  2. `server-status.ts`: a missing grant reads `⚠ Sign in again` → both "reads a missing grant as connecting on first use" tests failed.
  3. `OAuthConnectionPanel`: `disabled={props.starting}` (backend state ignored) → "disables Sign in again with a reason while the backend is unreachable" failed.
  4. `OAuthSignInFlow` unmount cleanup cancels the pending row unconditionally → "leaving keeps the pending sign-in" failed.
  5. `SignInSettings`: *On by default* starts false → 3 tests failed (prefill, hands the flow a draft, saves the connected server deferred).
  - F1. `isReconnect = false` → "offers no key switch on a resumed reconnect, with the reason" failed.
  - F3. Relay-down branch removed → "tells a linked device without its relay to wait, not to link" failed.
  - F4. A save failure shown as `exchangeFailed` → "a failing save after a good exchange is not a failed sign-in" failed.

### Task 11: `b0b4110` Show MCP sign-in notices in chat with an overlay to reconnect

- RED: both new test files failed at import (0 tests collected).
- GREEN: 14 passed; `tests/components` plus `tests/routes` 141 files, 920 tests; typecheck and Biome clean.
- Review: Approved, no fix round.
- Mutations:
  1. Navigate instead of opening the overlay → "Sign in again only opens the overlay" and "Grant access passes the challenged scopes" failed.
  2. Auto-open the window after discovery → 2 overlay tests failed ("runs discovery…", "on success closes…").
  3. Re-run on success (enqueue through the approval queue as the re-run proxy) → "on success closes…" failed.
  4. Button shown in the waiting variant → "waiting: says access cannot be renewed and has no button" failed. The first attempt did not apply (a string mismatch after Biome formatting) and the tests passed; it was redone and then failed as shown.

### Task 12: `6d33167` Record OAuth for MCP decisions, follow-ups and help

- Docs and help only: ADR 0038 (next free number), the CLAUDE.md "What NOT to Do" line, `obsidian/decisions/README.md` index entry, security-deferrals (M1 remainder closed on the branch), follow-ups index (M1 row struck, four spec §12 rows added), ux-deferrals (three proposed deferrals), the D7 note in `superpowers/specs/2026-06-08-mcp-client-design.md`, and the `integrations.md` help page.
- GREEN: `vitest run tests/content` 4 passed. Biome does not process `.md`. There are no mutations (no behaviour).
- Review: the controller reviewed the CLAUDE.md and D7 lines. Noted: the decisions README index stopped at 0027 (pre-existing gap for 0028 to 0037; only 0038 was appended).

### Task 13: `cfa734b` Close pre-squash security and UX audit findings for MCP OAuth

Task 13 is the Larissa and Laura audits (section 6) followed by one fix wave.

- GREEN: `vitest run tests/mcp tests/components tests/routes tests/component` 210 files, 1576 tests; full user-client 651 files, 4293 tests with no flake in that run; typecheck clean; build ok, with `dist/oauth-callback.html` loading only `oauth-callback-*.js` (3.5 KB) and `callback-payload-*.js` (1.7 KB), neither mentioning Dexie; Biome clean on the 24 changed TS and TSX files.
- Review: the ledger records a controller re-review "all addressed, no new breakage". No second Larissa or Laura summons is recorded (see section 9).
- Mutations (8):
  1. `pending-check.ts` always returns `'present'` → "finds a pending sign-in … reports another state absent" failed.
  2. `main.ts` `foreign = false` → "marks the code foreign only when this browser certainly did not start the sign-in" failed.
  3. Resource security assertion removed from `discoverOAuth` → "refuses a plaintext http resource before any request goes out" failed.
  4. Assertion removed from `prepareSignIn` → "refuses a plaintext http resource before any registration or storage" failed.
  5. `completeLocked` returns `cancelled` for every callback error → all 6 non-cancelled `an error callback %s is %s` cases failed.
  6. H4 subset check forced to false → "a scope notice whose scopes the live grant now holds says access granted" failed.
  7. H5 `disabled={blocked}` removed in the notice → "disables Sign in again and Grant access with the reason while the backend is unreachable" failed.
  8. H5 backstop forced off in the overlay → "refuses to start a sign-in while the backend is unreachable, without any check" failed.

---

## 5. Phase gates and final verification

Each gate ran `pnpm exec turbo run test --continue`, `pnpm typecheck`, `pnpm run build` and `pnpm lint`.

| Gate | HEAD | build | typecheck | lint | user-client | proxy | sync-service | auth-service | crypto | llm-unified | admin | ui-shared | embeddings | shared-types |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1, after Task 5 | `1bafbb4` | 9/9 | 14/14 | clean (1834 files) | 3922 / 639 files | 89 | 136 pass, 5 skip | 215 pass, 12 skip | 227 | 508 | 71 | 78 | 68 | 7 |
| 2, after Task 9 | `3119057` | 9/9 | 14/14 | clean (1848) | 4134 / 644 | 89 | 136 / 5 skip | 215 / 12 skip | 227 | 508 | 71 | 78 | 68 | 7 |
| 3, after Task 11 | `b0b4110` | 9/9 | 14/14 | clean (1869) | 4235 / 650 | as Gate 2 | as Gate 2 | as Gate 2 | as Gate 2 | as Gate 2 | as Gate 2 | as Gate 2 | as Gate 2 | as Gate 2 |
| Final, after the fix wave | `cfa734b` | 9/9 | 14/14 | clean (1871) | 4293 / 651 | 89 | 136 / 5 skip | 215 / 12 skip | 227 | 508 | 71 | 78 | 68 | 7 |

All tests in all gates were green; there were 0 failures at any gate.

Flakes. The brief warned of one or two flaky user-client tests per full run. One was seen: `tests/sync/doorbell.test.ts` ("schedules a cycle when rev is ahead of the watermark") failed once in the full run during Task 10 and was green 3 of 3 alone. No flake is recorded at any gate or in the final run.

The Task 9 implementer did not run the turbo-wide phase gate itself (it ran the user-client suite, typecheck and Biome on touched files, per its run rules); the controller ran Gate 2 afterwards, and it is the figure shown above.

---

## 6. Audits

Both audits ran read-only on `070d86f..b0b4110`, in parallel, before the fix wave. Larissa's paths touched: `apps/proxy-service/**` (expose headers) and `packages/shared-types` (new collection the sync service validates against). `apps/auth-service`, `packages/crypto` and the `apps/sync-service` source were untouched. Larissa also ran 14 focused files (320 tests), all passing.

### Larissa (security): 0 Critical, 0 High, 1 Medium, 4 Low, 10 Info

| ID | Severity | Finding | Outcome |
|---|---|---|---|
| M1 | Medium | The callback page's copy-and-paste code makes authorisation-code phishing practical (an attacker who started the flow sends the URL to a victim, then asks for the pasted code) | **Fixed.** Warning in the code view naming the `iss` host; foreign-flow detection by a raw IndexedDB check of `mcpOAuthPending` (new `pending-check.ts`, no Dexie); when the state is absent in this browser the code is hidden behind "I started this on another device" with a stronger warning; ADR 0038 section 7 names the residual risk. Mutations 1 and 2 of Task 13 |
| L1 | Low | HTTPS-only for the MCP URL was enforced only at the chokepoint, after tokens were minted | **Fixed.** `assertSecureEndpoint` at the top of `discoverOAuth` and in `prepareSignIn`; `checkServer` now treats an auth answer from a non-secure candidate as a key server. Mutations 3 and 4 |
| L2 | Low | A hostile sync server can roll back a grant on any device, not only a fresh one (the seal does not bind the revision; known devices are affected for `mcpOAuthGrants`). Denial of service only, no disclosure | **Proposed deferral, needs Chris.** Recorded in `security-deferrals.md` with the fix (a monotonic `generation` inside the sealed grant) |
| L3 | Low | Discovery, DCR and the exchange over the proxy are not end-to-end authenticated, so a hostile operator can steer the sign-in | **Partly fixed.** Cheap part: the confirmation says "You'll sign in at `<issuer host>`, which is not `<resource host>`" when hosts differ; ADR 0038 section 6 records the steering capability. **Remainder proposed deferred** (record whether metadata came through the proxy and add a line; try the protected-resource metadata direct first) |
| L4 | Low | Unpadded grant records and the claim/publish push pattern leak per-server usage metadata (count, token class by length, refresh timing) | **Proposed deferral, needs Chris.** Padding needs a `packages/crypto` change (a Larissa path, out of scope); the timing channel is not fixed by padding. Deferral text updated with the rev-not-bound finding and the "sync role only" caveat |
| I1 | Info | Proxy expose headers: no widening | Clean, no action |
| I2 | Info | Chokepoint holds. Deviation from spec text: the refresh token also goes to `revocationEndpoint`, whose origin is not bound to the issuer or token endpoint. `revokeHeld` sends an access token under the refresh-token hint when no refresh token is held | No action recorded in the ledger. Needs a decision: amend spec text, or bind the origin (section 9) |
| I3 | Info | Claim model and replay: denial of service only, for the sync role. The operator also running the proxy sees more on the proxy path | ADR and deferral wording updated ("cannot read tokens" is true of the sync role only) |
| I4 | Info | M1 remainder and the first-use exception are sound; DEV-only loopback `http` residual | M1 deferral closed. No action on the DEV-only residual |
| I5 | Info | Callback page and channel sound. Residuals: browser global history keeps the original URL; an old service worker could answer the callback with the cached shell once; suggestion to add `frame-ancestors 'none'` on the callback location | No action recorded for these |
| I6 | Info | nginx CIMD document is injection-safe and cannot be cache-poisoned. Self-hosters whose fronting nginx rewrites Host publish a mismatching `client_id` (fails closed) | No action recorded; a line in deployment docs is still open (section 9) |
| I7 | Info | Logging and secrets clean. One path: *Test* failures (`lastError`) are not scrubbed | No action recorded |
| I8 | Info | At rest: zero-knowledge holds | None needed |
| I9 | Info | Hostile metadata, DCR and PKCE sound | None needed |
| I10 | Info | Reconnect probe could try the `/mcp` variant and produce a mismatching resource; a pulled grant tombstone deletes an unpublished pending pair without revoking; in-doubt retries and an exchange retry after proxy fallback are accepted by spec | **Fixed** for the reconnect probe (`checkServer` `exact` option, used by *Sign in again*, the chat overlay and *Start again*). The rest are accepted by spec; the tombstone mention in the ADR is not recorded as done |

### Laura (UX): 5 hard defects, 15 soft findings

Hard defects (all fixed in `cfa734b`):

| ID | Finding | Outcome |
|---|---|---|
| H1 | Detail page *Sign in again*: ‹ Back and the server crumb pointed at the same route and did nothing | Fixed (`PageScaffold` `onNavigate`; three tests) |
| H2 | Chat overlay had no visible close; failure screens offered only *Start again* | Fixed (permanent "Back to chat" at least 44 px; every overlay failure gets *Back*; five tests) |
| H3 | Every callback `error` mapped to "Sign-in was cancelled" | Fixed (`access_denied` is cancelled; client refusals become `approved-apps-only`; `server_error` and `temporarily_unavailable` become `server-problem`; callback page shows "Sign-in didn't finish" for non-`access_denied`) |
| H4 | `needs more access` kept offering *Grant access* after a grant | Fixed ("● `<server>`: access granted" when the grant holds live tokens covering the challenged scopes) |
| H5 | Chat notice *Sign in again* was not gated on the backend | Fixed (disabled with the shared reason; overlay `Reconnect` refuses as a backstop) |

Soft findings:

| ID | Finding | Outcome |
|---|---|---|
| S1 | The overlay can cover a pending tool approval (both `z-50`) | **Proposed deferral** |
| S2 | Overlay target survives leaving the chat | Fixed (closes on unmount; keyed by chat id; the key is one prop with no test) |
| S3 | Overlay may clip at 380 px, landscape or with the keyboard | Fixed (`max-h-full overflow-y-auto`); needs the 380 px check (section 11) |
| S4 | *Sign in again* from a pill does not resume a kept pending sign-in | **Proposed deferral** |
| S5 | Accepts decision 4 (waiting pill does not update after recovery) | Accepted, no change |
| S6 | `needsProxy` ignored `grant.tokenRoute === 'proxy'` | Fixed; the rest of S6 confirms decision 2 |
| S7 | "Needs a linked Chatsundere server" on the detail page has no *Link a server* action | **Proposed deferral** |
| S8 | "Access applies on all your devices" shown on an unlinked device | Fixed (only when linked) |
| S9 | Callback "Done. You're connected" before the exchange ran | Fixed ("Almost done / Signed in. Return to Chatsundere to finish.") |
| S10 | Callback with no parameters showed "Cancelled" | Fixed (new `empty` view) |
| S11 | Endorses decision 1; *Not now* or *Back* resets the name, prefix and toggles draft | **Proposed deferral** |
| S12 | *Test connection* on OAuth rows used key-server copy | Fixed |
| S13 | *Remove server* enabled while the backend is unreachable | Fixed (OAuth rows only; key servers unchanged) |
| S14 | Dead pill "connected again" ignored `pendingTokens` | Fixed |
| S15 | Detail page offered both *Return to sign-in* and an enabled *Sign in again* | Fixed (*Sign in again* disabled with a reason) |
| Visual | Overlay card is 2 percent white over a 60 percent scrim, so chat shows through | For Chris; not changed |

---

## 7. Deviations and rulings

### Deviations from plan and brief

1. Node 22.23.4 instead of 20, and no `mise`; the preinstalled toolchain was used and Postgres and Redis were started natively.
2. Branch: harness branch plus an identical `feature/mcp-oauth` (see section 2).
3. Commit trailer: `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>` only, as the brief and CLAUDE.md require, instead of the harness default.
4. Plan Task 13 mentions a PR to master; the brief says a draft PR, which is what was opened.
5. Task 5: the grant collection is not in `PADDED_COLLECTIONS` (a `packages/crypto` change, outside the brief's boundary); raised to Larissa as L4.
6. Task 6: optional `EnsureDeps.lock`; `withGrantLock` takes an optional `{ signal }`; the work is split over four files (`ensure-token.ts`, `grant-publish.ts`, `grant-lock.ts`, `grant-store.ts`); `pendingSpentRefresh` is sealed under its own slot; the frozen-tab clock is measured from just before the claim push (stricter than the brief); `copyKey` treats an all-zero buffer as `locked`; publish clears the four pending fields with an explicit local write; the worker hook runs the grant publisher after the cycle, not awaited. The fake auth server was not extended; four behaviours are test-local fetch wrappers.
7. Task 7: nginx uses an `if` on `$http_host` inside the location because `map` is illegal at the server level in the Dockerfile's include; the isolation headers are repeated on the two new locations.
8. Task 8: `CompleteResult` gained a `locked` reason and `already-connected` carries `serverId` and `draft`; `McpOAuthGrantRow` gained an optional synced `redirectUri`; `OAuthErrorKind` gained `locked`; `removeGrant` deletes the server row too; `upsertMcpServer` gained `deferWhenOffline` and `ifAbsent`; `GrantStore.putLocal` is new; `CALLBACK_CHANNEL` moved to `callback-payload.ts`.
9. Task 9: the header carries the negotiated MCP protocol version instead of a hard-coded `2025-06-18`; `getOAuthToken` can return `mismatch` and `not-oauth`; direct requests with a credential use `redirect: 'error'` (key servers too); non-autoRun parallel calls are deliberately not merged into one approval.
10. Task 10: `PendingSignIn` gained a sealed optional `authorizationUrl`; `getOAuthToken`'s body became `oauthTokenFor`; `useUpsertMcpServer` takes `{ deferWhenOffline }`; the post-unlock route in `login/index.tsx` goes through `postUnlockTarget`; the status helper moved to `src/mcp/server-status.ts`.
11. Task 11: `<output>` is used for the notice because Biome rejects `role="status"` on a span.
12. Task 12: only 0038 was appended to the decisions README index; the 0028 to 0037 gap pre-dates this work.
13. Fix wave: a plain-`http` server that answers 401 is now offered as a key server by *Check server* and never as OAuth (side effect of L1, by design).
14. Existing tests changed (listed in the Task 9 and Task 10 reports): fixtures gained `url`, `hasConsent` and the new context functions; three add-mode tests now click *Enter details manually*; one 401 test now uses the proxy's real error body.

### Controller rulings (every "Ruling:" line of the ledger)

| # | Ruling | Cost if wrong |
|---|---|---|
| 1 | Work on harness branch `claude/mcp-oauth-brief-in33cg` and push identical commits to `feature/mcp-oauth` as well; the harness designates the `claude/` branch, the brief says only `feature/mcp-oauth` survives; both were at `070d86f` | An extra remote branch to delete |
| 2 | Commit trailer is `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>` only (brief and CLAUDE.md override the harness default) | The attribution line differs from the harness default |
| 3 | Subagents leave work uncommitted (brief); the controller commits after reviews; mutations run by the implementer after `git add` | None |
| 4 | `canonicalResource` keeps the query string as part of the resource; RFC 8707 discourages but allows it, and dropping it could merge two distinct resources | A server with query-bearing URLs gets distinct identities per query, harmless |
| 5 | The fake's earlier-family check precedes the revoked-family check; spec section 5 says Kumbu² revokes on an earlier-sign-in token while a newer family is live; the stricter fake is the safe side | Tests stricter than reality |
| 6 | (Superseded by 7) A 200 refresh response with an unusable body maps to `refresh-failed` | On a rotating server the spent token may be re-presented later (same exposure as the in-doubt path) |
| 7 | (Supersedes 6) A 200 refresh answer with an unusable body is `network` (a lost response), because the server accepted and may have rotated; retrying within 25 s stays inside Kumbu²'s grace | A few extra retries on a broken server |
| 8 | The epoch-recovery re-push (`recovery.ts` `REPUSH_COLLECTIONS`) must skip grant rows with `pendingNewFamily`, like backfill; carried into Task 6 | A pending new family's null tokens would reseed the server after a recovery, and other devices would show "Sign in again" |
| 9 | A pulled grant tombstone over a row holding `pendingTokens` deletes without revocation (apply has no key or network; the server row is gone so the grant is unusable) | One unrevoked token pair at the server until it expires |
| 10 | Leaving the confirmation screen (before any window opened) deletes the pending row; only the waiting screen's *Back* keeps it (spec section 9 and section 4.3) | The user must tap *Check server* again |
| 11 | Fix wave scope: Larissa M1 (warning, foreign-flow detection, ADR), L1, L3 (cheap copy lines), I10 reconnect probe; Laura H1 to H5 and softs S2, S3, S6, S8, S9, S10, S12 to S15; defer L2 and L4 to security-deferrals and S1, S4, S7, S11 to ux-deferrals (all proposed, for Chris) | Deferred items wait for Chris |

---

## 8. Surprises

- The auth-service suite initially failed with `audit_log` missing even with Postgres running: the test database needs the auth migrations applied by hand (`bun run src/db/migrations.ts`) before the suite is meaningful.
- sync-service ran fully (136 pass) with services present, far better than the plan's 39 pass and 24 fail without them.
- The container restarted around 01:30 UTC mid-run; the Task 9 fix round had already finished and was recovered from its report.
- Task 3 fix round 1 reported an edit to `oauth-fetch.ts` that was never saved; round 2 caught and redid it.
- Task 4's "exchange falls through on any error" mutation initially survived; it took an extra test to kill it. Task 6's "fallback mutex runs inline" mutation also passed at first and needed a stronger assertion.
- Task 7: Vite injects its `modulepreload-polyfill` chunk for every entry, so the callback page still has one tiny preload; the 565 kB crypto chunk was the real problem and is gone.
- Dexie `Table.update` on a row holding an `EncryptedBlob` returned a blob WebCrypto rejected under jsdom with fake-indexeddb (realm mismatch); `completedAt` is written with `put` instead. Fine in browsers.
- jsdom has no `navigator.locks`, so the production Web Lock branch of `withGrantLock` is exercised only through a fake `LockManager`.
- Larissa's Medium came from the paste fallback, a path the ADR had argued was safe because "the code alone is useless without the verifier"; that argument does not cover an attacker who started the flow.
- The MCP specification page was reachable from the run and confirms that `MCP-Protocol-Version` is required after `initialize`.
- Laura's pass found five hard defects in a flow whose Task 10 and 11 reviews had passed (Task 11 Approved; Task 10 had only the one Important finding).

---

## 9. Open points for Chris

### Deferrals needing sign-off (all marked "proposed, awaiting Chris" in the deferral files)

- **Larissa L2** (rollback of a grant on any device by a hostile sync server; denial of service only). Proposed fix: a sealed monotonic `generation`. Entry in `obsidian/insights/security-deferrals.md`.
- **Larissa L4** (unpadded grants plus the refresh-timing channel). Padding needs a `packages/crypto` unit; the timing channel is to be recorded as accepted. Same file.
- L3 remainder (metadata via the proxy line; direct-first for protected-resource metadata) is also proposed deferred in the same file.
- **Laura S1, S4, S7, S11** (overlay over a pending approval; *Sign in again* not resuming a kept pending sign-in; no *Link a server* action; draft reset on *Not now*). Entry in `obsidian/insights/ux-deferrals.md`. Soft, so Chris only confirms.
- The earlier proposed UX deferrals from Task 12 (same file): "needs more access keeps offering Grant access" (struck through as fixed by H4); "can't renew access right now pill does not update after recovery"; "Waiting for your Chatsundere server is approximated". The last two still stand and need confirming.

### Product calls flagged by implementers

- Second warning wording after "I started this on another device": it reads "…on the device where you just started…" because "this device" would be false there.
- *Grant access* with no scope: when the challenge names no scope, the notice keeps offering *Grant access* because there is nothing to compare.
- iOS Safari with its own copy of the database (the user once opened the site in Safari): the callback reports the state absent for a sign-in started in the home-screen app and shows the strong warning, so the code is one extra tap away. Larissa accepted this.
- Leaving the confirmation deletes the pending sign-in (ruling 10); only the waiting screen's *Back* keeps it.
- "Waiting for your Chatsundere server" is an approximation (proxy route and no proxy), because expiry is sealed; it shows even when the token is still fresh.
- A plain-`http` OAuth server lands on the key form with no OAuth-specific explanation (L1 side effect).
- "Point to an existing row" matches OAuth rows only; a key row with the same URL does not stop a new OAuth connection.
- An OAuth row with a grant, no route and no tools reads "Connects on first use" although it cannot resolve; the detail page's *Test connection* repairs it.
- `postUnlockTarget` overrides any return target when a sign-in started under 2 minutes ago.
- Overlay visual: 2 percent white card over a 60 percent scrim lets the chat show through; Laura left it to Chris.
- Task 6: a step-8 failure leaves the claim with no pending pair, so all devices wait out the 5-minute lease and then present the spent token (replayed inside Kumbu²'s grace, revoked after it).

### Unverified and not testable in the run

- Traefik `$http_host` behaviour behind a real Traefik (reasoned only; nginx tested directly). Larissa also notes that a fronting proxy rewriting Host makes CIMD fail closed; a deployment-docs line is still open.
- `window.close()` behaviour in a real browser, and the 380 px layout of the callback page, the overlay and `.pill-notice` (not exercised; Playwright was not used).
- The service-worker handling of `/oauth/` in a real PWA update (spec step 16 and the iOS steps).
- No real Kumbu², Notion or GitHub instance, so the fake authorisation server is the only counterpart so far.

### Review gaps

- The fix wave added new code (notably `pending-check.ts` reading IndexedDB from the callback page, and the callback error mapping) after Larissa's and Laura's passes. The ledger records only a controller re-review. A second Larissa pass on those files before the squash is worth considering.
- Larissa I2 (refresh token also sent to `revocationEndpoint`): amend the spec sentence or bind the endpoint's origin to the issuer or token endpoint. Not done.
- Smaller Larissa notes with no recorded action: `frame-ancestors 'none'` on the callback location (I5), scrubbing `lastError` in *Test* (I7), `access_token` hint in `revokeHeld` (I2), a line in the ADR on the pulled-tombstone case (I10).

### Deferred minors from the ledger

- Task 1: `mcpUpstream` helper placement and blank line in `proxy.test.ts`; no preflight assertion of both exposed headers.
- Task 2: Bearer parameters separated only by whitespace are parsed leniently.
- Task 3: `MCP_PROTOCOL_VERSION` was duplicated (unified in Task 9); issuer-with-path discovery candidates are untested.
- Task 5: the LOCAL_VALUES_DERIVED_FROM strip resets `firstUseConsentFor` also on a pulled `allowDirect` change (fails safe).
- Task 6: the `invalid_grant` `tokens: null` publish is fire-once (the grant is dead anyway); the adopted fallback returns the discarded pair's access token (no refresh token presented).
- Task 7: a `try_files` 404 would log the query to `error_log` (hypothetical; ADR note); the *Copied* label persists.
- Task 8: `removeGrant` revokes outside the grant lock (covered by the tombstone path); the `held` set is never cleared; the sweep keeps completed draftless rows until `finishOrphanedSignIns` deletes them.
- Task 9: `resolveRoute` calls `getGrant` without a try (harmless); a mismatch reason gives a plain error without `mcpAuth` (safe); key rows still probe every candidate routing (unchanged); without autoRun, parallel calls each get their own approval with first-use wording.
- Task 10: duplicate-URL pointer matches OAuth rows only; unticking *Local network* after a direct check can make the draft unreachable.
- Task 11: waiting pill text does not update after recovery (accepted by Laura S5).
- Task 13: `REMOVE_WAITS_FOR_BACKEND` sits between import blocks in `server.tsx`; "A sign-in is already in progress" lacks `aria-describedby` and a full stop.

---

## 10. Proposed STATUS changes (proposals only; the STATUS commit follows Chris's squash)

Neither STATUS file was edited. The squash hash is not known yet, so it appears as `<squash>`. Version number is Chris's call.

### `obsidian/STATUS-CLIENT-ONLY.md`

- **Current** (top of file): set `Last updated:` to the squash date and add a new leading entry "OAUTH FOR MCP CONNECTORS SQUASHED (`<squash>`, unpushed/pushed per Chris)": OAuth client for MCP servers (discovery, PKCE, CIMD or DCR, per-grant sealed tokens synced as the new `mcpOAuthGrants` collection, Dexie v38, cross-device refresh claim model, per-device first-use consent, Add and detail flows, in-chat notice and reconnect overlay, callback page with foreign-flow warning). Larissa 0 Critical, 0 High, 1 Medium fixed; Laura 5 hard defects fixed. Link ADR 0038, the spec and the overnighter report. Migrate the v0.3.4 entry to its block chapter in `insights/changelog/` per the file's own rule.
- **Briefed, awaiting implementation**: add "OAuth for MCP: relay for the sign-in code or a short typed code, only if the iPhone device test (spec section 13 step 4) shows the paste fallback is unworkable"; add "OAuth deferrals: Laura S1, S4, S7, S11 (pending Chris's confirmation, see `insights/ux-deferrals.md`)".
- **Doing now**: add "OAuth for MCP: built on `feature/mcp-oauth`, draft PR #34, awaiting Chris's spec section 13 device checks (16 steps plus the 380 px overlay check) and squash. Release: not cut."
- **Next session**: add a leading `▶` paragraph: run the section 13 checks and record the outcome of step 4 (iPhone code needed or not, 60 s enough or not) and step 11 (Notion, GitHub); confirm or reject the proposed deferrals; squash; then the STATUS commit; consider a second Larissa pass over the fix-wave files before the squash.

### `obsidian/STATUS-BACKEND.md`

- **Phase 0 / Done**: add "Proxy exposes `Mcp-Session-Id` and `WWW-Authenticate` on matched-origin forwarded responses (`EXPOSED_RESPONSE_HEADERS`); `mcpOAuthGrants` accepted as a sync collection via `packages/shared-types` (no sync-service source change); user-client nginx serves `/oauth/client-metadata.json` (Host-validated) and `/oauth/callback` (no query logging)." Note: no new endpoint or logic in sync, auth or proxy beyond that.
- **Doing now**: add "OAuth for MCP backend impact is limited to the three items above; Larissa pre-squash audit done (0 Critical, 0 High, 1 Medium fixed, L2, L4 and L3 remainder proposed deferrals awaiting Chris in `insights/security-deferrals.md`)."
- **Briefed, awaiting implementation**: add "Pad `mcpOAuthGrants` in `PADDED_COLLECTIONS` (`packages/crypto`, Larissa path), if Chris accepts L4 as a fix rather than an acceptance"; "Sealed grant `generation` against rollback (L2)".
- **Open design questions / blockers**: add "Self-hosting: a fronting proxy that rewrites `Host` breaks the CIMD `client_id` (fails closed); needs a line in the deployment docs, and `$http_host` behind a real Traefik is unverified."
- **Next session**: add "Deploy the branch to a public HTTPS origin for the OAuth device checks (CIMD needs a fetchable `client_id`)."

---

## 11. Device checks of spec section 13 awaiting Chris

Deploy the branch somewhere with a public HTTPS origin first, otherwise servers cannot fetch the client metadata. The 16 steps:

1. Kumbu², PC browser: paste a `/mcp/c/…` link; sign-in, host named, window closes or says to return, Connected, tools listed, a tool call works.
2. Plain `/mcp` of Kumbu²: no sign-in offered; the key field appears; an API key works as before.
3. Android installed PWA: repeat step 1 on a second connection; note whether the window returns by itself or shows the code.
4. iPhone installed PWA: repeat on a third connection; note whether the code is needed, workable, and whether 60 seconds are enough; repeat with the PWA evicted during sign-in (worst case). This decides the relay follow-up.
5. macOS browser or installed PWA: repeat step 1 on one of them.
6. Second device: `Use this server here?` names the host once; the call runs.
7. Rotation across devices: expire the access token (one hour at Kumbu²), use it on A then on B; neither prompts; Kumbu²'s log shows one `issued` refresh and no reuse.
8. Offline device: B offline, rotate on A, bring B back, use the tool on B; it works and the connection is not revoked.
9. Revoked server side: revoke in Kumbu²; the next call shows the `sign-in ended` pill, the model reports it, no window opens; *Sign in again* opens the overlay, the draft survives, asking again works.
10. Backend down: stop proxy and sync with an expired token; status reads `○ Waiting for your Chatsundere server`, the pill says it can't renew access with no sign-in offered; nothing is revoked once the backend returns.
11. Notion and GitHub: connect each; either they work or the refusal is understandable and *Use a key instead* is available; record the outcome.
12. Remove server: the confirmation says all devices; the server disappears on the other device; Kumbu² shows the tokens revoked.
13. Approval prompt: on a non-auto-run server it shows host, arguments and Always allow (which stops prompting for the whole server); on a second device one prompt per call.
14. Local-only device: without a linked server the Kumbu² link shows "Couldn't reach this server directly…" with the pointer to linking.
15. Leaving the flow: on the iPhone tap back while waiting, get the code, and return through `○ Sign-in in progress`; deny at the server and check the message; a down server can be saved through *Enter details manually*.
16. Self-hosting check: fetch `/oauth/client-metadata.json` on the instance; `client_id` equals the exact URL fetched.

Additional checks added by the fix wave and the unverified list:

- **380 px overlay check:** open the chat sign-in overlay at 380 px, also in landscape and with the keyboard open, and confirm *Back to chat* stays visible and nothing clips (Laura S3 may be a hard defect if it clips). Also look at `.pill-notice` wrapping and the callback page at 380 px.
- Open the callback code view from a link started on another device (foreign flow) and confirm the strong warning and the "I started this on another device" step; confirm `window.close()` behaves on Android and desktop.
- After updating a device with an older service worker, confirm `/oauth/callback` is served by nginx and not the cached shell.

---

## 12. Signal

`PushNotification` is attempted by the controller at the end of the run. This report does not confirm delivery; if it did not arrive, the draft PR (https://github.com/symphonic-navigator/chatsundere/pull/34) is the signal. Nothing was merged, deployed, squashed or tagged, `master` and devices were left alone, and no token, code or verifier value appears in this report.
