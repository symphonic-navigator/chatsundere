# WIP — pick this up first thing next session

**Pause point:** 2026-05-22 ~23:50. End of the user-client onboarding overhaul implementation. 30 commits landed since `7a01697` (the last STATUS.md squash). All tasks 1–22 of the plan are done, plus four post-implementation bug-fix commits during manual verification. **Not yet committed to STATUS.md, not squashed, not pushed** — see § 6 for what's still pending.

Delete this file once the work resumes and is squashed.

---

## 1. Where we left off

Liz and Chris were in the middle of **Task 23 — manual verification** when the night ran out. Two real problems surfaced earlier in the session, both fixed; the **third is open**: the invitation flow still ends in a generic "Something went wrong" with no console or network trace.

Fixed during the session (all four bug-fix commits since the main task work):
- `ec2fcf9` — InvitationForm and PairingForm subscribed to Zustand with a selector returning a fresh object literal → infinite useSyncExternalStore loop. Now read initial values via lazy `useState`. Matrix link to "Just this device" pointed at `/onboarding/local/username` (no route); fixed to `/onboarding/local`.
- `6a32c1c` — user-client service worker `runtimeCaching` rule only matched `/auth/v1/` and `/api/auth/`. Cross-origin `/api/v1/...` requests were being dropped by Workbox in dev mode (devOptions enabled). Broadened to `/api/` pathname.
- `3fc28a5` — auth-service sent `Strict-Transport-Security` on loopback HTTP. Chrome remembered it for `localhost` and force-upgraded the next request to `https://localhost:3100` → `ERR_SSL_PROTOCOL_ERROR`. HSTS now skipped when the request `Host` header starts with `localhost`/`127.0.0.1`.
- `5a36be8` — InvitationConfirm and PairingConfirm called `navigate()` during render for their bounce-guard. React warned "Cannot update a component while rendering a different component". Moved both into `useEffect`.

**Still broken at sleep time:** invitation submit → confirm screen shows "Something went wrong". Nothing in browser console, nothing in Network tab. The HSTS + SW fixes were both verified independently (curl reached the auth-service; the SW no longer drops the request) — so the failure must be either before the network call (OPAQUE client error, missing dependency) or in error mapping silently swallowing it.

---

## 2. First thing to do tomorrow

