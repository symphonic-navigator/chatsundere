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

### L-5 — Old `local_amk` not explicitly zeroed after passphrase change

- **Affected paths:** `packages/crypto/src/flows/change-passphrase.ts`
- **Finding (Larissa's summary):** The Argon2id-derived old AMK lives on the heap until garbage collection. We zero the MK and recovery key in `MasterKeySession.close()` but don't apply the same discipline to in-flight AMKs.
- **Severity:** low (best-effort zeroing in JS is documented in spec §3.11 as a known limitation).
- **Rationale for deferral:** Applying the discipline consistently across every transient KDF output would clutter the code. Spec §3.11 explicitly documents the limitation.
- **Follow-up commitment:** None unless a memory-disclosure-class vulnerability emerges in practice.
