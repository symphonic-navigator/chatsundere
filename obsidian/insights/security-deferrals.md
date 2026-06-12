# Security Deferrals — Larissa audit findings

This file logs security findings from Larissa (Opus audit subagent) that I (Liz) consciously deferred rather than fixing before squash. Chris reviews this file at every release cut.

## Entry format

```markdown
## YYYY-MM-DD — Short title

- **Affected paths:** `apps/auth-service/src/...`
- **Finding (Larissa's summary):** Short, faithful paraphrase.
- **Severity:** critical / high / medium / low (Larissa's classification).
- **Rationale for deferral:** Why this is acceptable to ship now.
- **Follow-up commitment:** What I will do, by when (release / milestone).
```

## Ground rules

- Critical and high findings are not deferrable without explicit Chris sign-off in this file.
- Every deferral has a follow-up. "We will think about it" is not a follow-up.
- If a deferral has not been resolved by its committed milestone, it bubbles up to the next release cut for re-evaluation.

---

## 2026-05-18 — Larissa skipped for monorepo setup unit

- **Affected paths:** `apps/auth-service/**`, `apps/sync-service/**`, `apps/proxy-service/**`, `packages/crypto/**`
- **Finding (Larissa's summary):** _(not run)_
- **Severity:** N/A (no findings exist because no audit was performed)
- **Rationale for deferral:** The "Set up monorepo and tooling" unit touches the four paths in Larissa's scope per CLAUDE.md §9, but every source file in those paths is one of: a Hono application exposing only `/healthz`, `/readyz`, `/metrics`; a Valibot env schema with no secrets; a `prom-client` default-metrics initialiser; a `pino` logger; or a stub function throwing `CryptoError('internal', 'Stub')`. No OPAQUE, no WebAuthn, no JWT issuance, no DB queries, no real cryptography. The audit would have nothing actionable to find.
- **Follow-up commitment:** Larissa runs on the next unit (`Add auth-service`, expected commit subject: "Add auth-service") before that unit's squash, and again on the unit after that (`Add crypto package`). The audit moves with the substance.

## 2026-05-18 — Crypto-package squash A — deferred Larissa findings

Full audit report at `superpowers/plans/2026-05-18-foundational-auth-crypto-package.md` (Larissa run between commit `7c7c8f3` and `44df3ac`). Critical: none. Must-fix Highs and clear Mediums were fixed in commit `44df3ac` before squash. The items below were consciously deferred.

### H-1 (reclassified Medium by Larissa during write-up) — Recovery wrap accepted without server-side integrity attestation

- **Affected paths:** `packages/crypto/src/flows/recovery-online.ts`
- **Finding (Larissa's summary):** The recovery flow unwraps a server-returned `wrapped_mk_recovery` without an integrity tag attesting that the wrap is the original one written at link time. A malicious server (or DB-write attacker) could swap in an attacker-chosen wrap. AAD-binding prevents cross-user/cross-method swaps; the recovery key prevents arbitrary attacker MK injection. Combined with the design assumption that recovery keys are paper-stored, the threat is bounded but worth noting.
- **Severity:** medium (after re-classification — original "high" overstated since the attack requires a malicious server, and the AAD binding plus recovery-key requirement bounds the exposure to the user's own data being inaccessible rather than to attacker takeover).
- **Rationale for deferral:** Inherent to the design pivot in spec §3.6 — recovery is the one place where the server's stored wrap is treated as authoritative input. Adding a server-side integrity tag protected by a third secret would solve it but adds complexity that's out of scope for phase 0. Acceptable trade-off given recovery key entropy (256 bits, paper-stored).
- **Follow-up commitment:** Re-evaluate at phase 1 sync-service design; the same trust question applies there. If we add per-record integrity tags at that point, retrofit `recovery-online.ts` to verify them too. Log this as a checkpoint before v0.1.0.

### M-3 — `changePassphraseLinkedOnline` atomicity edge case lacks a regression test

- **Affected paths:** `packages/crypto/src/flows/change-passphrase.ts`
- **Finding (Larissa's summary):** The change-passphrase happy path uses three IndexedDB transactions (write staging → set staging state → commit to primary). A crash between "set committed" and "commit to primary" is handled correctly by `reconcileStagingOnBoot` (idempotent re-commit), but there is no automated test verifying the idempotency.
- **Severity:** low (correctness verified by reading; only the regression-safety net is missing).
- **Rationale for deferral:** Writing a crash-injection test requires either a custom IndexedDB wrapper that can be made to throw mid-transaction or a real crash scenario. The cost is non-trivial; the manual proof in code review is convincing.
- **Follow-up commitment:** Add an injectable-failure test harness when we add the sync-service's similar staging logic in phase 1; back-port the test to crypto's change-passphrase then.

### M-7 — WebAuthn local-verify test does not exercise a real signed assertion

- **Affected paths:** `packages/crypto/tests/webauthn/local-verify.test.ts`
- **Finding (Larissa's summary):** The test verifies the sign-counter rollback short-circuit and that synced-AAGUID authenticators don't trigger it, but never demonstrates that `verifyAuthenticationResponse` actually accepts a valid signed assertion from a real keypair. Coverage is therefore limited to our wrapper logic, not the verification path itself.
- **Severity:** low (relies on `@simplewebauthn/server`'s own test suite for the verification correctness).
- **Rationale for deferral:** Constructing a real EC keypair + signing a real `clientDataJSON` + `authenticatorData` in a unit test is mostly re-implementing what the library already tests. Net gain marginal.
- **Follow-up commitment:** When the user-client (squash D) is built, the device-test scripts will exercise this end-to-end on real hardware. That coverage is more meaningful than a synthetic unit test here.

### L-1 — `decodeRecoveryKey` uses non-constant-time string operations

- **Affected paths:** `packages/crypto/src/encoding/recovery-key.ts`
- **Finding (Larissa's summary):** Crockford-base32 decoding uses string indexing and `parseInt` which are not constant-time.
- **Severity:** low (input is the user's own recovery key on their own device; no remote side-channel adversary).
- **Rationale for deferral:** Implementing a constant-time base32 decoder is non-trivial and the realistic threat model (timing attacks against client-side decoding of one's own key) is contrived.
- **Follow-up commitment:** None; documented as accepted.

## 2026-05-18 — Refresh-reuse user-facing notification

- **Affected paths:** `apps/auth-service/src/jwt/refresh.ts`, `apps/user-client/**`
- **Finding (Larissa's summary, H-B1):** When refresh-token reuse is detected the server revokes the entire token family and writes an audit event. The Prometheus counter `auth_refresh_reuse_detected_total` now makes this observable to ops. However, the affected user receives no real-time notification (e.g. push notification, in-app alert) that their session was force-terminated due to a potential token theft.
- **Severity:** low (ops-observable via Prometheus alert; the user-facing impact is that they are silently signed out on next request, which is already the secure default behaviour; no data is exposed).
- **Rationale for deferral:** The user-client (phase 0) has no push-notification infrastructure. Adding in-app alerts requires a connected WebSocket or SSE channel that is phase-1 scope. The Prometheus counter satisfies the ops-observability requirement in the interim.
- **Follow-up commitment:** When the sync-service real-time channel is built in phase 1, wire a `session.revoked` event so the client can surface a dismissible "Your session was terminated on another device" banner.

## 2026-05-18 — Per-process OPAQUE server setup (Task 9)

### M-5 — OPAQUE server setup is regenerated on every process start

- **Affected paths:** `apps/auth-service/src/opaque/server.ts`
- **Finding (Larissa's summary):** `getServerSetup()` calls `opaqueServer.createSetup()` on first invocation and caches the result in a module-level variable. Every process restart produces a new OPAQUE server setup. In-flight registration sessions started before a restart will fail at `/finish` (Redis state holds the old session_id but the server setup has changed). In a multi-replica deployment, each replica has an independent setup, making inter-replica OPAQUE cross-requests fail silently.
- **Severity:** medium (phase-0 single-replica, no multi-instance deployment; the window where an in-flight registration straddling a restart fails is narrow and recoverable by retrying).
- **Rationale for deferral:** Phase 0 runs a single replica. A restart mid-registration is unlikely in practice, and the user-facing error is a clear "session expired" prompting a retry. Storing the setup in the DB or a dedicated env var requires key-management scaffolding that is out of scope here.
- **Follow-up commitment:** Before any multi-replica or production deployment: store the OPAQUE server setup in the DB (one row, written once at first boot, read-only thereafter) or pass it via a dedicated `OPAQUE_SERVER_SETUP` env var. Log the migration as a prerequisite for v0.1.0.

### L-5 — Old `local_amk` not explicitly zeroed after passphrase change

- **Affected paths:** `packages/crypto/src/flows/change-passphrase.ts`
- **Finding (Larissa's summary):** The Argon2id-derived old AMK lives on the heap until garbage collection. We zero the MK and recovery key in `MasterKeySession.close()` but don't apply the same discipline to in-flight AMKs.
- **Severity:** low (best-effort zeroing in JS is documented in spec §3.11 as a known limitation).
- **Rationale for deferral:** Applying the discipline consistently across every transient KDF output would clutter the code. Spec §3.11 explicitly documents the limitation.
- **Follow-up commitment:** None unless a memory-disclosure-class vulnerability emerges in practice.

## 2026-05-18 — Auth-service squash B — additional deferred Larissa findings

Full audit run between commit `371d895` and `93429b0`. Critical and must-fix High items addressed in `93429b0`. The items below were consciously deferred.

### M-B1 — `/metrics` endpoint is not authenticated

- **Affected paths:** `apps/auth-service/src/routes/metrics.ts`, `apps/auth-service/src/server.ts`
- **Finding:** Anyone reaching port 3100 can read Prometheus exposition, including counters such as `auth_logins_total{result="fail"}` and `auth_admin_actions_total{action="role_change"}`. Labels are PII-free per M3 fix, but timing information and counter values still leak operational signals.
- **Severity:** medium (no PII leak; operational-signal leak).
- **Rationale for deferral:** Deployment topology will firewall the metrics port at the reverse-proxy layer or scrape from localhost only. README and `DEPLOYMENT.md` (when written) will mandate this.
- **Follow-up commitment:** Add an explicit hint in the auth-service README's "Running locally" section warning that `/metrics` must not be exposed publicly. Decision before v0.1.0: either bind a separate listener for `/metrics` or require bearer-auth.

### M-B3 — `writeAudit` does not format-check `userId` / `actorUserId`

- **Affected paths:** `apps/auth-service/src/audit/log.ts`
- **Finding:** UUID columns are inserted as strings; a future regression could feed a non-UUID value and corrupt the audit log.
- **Severity:** low (no current caller does this; pure defense-in-depth).
- **Rationale for deferral:** Cost minimal; pragmatic to defer to the next audit/spec-touch pass.
- **Follow-up commitment:** Add a UUID-format assertion when next touching `audit/log.ts`.

### M-B4 — `transfer-primary` audit-event semantics under-documented

- **Affected paths:** `apps/auth-service/src/routes/admin/users.ts`
- **Finding:** `userId` in the `primary_admin.transferred` event refers to the new primary admin (target), `actorUserId` to the previous primary admin (initiator). Reviewer could assume the opposite.
- **Severity:** low (documentation gap, not a bug).
- **Rationale for deferral:** ADR-worthy; not blocking. Decision before v0.1.0.
- **Follow-up commitment:** Write a short ADR (likely 0020) documenting the audit-event semantics map.

### L-B1 — `rateLimit` middleware is exported but never registered as a global middleware

- **Affected paths:** `apps/auth-service/src/middleware/rate-limit.ts`, `apps/auth-service/src/server.ts`
- **Finding:** The middleware is dead code in the current wiring; all live rate-limiting flows through the body-aware `applyLoginRateLimit` helper.
- **Severity:** low (confusion risk; not a security hole).
- **Rationale for deferral:** Genuine deletion would close the option of using it for IP-based limits on `/v1/token/refresh` etc. Keep for now; clean up when applying IP rate-limits at a later milestone.
- **Follow-up commitment:** Decide before v0.1.0 between (a) wire IP-keyed limits on `/v1/token/refresh` + `/v1/admin/invitations`, or (b) delete the unused middleware. Whichever wins, take it; do not leave both.

### L-B3 — Per-username login rate-limit counts successful logins

- **Affected paths:** `apps/auth-service/src/routes/_rate-limit-helpers.ts`
- **Finding:** A user who legitimately signs in 11 times in 15 minutes can lock themselves out for the rest of the window.
- **Severity:** low (UX paper-cut, not a security issue).
- **Rationale for deferral:** Counting only failures is the conventional pattern; current code counts every attempt because the counter increments before the OPAQUE finish runs. Refactoring to defer increment until after the failure verdict is straightforward but not urgent.
- **Follow-up commitment:** Address in the post-Larissa cleanup pass for squash D, when the user-client surfaces rate-limit errors and the UX cost becomes user-visible.

### L-B4 — Bootstrap file path uses `/tmp` fallback when `XDG_RUNTIME_DIR` is unset

- **Affected paths:** `apps/auth-service/src/cli/bootstrap.ts`, `apps/auth-service/src/routes/link.ts`
- **Finding:** File mode is `0o600`, but the parent directory `/tmp` is typically world-readable. The filename itself encodes the invitation id (visible to `ls /tmp`).
- **Severity:** low (token is inside the file, not the filename; file is 0600).
- **Rationale for deferral:** The container deployment will set `XDG_RUNTIME_DIR=/run/auth-service` with the directory at `0700`. Local-dev exposure is acceptable.
- **Follow-up commitment:** Add `XDG_RUNTIME_DIR=/run/auth-service` to `infra/compose.prod.yml.example` and document the requirement in `apps/auth-service/README.md` operational section before v0.1.0.

## 2026-05-18 — Raw MK leaks through login-flow return types (Pre-Squash D)

- **Affected paths:** `packages/crypto/src/flows/login-local.ts`, `packages/crypto/src/flows/login-online-linked.ts`, `packages/crypto/src/flows/recovery-online.ts` (and the upstream callers in `packages/crypto/src/flows/` that take `mk: MasterKey` as a separate argument: `link-to-server.ts`, `add-passkey-post-link.ts`, `setup-biometric.ts`, `regenerate-recovery-key.ts`, `change-passphrase.ts`).
- **Finding (self-noticed during Pre-Squash D crypto helper work):** `loginLocalWithPassphrase`, `loginLocalWithRecoveryKey`, and `loginOnlineLinked` all return `{ session, mk }` with an explicit JSDoc comment ("available for callers that need to re-wrap under a new credential"). That comment is what justifies the existing pattern of passing a separate `mk: MasterKey` argument into flows like `completeLocalBiometricRegistration`, `linkToServer`, `addPasskeyPostLink`, etc. The pattern means there are at least two live references to the master key on every login: one inside `MasterKeySession`'s closure (zeroed on `session.close()`) and one in the caller's local variable (zeroed only when the variable falls out of scope). `apps/user-client` should not need to handle a raw `mk` at all — the new `session.registerLocalBiometric` method introduced in this squash removes the only user-client-facing need for it.
- **Severity:** low (heap-residue exposure on the client device; mirrors spec §3.11's acknowledged limitation that JS heap zeroing is best-effort). Not a wire-protocol or server-trust issue.
- **Rationale for deferral:** A full sweep would touch every flow under `packages/crypto/src/flows/`, plus their tests, plus their call-sites in any other `packages/crypto` flow. Out of scope for the small Pre-Squash D crypto helper, which is intentionally minimal. Larissa was *not* asked to flag this in the Squash A audit — it was a deliberate design choice at the time. Reclassifying now and deferring is the honest accounting.
- **Follow-up commitment:** Schedule a small dedicated squash after Squash D ships ("Tighten crypto MK custody: only `MasterKeySession` references the MK after creation"). It refactors `loginLocal*` and `loginOnlineLinked*` to return only `session`, moves the `mk: MasterKey` argument out of every flow signature, and provides equivalent session-methods where needed (mirror the pattern from `registerLocalBiometric`). Larissa audits that squash. Must land before v0.1.0.
- **Note (2026-05-18 evening, Task 9):** During Squash D Task 9 the implementer extended `loginOnlineLinked` to also surface `mk` in its return type (it previously returned only `{ session, serverOutcome, … }`). The Pre-Squash D entry above understated the prior state — `loginOnlineLinked` had not yet leaked `mk`. The Task 9 extension makes the pattern symmetric with `loginLocalWithPassphrase` and `loginLocalWithRecoveryKey`, which user-client needs for `regenerateRecoveryKey` calls in the settings flow. This widens, rather than narrows, the deferred Hygiene-cleanup scope; the scheduled "Tighten crypto MK custody" squash now also reverses this Task 9 change. Larissa was not consulted before the change because Squash D was nominally frontend-only and the implementer judged the touch trivial — this is a process slip; flagged so the final Squash D Larissa pass over the cumulative crypto diff catches anything genuinely risky. Severity unchanged (low).
- **Note (2026-05-21, QA-fixes squash):** The Shape-A session-store refactor in commit `9eccf0a` *partially* advances this deferral. The user-client side no longer needs a raw `mk` reference because the store owns the slice and consumers read it from there. The `packages/crypto` side is unchanged: `loginLocalWithPassphrase`, `loginLocalWithRecoveryKey`, and `loginOnlineLinked` still return `{ session, mk, ... }`. The scheduled "Tighten crypto MK custody" squash is now smaller in scope (consumers already migrated) and is the right time to also drop `mk` from those return shapes. Severity unchanged (low). Larissa's 2026-05-21 audit confirmed the user-client custody story is now stronger.

## 2026-05-21 — Squash (QA-fixes-from-Squash-C) deferred Larissa findings

Full audit run between commit `0edb18e` and `1905c42`. Critical: none. High: none. M-1, M-2, L-1, L-2 were fixed in commit `e3e35f6` before squash (URL-normalising guard, `session.close()` spy, `delete` over `= undefined`, mk-replacement regression test). The items below were consciously deferred.

### L-3 — `refresh-on-401` triggers `closeAndForget` on any non-ok refresh response (pre-existing)

- **Affected paths:** `apps/user-client/src/lib/fetch.ts:83-95`
- **Finding (Larissa's summary):** Any non-ok refresh response — transient 502/503, network blip in the catch branch, server error — triggers a full logout and MK zeroing. The code comment only mentions the `refresh_token.reuse_detected` case but the implementation is broader. UX paper-cut (false-positive logouts cost the user a passphrase entry); security-conservative-on-purpose (when in doubt, drop credentials).
- **Severity:** low (pre-existing; security-conservative behaviour; UX-only cost).
- **Rationale for deferral:** Narrowing to only fire on `refresh_token.reuse_detected` requires a coordinated UX decision about what to do with the other refresh-failure shapes (silent retry? `HttpError` to caller? a banner?). Coordinated with the existing 2026-05-18 "Refresh-reuse user-facing notification" deferral (above) which already owns the phase-1 real-time-channel surface where this decision will land.
- **Follow-up commitment:** Resolve alongside the 2026-05-18 "Refresh-reuse user-facing notification" entry when the phase-1 sync-service real-time channel adds session-revocation banners. Until then, the conservative behaviour stands.

### L-4 — `change-passphrase.tsx` `capturedMk` comment slightly stale

- **Affected paths:** `apps/user-client/src/routes/change-passphrase.tsx:176-178`
- **Finding (Larissa's summary):** The comment on `capturedMk` describes it as "narrowed", framing carried over from before the Shape-A refactor when `session.mk` had to be type-guarded. Post-refactor, `mk` is already non-null from the line-151 guard; the capture-into-local rationale (avoid mid-flight store re-read) is still valid but the wording is stale.
- **Severity:** low (documentation nit, no behavioural concern).
- **Rationale for deferral:** Pure cosmetics; the file works correctly and the slightly-stale comment is unlikely to mislead anyone touching the code again.
- **Follow-up commitment:** Update the comment opportunistically the next time `change-passphrase.tsx` is touched for any other reason. No standalone work warranted.

## 2026-05-22 — Squash γ (step-up backend) deferred Larissa findings

Full audit run over commits `fa29bb4..fe08e89` (later squashed). Critical: none. High: H1 (OPAQUE bricks after username change) fixed in commit `29c8a42` before squash via migration 0005 + `auth_methods.opaque_client_identifier`. Medium: M1 (WebAuthn `/finish` GET+DEL race) and M2 (sign counter on uv_required) fixed in the same commit. The Low items below were consciously deferred.

### L-γ-1 — `setStepUpKey` TTL has a sub-second floor mismatch with `requireStepUp`

- **Affected paths:** `apps/auth-service/src/auth/step-up.ts:54-70`, `apps/auth-service/src/routes/step-up.ts` (`setStepUpKey`)
- **Finding (Larissa's summary):** `requireStepUp` compares millisecond-precision timestamps (`Date.now() - ts > graceMs`) while `setStepUpKey` rounds the Redis TTL up to whole seconds with `Math.ceil`. For Tier 3 (10 s) Redis may evict the key up to ~999 ms *after* the timestamp comparison would have said "expired" — a 10 % overshoot at worst.
- **Severity:** low (documented defence-in-depth; intentional).
- **Rationale for deferral:** Behaviour is intentional and the timestamp comparison is the authoritative gate — the Redis TTL is a backstop. Larissa flagged only to confirm awareness.
- **Follow-up commitment:** No standalone work warranted. If a future change tightens the model and removes the timestamp from the value, revisit then.

### L-γ-2 — Logout cascade SCAN is bounded but unsynchronised

- **Affected paths:** `apps/auth-service/src/routes/auth.ts:83-94`
- **Finding (Larissa's summary):** A successful `/finish` concurrent with `/logout` can win the race and leave a `step_up:<jti>:t<tier>` key behind after logout returns. Window is the `/finish` handler's runtime.
- **Severity:** low (non-exploitable today — logout also revokes the refresh-token family via `revokeFamily`, so the bearer's session_id is no longer accepted by `bearerAuth`'s session-existence check anyway).
- **Rationale for deferral:** Exploitability depends on a future design change that decouples bearer-validity from session-id-validity. Today the bearer is dead before any leftover step-up key could be used.
- **Follow-up commitment:** Revisit if and when session-id and bearer-validity ever diverge (e.g. long-lived bearers, alternate session-revocation surfaces). No standalone work warranted now.

### L-γ-3 — `step_up_round:*` JSON.parse not Valibot-validated

- **Affected paths:** `apps/auth-service/src/routes/step-up.ts` (`finishWebAuthn`)
- **Finding (Larissa's summary):** The WebAuthn round state read from Redis is cast directly to `WebAuthnRoundState` without structural validation.
- **Severity:** low (Redis is trusted infrastructure today).
- **Rationale for deferral:** Same `JSON.parse(stateRaw) as T` pattern is already used in `routes/login.ts` for passkey-login state and elsewhere. Tightening this in isolation would be inconsistent; a project-wide pass that introduces Valibot schemas for all Redis-stored state shapes is the right scope.
- **Follow-up commitment:** Bundle into the existing crypto/auth hygiene cleanup tracked in `follow-ups-index.md` if and when we adopt a consistent serialisation convention.

## 2026-05-22 — Squash β (cross-device-identity endpoints) deferred Larissa findings

Full audit run on the four functional commits of Squash β. Critical: none. High: H1 (no per-IP rate limits on `/api/v1/join/*`) fixed in commit `ae8389a` before squash. Medium: M1 (kind_mismatch consumed attempt counter) fixed in the same commit. Low items below were consciously deferred.

### L-β-1 — `consumePendingCodeAttempt` "type never changes" comment is too absolute

- **Affected paths:** `apps/auth-service/src/codes/rate-limit.ts:39`
- **Finding (Larissa's summary):** The comment justifying the SELECT-then-UPDATE TOCTOU window claims `pending_codes.type` never changes after insert. True for production code (no endpoint mutates `type`), but test code (`tests/integration/join-invitation.test.ts:252`) does mutate `type` via direct DB UPDATE for kind-mismatch coverage. If a future contributor follows that same pattern in a production code path, the TOCTOU assumption silently breaks.
- **Severity:** low (documentation precision; not currently exploitable — only test code mutates).
- **Rationale for deferral:** The comment is accurate as a *runtime* statement today; the only risk is future drift. Adding a DB-level CHECK constraint (`type` is immutable) is the durable fix, but introduces a schema change with no exploit lurking.
- **Follow-up commitment:** Either tighten the comment to "no production code path mutates `pending_codes.type`" the next time the file is touched, or add a Postgres trigger refusing UPDATEs on the `type` column. No standalone work warranted; revisit only if the TOCTOU window grows (e.g. if the SELECT and UPDATE are split across connections).

### L-β-2 — `ipKey` trusts `X-Forwarded-For` blindly — relies on a deployment invariant

- **Affected paths:** `apps/auth-service/src/middleware/rate-limit.ts:38-42`
- **Finding (Larissa's summary):** Pre-existing finding (not introduced by Squash β) but the H1 rate-limit wiring widens its blast radius. `ipKey()` reads the first comma-separated value from `X-Forwarded-For` then falls back to `X-Real-IP`, with no allow-list of trusted proxy hops. A client speaking directly to the auth-service (e.g. a misconfigured deployment without a fronting reverse proxy) can set `X-Forwarded-For` to a random value per request and bypass every per-IP rate limit (`step_up_ip`, `join_ip_minute`, `join_ip_hour`, and any future per-IP bucket).
- **Severity:** low (configuration-dependent; mitigated by the production deployment requiring a reverse proxy that overwrites the header authoritatively).
- **Rationale for deferral:** The fix is to read a configurable `TRUSTED_PROXY_IPS` list and only honour `X-Forwarded-For` from those hops. Doing it correctly requires environment plumbing and per-deployment configuration that does not exist yet. The interim mitigation is operational: `compose.prod.yml.example` must front the auth-service with a reverse proxy that overwrites `X-Forwarded-For` (not appends).
- **Follow-up commitment:** Add `TRUSTED_PROXY_IPS` env var + middleware-aware header parsing before v0.1.0. Document the "production deployment must front with a reverse proxy" requirement in `compose.prod.yml.example` + `apps/auth-service/README.md` in the same squash that lands the env var.

## 2026-05-22 — Onboarding overhaul Task 5 (`joinByPairing`) deferrals

### O-5-1 — Device B local recovery-key login intentionally unavailable

- **Affected paths:** `packages/crypto/src/flows/join-by-pairing.ts:249-280`
- **Finding (Liz, pre-Larissa):** Pairing onto a fresh PWA (Device B) cannot persist the user's actual recovery key into `local_account.wrapped_mk_recovery_*` — the user's recovery key string lives in their notes or password manager from Device A's original onboarding, and is not transmitted by the pairing protocol. The implementation populates the local recovery wrap with a random placeholder, including a placeholder `recovery_verifier_key`. Consequence: `loginLocalWithRecoveryKey` on Device B will reject the user's real recovery key as `wrong_recovery_key`. The user must use `recoveryOnline` (server-assisted) for any recovery on Device B; `recoveryOnline` is unaffected because it derives the verifier from the input recovery-key string before consulting the local row.
- **Severity:** low (UX availability — not a confidentiality or integrity issue; the placeholder never leaves the device).
- **Rationale for deferral:** Alternatives would require either prompting the user for the recovery key during pairing (worsens UX), or transmitting the wrap material via a side channel (adds protocol surface). For Phase 0 the constraint is acceptable; the documented recovery path is `recoveryOnline`.
- **Follow-up commitment:** Either (a) extend the pairing protocol to permit optional user-supplied recovery key sync during finish, or (b) add a guard in `loginLocalWithRecoveryKey` that detects placeholder verifiers and reroutes the user to `recoveryOnline` with a "recovery on this device requires the server" hint. Decide before v0.1.0.

### O-5-2 — AAD-consistency between server-stored wrap and key-rotation paths (deferred for Larissa)

- **Affected paths:** `packages/crypto/src/flows/join-by-pairing.ts:262-265`; `change-passphrase.ts`, `regenerate-recovery-key.ts` (key-rotation flows)
- **Finding (Liz, pre-Larissa, flagged for audit):** `finishJoinByPairing` stores `linked_account.wrapped_mk_opaque_aad = serverWrapped.aad`. If key-rotation flows (`change-passphrase`, `regenerate-recovery-key`) re-derive the AAD via `makeLocalAccountAad(username, 'opaque')` instead of reading the stored AAD field, Device B's OPAQUE wrap will decrypt-fail after a passphrase change. Has to be verified during the Larissa pass for the squash; not addressed in this fix.
- **Severity:** unconfirmed; depends on key-rotation flow implementation.
- **Rationale for deferral:** Belongs in the same Larissa audit that covers the join flows.
- **Follow-up commitment:** Larissa audit task at end of onboarding-overhaul squash (Task 24) explicitly checks the AAD-source consistency between join, login, and key-rotation flows.

## Credential bus — new access surface to unsealed keys (2026-06-01)

The credential bus (`apps/user-client/src/credentials/`) is a new place that
calls `openSecret` to return decrypted provider API keys to in-app consumers
(future integrations). It changes no crypto primitive and adds no storage, but
it widens *who* can request a decrypted key beyond the chat send path. Not a
Larissa-gated change (no `auth-/sync-/proxy-service` or `packages/crypto`
touch). Follow-up to watch when the first integration lands: ensure integration
code retrieves keys only at the point of an outbound call and does not persist
or log the plaintext.

## calculate_js sandbox — client-side JS execution surface (2026-06-02)

The `calculate_js` tool (`apps/user-client/src/tools/`) executes
**model-generated** JavaScript in the browser. It is not a Larissa-gated change
(no `auth-/sync-/proxy-service` or `packages/crypto` touch), but it is a new
security-sensitive surface and is logged here deliberately.

- **Boundary:** a fresh Web Worker per call (`sandbox.worker.ts` +
  `sandbox-host.ts`), terminated after the reply or on a 10 s timeout / abort.
  Dangerous globals (`fetch`, `XMLHttpRequest`, `WebSocket`, `importScripts`,
  timers, `Worker`, `indexedDB`, `caches`, …) are nulled on the Worker `self`
  and additionally shadowed as function-local `var … = undefined` inside the
  eval scope (`sandbox-exec.ts`). Pure compute only — no DOM, no network.
- **Threat model:** the code is produced by the LLM (delivered over the provider
  stream), not by an attacker directly, but a hostile or compromised provider
  response could inject code — hence the Worker isolation + nulled
  network/storage globals. Output is capped (4 KB) and the run is time-bounded.
- **Why a Worker and not an iframe:** an origin-isolated iframe buys nothing for
  pure compute (no DOM access is granted). Revisit the boundary (sandboxed
  iframe / stricter isolation) only if a future tool needs DOM or richer
  capabilities.
- **Follow-up to watch:** when provider-side web-search integrations or any
  DOM-touching tool land, re-evaluate the isolation model and consider a Larissa
  pass on the execution boundary at that point.

## 2026-06-02 — Web-interfacing integration: planned outbound surface

The web-interfacing spine is dormant (no adapter), so there is no network call
yet. When the nano-gpt web adapter lands, the integration will send the user's
query/URL **plus the NSFW flag and location** to an upstream — privacy-sensitive
context leaving the device. Discipline for the adapter: retrieve the provider key
only at the outbound point via the credential bus (never persist or log it); never
log the query, URL, or location. Not a Larissa item for the spine (client-only,
no auth/sync/proxy/crypto path) — but the adapter that lights it up will be.

## 2026-06-03 — Web-interfacing integration: realised outbound surface

The nano-gpt web adapter landed (`packages/llm-unified/src/web-adapters/nano-gpt-web.ts`),
so the surface above is now live. How the discipline was honoured:

- **Query/URL leave the device.** `web_search` sends the conversation-derived
  query to the chosen provider (Linkup/Exa/Brave) via nano-gpt's `/api/web`;
  `web_fetch` sends the target URL to `/scrape-urls`. Inherent to web search,
  surfaced honestly to the user by a quiet zero-knowledge line in the settings
  section ("Search queries and fetched pages leave your device…").
- **Routes through the user's own CORS proxy.** The web endpoints send no CORS
  headers (measured), so the adapter routes via the user-configured `corsProxy`
  rail (reusing `buildRequest`), not client-direct. The proxy is the user's own
  infrastructure (their VPS), so it seeing the query/key is within the trust
  model — but it *is* a hop, recorded here.
- **Key handling.** The nano-gpt key is fetched MasterKey-gated at the outbound
  point via the credential bus (`ctx.getKey`, call-time only) and the decrypted
  CORS-proxy shared key the same way (`openSecret`); neither is persisted or
  logged. The query/URL are never logged.
- **NSFW + location are NOT sent** to nano-gpt — its `/api/web` body accepts
  neither, so the adapter drops them (they remain on `WebContext` for a future
  brave-direct backend that would localise/filter). This *narrows* the
  2026-06-02 "planned" concern: nano-gpt receives only the query/URL, not the
  NSFW flag or location.
- **Constructive failure.** Adapter errors are caught in the tool `execute` and
  returned as a constructive `ToolResult` error rather than an unhandled throw.
- Not a Larissa-gated change (llm-unified + user-client only; no
  `auth-/sync-/proxy-service` or `packages/crypto` touch).
- **Phase-2 follow-up:** route the call through the first-party `proxy-service`
  once it exists, so even the transport hop is first-party and auditable.

## 2026-06-05 — User attachments + substitute vision: realised outbound surface

Not a Larissa-gated change (client-only: `apps/user-client` + an `llm-unified`
one-shot wire call; no `auth-/sync-/proxy-service` or `packages/crypto` touch).
Recording the new outbound surface, analogous to the web-interfacing entries.

- **Uploaded content leaves the device.** When the user sends a message with
  image/text attachments, the content reaches the chosen model's provider:
  images as a base64 `image_url` part (already normalised to 1024px JPEG
  client-side before storage/send), text attachments as a filename-headed text
  part. Inherent to using a cloud model — identical in nature to sending the
  prompt itself.
- **Substitute-vision describe call.** When the active model cannot see images
  and a global substitute vision model is configured, each image is sent (same
  normalised base64) in a one-shot completion to the *substitute* provider to
  produce a text description, which is then injected into the active model's
  context. So an image can reach a second provider (the substitute) in addition
  to the active one — a deliberate, user-configured behaviour.
- **Key handling.** The substitute provider's API key is decrypted MasterKey-
  gated in the send path only (`openSecret`, the same slot/path the active model
  uses), passed transiently to the one-shot call, never stored on the stream
  handle nor in Dexie. A decrypt failure degrades to "no substitute" and never
  blocks a send. Neither the key, nor image data URLs, nor descriptions are
  logged.
- **Local storage.** Only the normalised JPEG (not the original) and any cached
  vision description are stored in IndexedDB; nothing is uploaded to our server
  (there is no server in this path — local-first).
- **Phase-2 follow-up:** when a substitute model routes via a CORS proxy, the
  same first-party `proxy-service` migration noted above applies.

## 2026-06-06 — Lightbox viewer: iframe-exec & content-render surfaces

Not a Larissa change (client-only — no auth/sync/proxy/crypto path). Logged here
for completeness, as the lightbox now renders untrusted file content with new
mechanisms. The lightbox-viewer work (branch `worktree-lightbox-viewer`) added
standalone HTML / SVG / code / mermaid / markdown previews.

- **HTML preview runs untrusted content in a hard-sandboxed iframe.**
  `previews/HtmlPreview.tsx` renders an uploaded HTML file via
  `<iframe srcDoc … sandbox="allow-scripts">` with **no** `allow-same-origin`.
  The null origin means the iframe cannot read cookies, `localStorage`, or
  IndexedDB — where the MasterKey and ciphertext live — so previewed scripts
  cannot reach user secrets. A strict CSP `<meta>` is injected into the srcDoc
  (`default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src
  'unsafe-inline'; font-src data:;`), which blocks **all** external network
  requests: no phone-home, no IP-leak, no tracking from previewed HTML.
  Self-contained HTML renders; anything reaching out is blocked.
- **SVG preview cannot execute scripts.** `previews/SvgPreview.tsx` renders the
  SVG as an `<img>` `data:image/svg+xml;base64,…` URI. The image context does not
  execute embedded `<script>` — safe by construction (the SVG source is never
  injected as raw inner HTML).
- **Code preview** injects shiki's library-generated HTML (same reviewed pattern
  as the chat `CodeBlock`) — not user HTML.
- **iframe→parent Escape bridge.** The HTML preview posts
  `{ type: 'lightbox-escape' }`; the lightbox validates `event.data?.type` before
  acting (an action trigger, not data — no origin trust needed).
- **JSX/SPA deferred on zero-knowledge grounds.** chatsune's artefact view loaded
  React + Babel from `unpkg.com` at runtime (third-party CDN = IP-leak + remote-code
  surface). That was **rejected**; JSX/SPA preview is deferred to the
  artefact-generation work with a locally-bundled transpiler. See
  [[follow-ups-index]] (Active — Implementation) and
  [[../../superpowers/specs/2026-06-06-lightbox-viewer-design]] §11.

## 2026-06-06 — Artefact Kern: model-generated executable HTML surface

Not a Larissa-gated change (client-only — `apps/user-client` only; no
`auth-/sync-/proxy-service` or `packages/crypto` touch). Logged here because
the artefact system persists and renders **model-generated executable HTML**,
which is a new content-execution surface.

- **Execution boundary.** The artefact HTML is rendered by the existing
  `HtmlPreview` sandbox (`previews/HtmlPreview.tsx`), reused via the lightbox
  `artefactToViewable` bridge — identical containment to the lightbox-viewer
  HTML preview logged in the 2026-06-06 entry above. Specifically:
  `<iframe srcDoc … sandbox="allow-scripts">` with **no** `allow-same-origin`.
  The null origin prevents access to cookies, `localStorage`, or IndexedDB —
  so no user secrets are reachable from within the artefact. A strict CSP
  `<meta>` is injected (`default-src 'none'; img-src data:; style-src
  'unsafe-inline'; script-src 'unsafe-inline'; font-src data:;`), blocking all
  external network requests: no phone-home, no IP-leak even from a
  prompt-injection attempt in the generated code.
- **Author system prompt.** The author subagent prompt (`AUTHOR_SYSTEM_PROMPT`
  in `lib/artefact-author.ts`) explicitly instructs the model to use no external
  resources, no CDN, no `<script src>`, no `<link href>` to remote resources,
  no `fetch`/`XHR`/`WebSocket`. The prompt is defence-in-depth — the **sandbox
  is the real boundary** (never trust model output). A jailbroken or
  misbehaving model cannot exfiltrate data or phone home because the CSP +
  null-origin sandbox blocks every outbound path regardless.
- **Same posture as the lightbox viewer HTML preview.** No new trust
  assumptions; same iframe sandbox flags and CSP policy.
- **No follow-up required.** The existing sandbox is the appropriate boundary.
  If a future artefact kind (e.g. a locally-bundled JSX/SPA transpiler) changes
  the execution model, re-evaluate and add an entry then.

## 2026-06-06 — Treasury (artefact chunk 2): no new surface

- **Affected paths:** `apps/user-client/**` (client-only; no Larissa scope path).
- **Finding:** _(none — confirmation entry)._
- **Severity:** N/A.
- **Rationale:** The Treasury adds only a global *read* over the local Dexie
  `artefacts` table plus local bulk *tag*/*delete* mutations. Previews still go
  through the same hard-sandboxed `HtmlPreview` (null-origin iframe + CSP
  `default-src 'none'`) logged above — no new execution or network surface, and
  nothing leaves the device. The NSFW-hidden-persona guard was extended to the
  Treasury so an adult persona's artefacts **and their tags** are excluded from
  the SFW view (caught in the final holistic review; fixed before squash).
- **Follow-up commitment:** None required.

## 2026-06-06 — Artefacts as attachments (artefact chunk 3): no new surface

- **Affected paths:** `apps/user-client/**` (client-only; no Larissa scope path).
- **Finding:** _(none — confirmation entry)._
- **Severity:** N/A.
- **Rationale:** Attaching an artefact copies a **snapshot** of its already-
  persisted text content into the existing local `attachments` table (a pending
  `kind:'text'`, `origin:'upload'` row). No new persistence shape (no Dexie
  migration), no new execution surface — previewing a snapshot reuses the same
  hard-sandboxed lightbox viewers (`HtmlPreview` null-origin iframe + CSP
  `default-src 'none'`) logged above. The only new *outbound* consequence is that
  artefact content can now ride a chat message to the model — but that is the
  user's explicit action and is byte-for-byte identical to attaching a text file
  today (same `resolve-send` / `wire-injection` path). NSFW privacy is preserved
  by reusing the Treasury's `useFilteredPersonas` gate (adult-persona artefacts
  never reach the picker in SFW mode).
- **Follow-up commitment:** None required. If a future TTI `kind:'image'`
  artefact gains a blob-snapshot branch, it rides the existing image-attachment
  path (already logged) — re-evaluate only if that path changes.

## 2026-06-06 — Save as artefact (artefact chunk 4): no new surface

- **Affected paths:** `apps/user-client/**` (client-only; no Larissa scope path).
- **Finding:** _(none — confirmation entry)._
- **Severity:** N/A.
- **Rationale:** Save-as-artefact persists model- or user-authored content that
  already exists in the conversation — a message's visible text (as `markdown`)
  or a fenced code block / Mermaid diagram (format from the fence language). A
  saved `html` code block becomes a renderable HTML artefact, but it is another
  *producer* of the **already-logged** persisted-execution surface (the Kern
  entry above): it is previewed by the **same** hard-sandboxed `HtmlPreview`
  (null-origin iframe, CSP `default-src 'none'`, no external network). No new
  execution or network path, no new persistence shape (no Dexie migration — the
  v13 `artefacts` table already carries the `saved-message`/`saved-code-block`
  origins and `markdown`/`code` formats). NSFW provenance is preserved: a saved
  artefact inherits the chat's persona id, gated read-side by the existing
  Treasury/sidebar `useFilteredPersonas` filter exactly as a generated artefact.
- **Follow-up commitment:** None required. Re-evaluate only if a future artefact
  kind introduces a new preview/exec surface (e.g. the deferred locally-bundled
  JSX/SPA viewer — tracked in [[follow-ups-index]]).

## 2026-06-07 — Knowledgebase Chunk A: on-device embedding engine is self-hosted (CORRECTED)

> **Correction (same day):** An earlier version of this entry wrongly claimed the
> runtime fetches model weights from the HuggingFace CDN, exposing the user's IP.
> That is **false**. The embeddings package (`packages/embeddings/src/engine/
> execution.ts`) sets `env.allowRemoteModels = false` and `env.localModelPath =
> '/model/'` — **the runtime never contacts huggingface.co.** The premise of the
> original note (and of spec §4.3's "urgent CDN" follow-up) was incorrect.

- **Affected paths:** `apps/user-client/**`, `packages/embeddings/**` (client-only; no Larissa scope path — auth/sync/proxy/crypto untouched).
- **Finding (confirmation entry — no runtime exposure):** The knowledgebase is the first live consumer of the on-device embedding engine (`Snowflake/snowflake-arctic-embed-m-v2.0`, int8, transformers.js + onnxruntime-web/WASM, WebGPU when available). The engine is configured **self-hosted only**: it loads the model + ONNX runtime assets exclusively from the app's own origin under `/model/`, never from a third party at runtime. No user content, IP, or model-name disclosure leaves the device to any third party during use.
- **Severity:** N/A (no third-party runtime traffic; on-device inference; nothing leaves the device).
- **Operational requirement (not a security deferral, but tracked so it isn't lost):** the ~310 MB int8 weights MUST be **provisioned at `/model/`** for the feature to work — a **build/deploy-time** step, performed once on the operator's machine via `pnpm --filter @chatsundere/user-client fetch-model` (which fetches from huggingface.co **at setup time**, on the operator's machine — not the user's). The weights are gitignored (`apps/user-client/public/model/`); the production deployment must serve `/model/` (the Vite build copies `public/model` → `dist/model`). The only outstanding hardening is **pinning the file SHA256s** in `scripts/fetch-model.mjs` (currently scaffolded but empty). Tracked in [[follow-ups-index]].

## 2026-06-07 — Knowledgebase Chunk A: ONNX runtime WASM loads from jsdelivr CDN at runtime

- **Affected paths:** `packages/embeddings/src/engine/execution.ts` (no `wasmPaths` override), `apps/user-client/**` (consumer). Client-only; no Larissa scope path.
- **Finding:** With the engine now live (Chunk A, device-confirmed), the **model** is self-hosted from `/model/` (never HF at runtime — see the corrected entry above), BUT transformers.js v4.2.0 defaults the ONNX-runtime WASM location (`env.backends.onnx.wasm.wasmPaths`) to the **jsdelivr CDN** (`https://cdn.jsdelivr.net/npm/onnxruntime-web@<ver>/dist/ort-wasm-simd-threaded.asyncify.{mjs,wasm}`). So the on-device inference *runtime* is fetched from a third party at first use, disclosing the user's IP + the onnxruntime version to jsdelivr. **No user content, model, or query leaves the device** — only the generic runtime binary request.
- **Severity:** low (no plaintext/keys/user data; bounded to a one-time IP + library-version disclosure to a public CDN; cached locally afterwards). Higher *principle* weight than impact, given the Proton-grade no-third-party stance.
- **Rationale for deferral:** Self-hosting the ORT WASM requires fetching the correct `onnxruntime-web` build at setup (the binaries are NOT in `node_modules` — transformers ships only the `.jsep.mjs` factory and relies on the CDN) and wiring `wasmPaths`. Out of scope for getting the foundation working; the model self-hosting (the larger privacy surface) is already done.
- **Follow-up commitment:** Self-host the ORT WASM (fetch at setup, serve same-origin e.g. `/ort/`, set `wasmPaths`) before v0.3.0 (public instance), ideally bundled with the production `/model/` deployment work. Tracked in [[follow-ups-index]].

## 2026-06-08 — ask_expert tool: structurally-isolated expert uplink (new outbound egress)

- **Affected paths:** `apps/user-client/**` (client-only; no Larissa scope path — auth/sync/proxy/crypto untouched).
- **Finding:** The `ask_expert` tool realises a **new outbound egress**. When a user enables it and a chat's companion model calls it, a single question string is sent to a user-chosen "expert" cloud model (a normal catalogue offering, keyed by the same per-provider encrypted secret as the active model). This deliberately and consensually breaks the product's privacy / anti-censorship stance for specific technical questions — the "best of both worlds" uplink that lets a small/local conversation model defer hard maths/science/engineering questions to a stronger model.
- **Severity:** low (no plaintext keys/passphrases cross the wire; the api-key reuses the existing MasterKey-gated `openSecret` path; the egress is opt-in and fully transparent — the user sees exactly what was sent in the pill).
- **Rationale / safe by construction:** **Structural isolation** is the security heart. The expert call's `messages` array is built as *exactly* `[system(EXPERT_SYSTEM_PROMPT), user(question)]` (`apps/user-client/src/tools/ask-expert.ts`) — no conversation history, no persona, no about-me, no other tool exchange, and not the companion's own system prompt. Only the `question` string the companion writes ever leaves the device. The companion is *instructed* to phrase that question as a clean, standalone technical query stripped of names and personal/emotional/relational content, but even if it is sloppy, **nothing personal can leak beyond what it deliberately types into the `question` field** — the isolation is enforced in code (and pinned by the load-bearing test `apps/user-client/tests/unit/ask-expert.test.ts`), not by trusting the weakest model in the loop to filter. The uplink is **opt-in at three layers**: a global expert model must be chosen in My Settings (default none → the tool is not offered at all); the persona default ships **off**; and a per-chat cockpit toggle gates execution (when off, the tool stays in the wire tool-defs for prompt-cache stability but `execute` returns a constructive error without calling the model). The expert runs at the model's maximum reasoning effort and is given a neutral, non-censoring system prompt (anti-paternalistic, consistent with the anti-censorship stance).
- **Follow-up commitment:** None required for v0.1.0. Re-evaluate if the question-building path ever gains access to more than the single user-written `question` argument (it must not — guard the isolation invariant in review), or once an expert can route through `proxy-service` (Phase 2), at which point the IP disclosure to the upstream is also removed.

## 2026-06-08 — ask_expert web access: expert-issued web_search / web_fetch (extends the egress above)

- **Affected paths:** `apps/user-client/**` (client-only; no Larissa scope path — auth/sync/proxy/crypto untouched).
- **Finding:** The expert uplink (above) can now optionally use `web_search` / `web_fetch` during its turn (`apps/user-client/src/tools/ask-expert.ts` bounded tool loop, round cap 8). This adds a **second outbound surface on top of the expert call itself**: the expert's web queries and fetched URLs leave the device, routed through the user's CORS proxy to the chosen web backend (default exa + neural when available). Analogous to the existing chat web-interfacing egress, but issued by the *expert* model rather than the companion.
- **Severity:** low (no plaintext keys/passphrases; the web-backend key reuses the MasterKey-gated `openSecret` path; opt-in and transparent — the ExpertPill surfaces every search query and fetched host live and in the expanded view; gated on a configured proxy, exactly like chat web).
- **Rationale / safe by construction:** The expert's structural isolation is **preserved** — its conversation is still seeded as exactly `[system(EXPERT_SYSTEM_PROMPT), user(question)]`, and the only additions are the expert's *own* `assistant(tool_calls)` + `tool(result)` messages (reformulated load-bearing test in `tests/unit/ask-expert.test.ts`). The expert can only compose web queries from the already-sanitised standalone question — no persona/history/about-me/memory ever enters the expert conversation, and the web tools' `WebContext` carries only `nsfwAllowed` (from the persona's `adultPersona`, same source as chat web), `location: null`, and the proxy coords. So the expert's web egress cannot leak more than the companion deliberately typed into the `question` field. The feature is **auto-on with exa + neural when resolvable** but degrades to single-shot (no web) when no backend resolves or the user sets it to Off (`settings.expertWeb`, Dexie v17).
- **Follow-up commitment:** None required for v0.1.0. Same re-evaluation triggers as the parent ask_expert entry; additionally, once an expert routes through `proxy-service` (Phase 2) the web egress IP disclosure to the search backend is also removed.

## 2026-06-08 — MCP client: external tool servers (new outbound egress + third-party tool execution)

Full audit: Larissa run on the MCP client feature branch before squash, spec `superpowers/specs/2026-06-08-mcp-client-design.md`. **Verdict: READY TO SQUASH — no Critical or High findings.** Credential sealing/opening, the approval-before-decrypt-before-egress ordering, hidden-tool unreachability, and routing/target provenance were all verified sound. The items below are the consciously-accepted residual surfaces.

- **Affected paths:** `apps/user-client/**` (client-only; no Larissa scope path — auth/sync/proxy/crypto untouched). New outbound network surface.
- **Finding:** The MCP client realises a **new outbound egress**: when a user configures an external HTTPS MCP server and a companion (or a persona/server combination that resolves the server active) calls one of its tools, a JSON-RPC `tools/call` carrying the **model-chosen arguments** is sent to that third-party server (directly, or through the user's own CORS proxy). The server is entirely user-controlled and not operated by us; its returned tool output re-enters the conversation.
- **Severity:** low for the credential/data-confidentiality surface; **medium** for the prompt-injection vector (M1 below), mitigated by the approval gate.
- **Rationale / safe by construction:**
  - **Credentials.** Per-server keys are sealed with the MasterKey under slot `mcp/<id>/api-key` (`sealSecret`/`openSecret`, AAD-bound so a ciphertext cannot be opened under another row) and opened **only at call time** (`getServerKey`→`openMcpKey`). The plaintext key is never persisted into the `McpServerRow` (the active descriptor strips it — only `{scheme}`/`{scheme,headerName}` survives, test-pinned), never logged (zero `console`/logger calls in any MCP path), and never placed in an error string, `lastError`, or the approval pill. The CORS-proxy shared key reuses the canonical `cors-proxy/shared-key` slot.
  - **Egress scope.** The only data leaving the device is the JSON-RPC handshake (`initialize`/`notifications/initialized`/`tools/list`) and the `tools/call` arguments the model chose — **no conversation history, persona, about-me, or memory** is in scope of an MCP tool's `execute`. The target is always the user-entered server URL (direct) or the user's proxy with `x-cors-proxy-target` = that server's origin — never a hardcoded third party, never a server-derived target.
  - **Consent gate.** A non-`autoRun` server requires explicit per-call user approval; the gate aborts **before** any key decrypt or network call on a deny (test-pinned: both `mcpToolsCall` and `getServerKey` asserted un-called). `autoRun` ("trusted — run without approval") is set only by explicit user action (the sheet toggle, default off; or the "Always allow" button). Hidden tools get no wire name and are unreachable via `dispatch`.
- **M1 (medium, accepted) — prompt injection via tool metadata.** A malicious/compromised MCP server controls each tool's `description` and `inputSchema`, which flow unmodified into the model's tool definitions. A hostile description could nudge the model to call a tool with arguments it extracts from the conversation context. This is **intrinsic to MCP**, not a code defect; the **only** defence is the user-controlled approval gate (which shows the server, tool, and exact arguments before anything is sent). Accepted as a documented, gate-mitigated trade-off. The "trusted/auto-run" copy makes the bypass explicit.
- **Proxy dependency (device-verification, not a code item).** For session-based servers routed via the proxy, the user's CORS proxy must (a) forward the `Mcp-Session-Id` request header and (b) expose the `mcp-session-id` response header (`Access-Control-Expose-Headers`). The reference proxy `cors-proxy.tidesson.net` also enforces a **target allowlist** — a proxy-routed server's host must be added to it. The connection test surfaces both gaps with distinct error messages. Stateless servers are unaffected.
- **Follow-up commitment:** None blocking for the local-only alpha. Re-evaluate (1) if an MCP tool's `execute` ever gains access to more than the model-chosen `args` (it must not — guard the isolation in review); (2) the M1 injection surface at each release cut as the MCP ecosystem matures (consider an argument-diff/secret-scan on the approval pill if abuse is seen); (3) once MCP can route through `proxy-service` (Phase 2), the IP disclosure to the upstream server is also removed.

## 2026-06-09 — TTI image generation: prompts to image providers (new outbound egress class)

- **Affected paths:** `apps/user-client/**`, `packages/llm-unified/src/tti/**` (client-only; no Larissa scope path — auth/sync/proxy/crypto untouched). New outbound network surface; final opus holistic review on the feature branch: READY TO SQUASH, no Critical/Important.
- **Finding:** The `generate_image` tool realises a **new outbound egress class**: when a companion calls it, the **LLM-authored image prompt** is POSTed to the user's configured image provider (`/images/generations` on xAI or nano-gpt — the same providers, keys, and transport/routing layer chat already uses), and for nano-gpt the returned R2 signed URLs are fetched from the browser. No conversation history, persona, about-me, or memory is in scope — only the prompt string the companion writes plus the user-configured model parameters.
- **Severity:** low. Same trust class as the existing chat egress to the same providers; the api-key reuses the MasterKey-gated `openSecret` path (slot `provider/<row.id>/api-key`), decrypted only at call time inside the per-send closure, never persisted or logged. The R2 fetch is deliberately **header-free** (a Bearer token would collide with the AWS-V4 signature), so no credential travels to the bucket; xAI returns bytes inline as `b64_json` (its image CDN is CORS-closed to browsers), so no third-party CDN fetch happens at all.
- **Routing note (supersedes spec §10's "fully direct" for xAI):** the implementation derives routing from the provider's `corsHint` like every other call — so xAI image POSTs travel through the user's own CORS proxy (which any xAI user already has, since Grok chat requires it), while nano-gpt runs direct. More uniform than the spec's probe-derived wording; nothing breaks.
- **Generated-content storage:** image bytes are stored locally only (Dexie `artefacts` blobs), inherit the persona-provenance NSFW gating in SFW mode, and cascade-delete with their chat.
- **Follow-up commitment:** none blocking for the local-only alpha. Re-evaluate when (1) the first `canDoNsfw` model is curated (the `nsfw` tool parameter then routes real explicit prompts to that provider — confirm its data-handling posture during curation); (2) proxy-service (Phase 2) lands — image POSTs and R2 fetches can then route through it, removing the IP disclosure to the providers/bucket.

## 2026-06-11 — Voice playback: persona message text to the TTS provider (new outbound egress class)

- **Affected paths:** `apps/user-client/**`, `packages/llm-unified/src/tts/**` (client-only; no Larissa scope path — auth/sync/proxy/crypto untouched). New outbound network surface; final opus holistic review on the feature branch: READY TO SQUASH after one fix round; Laura pre-squash pass clean.
- **Finding:** Read-aloud realises a **new outbound egress class**: when the user taps Read on a persona message, the **markdown-stripped spoken text of that message** is POSTed segment by segment to the configured TTS provider (`/audio/speech` on Mistral — the same provider, key, and transport/routing layer chat already uses; Mistral is CORS-open, so the calls run direct with no proxy involvement). Strictly user-initiated — nothing is synthesised without a tap. No conversation history beyond the one message, no persona instructions, no about-me, no memory are in scope; TEAL expression tags are stripped before egress for providers without expressive-markup support.
- **Severity:** low. Same trust class as the existing chat egress to the same provider; the api-key reuses the MasterKey-gated `openSecret` path (slot `provider/<row.id>/api-key`), decrypted once per playback resolution, never persisted or logged. Voice-list fetches (`/audio/voices`) carry no user content at all.
- **Generated-content storage:** synthesised audio blobs are cached locally only (Dexie `voiceAudio`, LRU byte-budget 64 MiB, keyed by hash of spoken text + provider + model + voice — no plaintext key material). Cache entries carry the spoken text only in hashed form; the blob itself is provider output.
- **Follow-up commitment:** none blocking for the local-only alpha. Re-evaluate when (1) the xAI TTS offering is curated (TEAL tags then travel verbatim — confirm the provider's data-handling posture during curation, as for chat); (2) proxy-service (Phase 2) lands — TTS POSTs can route through it, removing the IP disclosure to the provider; (3) dictation (Spec 2) lands — recorded microphone audio is a categorically more sensitive egress and gets its own entry.

## 2026-06-12 — Dictation/STT: recorded microphone audio to Mistral (new outbound egress class)

- **Affected paths:** `apps/user-client/**`, `packages/llm-unified/src/stt/**` (client-only; no Larissa scope path — auth/sync/proxy/crypto untouched). New outbound network surface; per-task adversarial reviews on the feature branch (no Larissa run — judgement call recorded here).
- **Finding:** Dictation realises the egress class the voice-playback entry anticipated: when the user holds or taps the mic, the **recorded microphone audio** of each utterance is POSTed as multipart to the configured STT provider (`/audio/transcriptions` on Mistral — CORS-probed direct 2026-06-12, same provider/key/transport layer chat already uses). Strictly user-initiated — capture starts only on an explicit button gesture and a running VAD session is visibly owned by the button (pulse + level glow). Raw voice is **categorically more sensitive** than any prior egress (biometric carrier, ambient room audio within an utterance window).
- **Severity:** low-medium. Same trust class as the existing Mistral egress (EU jurisdiction, no ZDR, no TEE — the published-terms trust basis from the Provider Curation Record); the api-key reuses the MasterKey-gated `openSecret` path, resolved once per hook lifetime, never persisted or logged. Provider-boundary failure logging carries **metadata only** (HTTP status, byte size, MIME — never audio, never transcript).
- **Safe by construction:** VAD (Silero) runs **entirely on-device** — utterance segmentation never sends audio anywhere; only completed utterances the user deliberately spoke into an active session are uploaded. **No audio persistence**: blobs live in machine context for at most one Retry cycle and die with the session; nothing touches Dexie, the artefact system, or any cache. Transcripts land in the user-editable draft by default (auto-send is opt-in with an eyes-open note).
- **Follow-up commitment:** none blocking for the local-only alpha. Re-evaluate when (1) the xAI STT offering is curated (confirm data-handling posture during curation — the NGO board decision keeps Mistral for STT, so this may not arise); (2) proxy-service (Phase 2) lands — STT POSTs can route through it, removing the IP disclosure; (3) any future feature wants to persist or replay dictation audio (it must get its own entry — the no-persistence posture is load-bearing here).

## 2026-06-12 — Dictation/STT: VAD engine assets from jsdelivr (code-only CDN egress)

- **Affected paths:** `apps/user-client/src/lib/voice/dictation/capture.ts` (client-only).
- **Finding:** First VAD use fetches the Silero model + AudioWorklet from `cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.30/dist/` and the ONNX-runtime WASM from `cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/` (~14 MB total, browser-cached afterwards). Discloses the user's IP + library versions to jsdelivr at first use — the same class as the existing embeddings ORT-CDN entry (2026-06-07). **No user data in either direction**: engine code/model only; all VAD inference is local. The 1.22.0 ORT pin is deliberately not the lockfile-resolved version — it is the known-good WASM set proven on device by the chatsune reference deployment (comment in `capture.ts`).
- **Severity:** low (one-time IP + version disclosure to a public CDN; principle weight per the Proton-grade stance, as with the embeddings entry).
- **Rationale for deferral:** chatsune's empirical finding stands (Vite blocks `.mjs` from `public/`, and vad-web's internal ORT instance cannot be configured from outside); self-hosting needs the same setup-time fetch + same-origin serving treatment as the embeddings ORT follow-up.
- **Follow-up commitment:** fold VAD asset self-hosting into the existing "self-host the ORT WASM before v0.3.0" follow-up ([[follow-ups-index]]) — one combined `/ort/`-style same-origin story for both engines.
