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