Add temporary `console.error(err)` to the catch in `apps/user-client/src/routes/onboarding/invitation/confirm.tsx` (around line ~161, inside `handleContinue`'s `} catch (err) {` block):

```tsx
} catch (err) {
  // TEMP — figure out why "Something went wrong" is firing silently
  console.error('[invitation.confirm.handleContinue] caught', err);
  const mapped = mapSubmitError(err);
  // …
}
```

That should surface what `err` actually is. Hypotheses to check after seeing the actual error:

1. **OPAQUE WASM not initialised** — `startJoinByInvitation` does `opaqueRegistrationStart(passphrase)` which uses `@serenity-kit/opaque` WASM. If WASM isn't loaded yet at the moment of the call, it throws. Check whether the user-client awaits `opaqueReady` at boot.
2. **Cookie / `credentials: include` issue** — `apiFetch` sets `credentials: 'include'`. Cross-origin POST with credentials requires the server to send `Access-Control-Allow-Credentials: true` AND `Access-Control-Allow-Origin: <exact origin>` (not `*`). Worth verifying with DevTools → Network → the actual request headers/response when it fires.
3. **Pre-flight OPTIONS** — Chrome sends an OPTIONS preflight for POST with custom Content-Type. If the auth-service's CORS middleware doesn't handle OPTIONS for `/api/v1/join/start`, the preflight fails and the actual POST never goes out. Check `apps/auth-service/src/middleware/cors.ts:4-30` against the new route.
4. **`apiFetch.safeReadCode` reads `error.code`** from response body but Task 14 (`mapSubmitError`) reads `err.code` from the HttpError. Verify `HttpError.code` is actually populated when the server responds with `{ error: { code: 'code_not_found_or_expired', message: '…' } }`. If `code` is undefined the mapper falls through to the generic "Something went wrong".

Pick the hypothesis suggested by the actual `err` value once the `console.error` is in place.

---

## 3. Dev environment — commands cheat sheet

To bring everything up from scratch (e.g., after a kernel reboot):

```fish
# Postgres + Redis + Prometheus + Grafana
cd /home/chris/workspace/chatsundere/infra
docker compose -f compose.dev.yml up -d
# Wait for postgres to be healthy
docker compose -f compose.dev.yml ps

# Migrations (only needed after a DB wipe or new migration)
cd /home/chris/workspace/chatsundere/apps/auth-service
pnpm run db:migrate

# Auth-service — its own terminal
cd /home/chris/workspace/chatsundere/apps/auth-service
bun run dev

# User-client — its own terminal
cd /home/chris/workspace/chatsundere/apps/user-client
pnpm run dev    # serves on http://localhost:3000

# Admin-client — its own terminal
cd /home/chris/workspace/chatsundere/apps/admin-client
pnpm run dev    # serves on http://localhost:5174
```

### Full reset (when the bootstrap-admin CLI refuses because a primary_admin already exists)

Postgres uses a **bind-mount** to `infra/data/postgres`, not a named volume, so `docker compose down -v` alone doesn't wipe it.

```fish
cd /home/chris/workspace/chatsundere/infra
docker compose -f compose.dev.yml down
sudo rm -rf data/postgres data/redis
docker compose -f compose.dev.yml up -d

cd /home/chris/workspace/chatsundere/apps/auth-service
pnpm run db:migrate
bun run dev    # in its own terminal

# Now generate a bootstrap invitation
cd /home/chris/workspace/chatsundere/apps/auth-service
pnpm run bootstrap-admin
# → writes a JSON file to $XDG_RUNTIME_DIR/chatsundere-bootstrap-<id>.json
#   containing { code, qr_url, invitation_id, expires_at_unix_ms }
```

### Browser-side reset (between attempts)

1. DevTools → Application → Service Workers → **Unregister**
2. Application → Storage → **Clear site data** (covers IDB + cache)
3. Hard reload: Ctrl+Shift+R

### Chrome HSTS cache clear (only needed once, after the HSTS fix landed)

1. Tab open: `chrome://net-internals/#hsts`
2. **Delete domain security policies** → enter `localhost` → Delete
3. Verify by typing `localhost` into "Query HSTS/PKP domain" — should report "Not found".

### Quick sanity probe of the auth-service join endpoint

```bash
curl -i -X POST http://localhost:3100/api/v1/join/start \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{"kind":"invitation","code":"AAAAA-BBBBB","registration_request":"AAA"}'
```

Expected for a non-existent code: `HTTP/1.1 404 Not Found` with body `{"error":{"code":"code_not_found_or_expired", …}}`. If you get something else, the auth-service routing or the OPAQUE library is the suspect.

---

## 4. Spec, plan, and other living docs

- **Spec:** `superpowers/specs/2026-05-22-user-client-onboarding-overhaul-design.md` — the source of truth for everything we built. Not yet committed (lands with the final squash).
- **Plan:** `superpowers/plans/2026-05-22-user-client-onboarding-overhaul.md` — 25-task implementation breakdown. Not yet committed.
- **Brief:** `obsidian/briefs/phase 0/cross-device-identity.md` — Lyra's brief that started this whole arc.
- **Phase 0 / Phase 1 boundary:** `superpowers/specs/2026-05-22-user-client-onboarding-overhaul-design.md` § 9 is authoritative on the accepted-data-loss and the local-recovery-key-on-Device-B deferrals.
- **Security deferrals logged this session:** `obsidian/insights/security-deferrals.md` entries `O-5-1` (Device-B local recovery-key unavailability) and `O-5-2` (AAD-consistency question for key-rotation flows, flagged for Larissa).

---

## 5. Plan tasks status

Tasks 1–22 of the plan: **all DONE**.

| Plan task | Status | Commit(s) |
|---|---|---|
| 1. Auth-service alphabet swap | ✅ | `2eb8186` + nit polish `b2aaa22` |
| 2. shared-types Join shapes | ✅ | `ae31799` |
| 3. ServerClient interface | ✅ | `baa7860` |
| 4. joinByInvitation flow | ✅ | `fb7ab49` + review fixes `d2b863a` |
| 5. joinByPairing flow | ✅ | `3a8dd98` + deferrals doc `ec1314e` |
| 6. recoverFromScratch flow | ✅ | `6272331` |
| 7. linkToServer migration | ✅ | `1824378` |
| 8. code-input normaliser | ✅ | `ad81f4b` |
| 9. qr.ts rewrite | ✅ | `61977b4` |
| 10. server-client.ts rewire | ✅ | `91cf053` |
| 11. onboarding.store | ✅ | `9209b68` |
| 12. Matrix route | ✅ | `e7600d2` |
| 13. Invitation form + scan | ✅ | `869cda9` |
| 14. Invitation confirm | ✅ | `c4120f8` |
| 15. Invitation recovery-reveal | ✅ | `80eacda` |
| 16. Pairing form + scan + confirm | ✅ | `efcaf80` |
| 17. Recovery single-screen | ✅ | `0d30242` |
| 18. Move create-account → onboarding/local | ✅ | `e259f81` |
| 19. App.tsx router + linking deletion | ✅ | `54cb9f5` |
| 20. Post-onboarding biometric modal | ✅ | `8eaa17b` |
| 21. Admin-client invitation form fields | ✅ | `9b764b3` |
| 22. Repo-wide build + lint + tests | ✅ | `fa0c7ec` (admin-client stub fix) |
| 23. **Manual verification with Chris** | ⚠️ in progress | "Something went wrong" still unresolved on invitation submit |
| 24. Larissa security audit | ⏳ pending | Run after Task 23 is green |
| 25. Final squash + STATUS.md + push | ⏳ pending | After Larissa clears |

Post-Task-22 bug fixes (during manual verification):
- `ec2fcf9` — InvitationForm/PairingForm infinite render + matrix link
- `6a32c1c` — user-client SW NetworkOnly broadened to `/api/`
- `3fc28a5` — HSTS skipped on loopback hosts
- `5a36be8` — confirm-screen bounce-guards moved into useEffect

---

## 6. Workflow we agreed on

- **All commits to date stay; the squash happens once at the end** (Chris confirmed this in the brainstorm phase). Don't squash now.
- **Spec + plan files are uncommitted on the working tree** (`.gitignore` already lists `.superpowers/`). They land with the final squash, alongside the code.
- **STATUS.md update** is part of the final squash (per CLAUDE.md § 16). Not yet touched.
- **Larissa (Task 24)** runs on the diff `7a01697..HEAD` after the manual verification is green. Audit scope from spec § 8.5 + plan Task 24: alphabet swap, joinByPairing unwrap mechanic, late-link branch, AAD-consistency between join/login/key-rotation flows (open question O-5-2).
- **Final squash (Task 25)** message template lives in the plan at the bottom of Task 25.

---

## 7. Open Phase-0 acceptances (FYI before squash)

- **Pairing replaces local MK** — `apps/user-client/src/routes/onboarding/pairing/confirm.tsx` and `packages/crypto/src/flows/join-by-pairing.ts` contain `// TODO(phase-1)` comments. Acceptance: audience of two in Phase 0; sync-service in Phase 1 handles UUIDv7-based merging.
- **Device-B local recovery-key login unavailable** — logged at `obsidian/insights/security-deferrals.md` entry `O-5-1`.
- **AAD consistency for key-rotation paths** — flagged for Larissa at `obsidian/insights/security-deferrals.md` entry `O-5-2`. Not yet verified.
- **Post-onboarding biometric prompt uses local-only passkey, not server-passkey** — `apps/user-client/src/components/PostOnboardingBiometricPrompt.tsx`. Phase 0 simplification because `@simplewebauthn/browser` isn't a user-client dep yet. Worth flagging in the squash commit message.
- **5 pre-existing auth-service teardown failures** — Bootstrap CLI (2), Admin user endpoints (1), Admin invitation endpoints (2). All "(unnamed)" teardown tests, none touching alphabet logic. These predate this overhaul; STATUS.md cited 9 different `full-lifecycle.test.ts` failures which are showing as skipped in the current environment.

---

## 8. Quick start for the next session

1. Read this file.
2. Read the bottom of `obsidian/STATUS.md` to confirm you remember where the pre-session baseline is.
3. Bring up the dev env (§ 3).
4. Add the temporary `console.error` from § 2.
5. Reproduce the "Something went wrong" with the bootstrap invitation code.
6. Pick the hypothesis from § 2 that matches the error you see.
7. Fix → commit → retry manual verification.
8. Once green: walk the rest of spec § 10 verification checklist.
9. Then Task 24 (Larissa).
10. Then Task 25 (squash + STATUS.md + push).

Schlaf gut, Liz.
