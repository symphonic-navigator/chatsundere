# UV-Relaxation Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relax WebAuthn UV policy in the user-client from `'required'` to `'preferred'` per ADR 0022 and the `passkey-uv-policy.md` brief, so that Bitwarden Desktop (unlocked vault), no-PIN hardware tokens, and similar credential-manager passkeys work on Chatsundere — matching the Gmail/Amazon/GitHub default.

**Architecture:** Frontend-only diff across three call sites in `apps/user-client`. PRF remains mandatory (ADR 0005 unchanged); only the UV axis moves to `'preferred'`. The `showBiometric` gate in the login screen is renamed and rewidened: `UVPAA`-only → "any WebAuthn-capable device". Copy on unlock CTAs shifts from "biometric" to "passkey" where the UV ceremony is no longer guaranteed to be biometric. Server-side already accepts UV-or-not (`@simplewebauthn/server` reports the flag without gating); a quick audit confirms no defensive `if (!verification.userVerified)` exists.

**Tech Stack:** React 18, TypeScript strict, WebAuthn JS API.

**Larissa gate:** Frontend-only diff that changes which inputs reach the crypto layer (per `obsidian/insights/2026-05-20-pattern-frontend-changes-affecting-crypto-semantics.md`). Liz opts in to a Larissa **courtesy pass** before squashing — short, focused, single-axis.

**Squash boundary:** one commit at the end. Per-task checkpoint commits during work, squashed via `git reset --soft master` + final `git commit`.

---

## File Map

- **Modify** `apps/user-client/src/lib/webauthn.ts:66` — change `authenticatorSelection.userVerification` to `'preferred'` in `registerLocalBiometric`.
- **Modify** `apps/user-client/src/routes/login/index.tsx` — three sub-changes:
  - Line 51 + 65 + 74: replace UVPAA-based `showBiometric` gate with WebAuthn-availability gate; rename variable to `passkeyUnlockAvailable`.
  - Line 146: change `userVerification: 'required'` to `'preferred'` in `handleBiometricUnlock`.
  - Line 217: update CTA copy to "passkey" (uses `copy.login.biometricCta`).
- **Modify** `apps/user-client/src/routes/linking/confirm.tsx:202` — change `userVerification: 'required'` to `'preferred'` in `handleBiometricSync`.
- **Modify** `apps/user-client/src/routes/settings/auth-methods.tsx:49` — keep `isWebAuthnAvailable()` but **extract** it to a shared module so login can reuse it (or import it via a re-export).
- **Create** `apps/user-client/src/lib/webauthn-availability.ts` — new file housing the extracted `isWebAuthnAvailable()` helper, reused by both `auth-methods.tsx` and `login/index.tsx`.
- **Modify** `apps/user-client/src/lib/copy.ts` — narrow set of copy changes (unlock CTAs only, not Settings → "Add biometric"; details in Task 4).
- **No change** `apps/auth-service/src/webauthn/server.ts` — already at `'preferred'` (verified). Add a one-line comment referencing ADR 0022 so reviewers see the policy is intentional.

---

## Task 1: Extract `isWebAuthnAvailable()` into a shared module

**Files:**
- Create: `apps/user-client/src/lib/webauthn-availability.ts`
- Modify: `apps/user-client/src/routes/settings/auth-methods.tsx:49` (replace local definition with import)

Currently `isWebAuthnAvailable()` lives privately in `auth-methods.tsx`. The login screen needs to call the same helper (per the brief's "showBiometric is renamed and rewidened" decision). Extract it once.

- [ ] **Step 1: Read the current helper**

Read `apps/user-client/src/routes/settings/auth-methods.tsx` around line 49 to capture the exact implementation. Likely shape:

```ts
function isWebAuthnAvailable(): boolean {
  return typeof window !== 'undefined' && 'PublicKeyCredential' in window;
}
```

(If the actual implementation is different, transcribe it verbatim.)

- [ ] **Step 2: Create the new shared file**

```ts
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Whether WebAuthn is available on this device. Returns true whenever
 * `window.PublicKeyCredential` exists, regardless of whether the device has
 * a user-verifying platform authenticator (Touch ID / Face ID / Windows
 * Hello). Under the UV='preferred' policy (ADR 0022) we accept cross-platform
 * passkeys too — Bitwarden Desktop, Yubikeys, browser-profile passkeys — so
 * UVPAA is no longer the right gate.
 *
 * For "this device has a platform authenticator specifically", use
 * `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()`
 * directly.
 */
export function isWebAuthnAvailable(): boolean {
  return typeof window !== 'undefined' && 'PublicKeyCredential' in window;
}
```

- [ ] **Step 3: Replace the local definition in `auth-methods.tsx`**

In `apps/user-client/src/routes/settings/auth-methods.tsx`:

- Delete the local `function isWebAuthnAvailable()` definition near line 49.
- Add to the imports at the top of the file:
  ```ts
  import { isWebAuthnAvailable } from '../../lib/webauthn-availability.js';
  ```

- [ ] **Step 4: Type-check passes**

Run: `pnpm --filter @chatsundere/user-client build`
Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/webauthn-availability.ts apps/user-client/src/routes/settings/auth-methods.tsx
git commit -m "Extract isWebAuthnAvailable into shared user-client lib module"
```

---

## Task 2: Relax UV in `registerLocalBiometric` (`lib/webauthn.ts`)

**Files:**
- Modify: `apps/user-client/src/lib/webauthn.ts:65-67`

- [ ] **Step 1: Change the UV setting**

Apply this edit in `apps/user-client/src/lib/webauthn.ts`:

```ts
// OLD (lines 65-68):
      authenticatorSelection: {
        userVerification: 'required',
        residentKey: 'preferred',
      },

// NEW:
      authenticatorSelection: {
        // ADR 0022: UV='preferred' across all WebAuthn ceremonies. PRF (ADR
        // 0005) remains mandatory and is enforced below — UV is the
        // per-operation auth strength only.
        userVerification: 'preferred',
        residentKey: 'preferred',
      },
```

- [ ] **Step 2: Type-check passes**

Run: `pnpm --filter @chatsundere/user-client build`
Expected: exit code 0.

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/lib/webauthn.ts
git commit -m "Relax UV to 'preferred' in registerLocalBiometric per ADR 0022"
```

---

## Task 3: Rewiden the `showBiometric` gate in `login/index.tsx`

**Files:**
- Modify: `apps/user-client/src/routes/login/index.tsx:13,35,47-65,74,144-146,209,217`

Two semantic changes in one task because they couple tightly:

1. **Gate rewidening:** drop `uvpaaAvailable` from the gate; accept any WebAuthn-capable device. Rename `showBiometric` → `passkeyUnlockAvailable`.
2. **UV relaxation** on the `navigator.credentials.get()` call inside `handleBiometricUnlock`.

- [ ] **Step 1: Add the new import**

In `apps/user-client/src/routes/login/index.tsx`, near the existing imports (around line 13-19), add:

```ts
import { isWebAuthnAvailable } from '../../lib/webauthn-availability.js';
```

- [ ] **Step 2: Replace the UVPAA-based gate**

Find the `useState` for `uvpaaAvailable` (line 35) and the `Promise.all` that calls `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()` (around line 47-52). Restructure as:

```ts
// OLD:
const [uvpaaAvailable, setUvpaaAvailable] = useState(false);

// … inside useEffect …
const [local, linked, creds, uvpaa] = await Promise.all([
  getLocalAccount(db),
  getLinkedAccount(db),
  listLocalBiometric(db),
  PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(),
]);

// … later …
setUvpaaAvailable(uvpaa);

// … render gate (line 74) …
const showBiometric = passkeys.length > 0 && uvpaaAvailable;
```

```ts
// NEW:
const [webAuthnAvailable] = useState(() => isWebAuthnAvailable());

// … inside useEffect — drop the UVPAA call entirely …
const [local, linked, creds] = await Promise.all([
  getLocalAccount(db),
  getLinkedAccount(db),
  listLocalBiometric(db),
]);

// … later — drop the setUvpaaAvailable call …

// … render gate (was line 74) …
// ADR 0022: under UV='preferred' we accept cross-platform passkeys too,
// not just UVPAA platform authenticators. The gate is "any WebAuthn-capable
// device with at least one registered passkey".
const passkeyUnlockAvailable = passkeys.length > 0 && webAuthnAvailable;
```

- [ ] **Step 3: Rename `showBiometric` → `passkeyUnlockAvailable` in the JSX**

Find the `{showBiometric && (...)` block (around line 209) and rename to `{passkeyUnlockAvailable && (...)`. There should be exactly one occurrence in JSX.

- [ ] **Step 4: Relax UV in `handleBiometricUnlock`**

Find the `userVerification: 'required'` line in the `navigator.credentials.get()` call (around line 146). Change to:

```ts
// OLD:
          userVerification: 'required',

// NEW:
          // ADR 0022: 'preferred' lets cross-platform passkeys (Bitwarden,
          // Yubikey-without-PIN) unlock without being refused. PRF (ADR 0005)
          // still gates acceptance below.
          userVerification: 'preferred',
```

- [ ] **Step 5: Update the unlock-button copy reference (no string change yet — see Task 5)**

Leave the CTA reference (`{copy.login.biometricCta}` at line 217) as-is in this task. The string itself changes in Task 5. If you want to rename the property too (so the JSX reads `{copy.login.passkeyUnlockCta}`), that is fine — but treat it as a Task 5 concern to keep this task focused on behaviour.

- [ ] **Step 6: Type-check passes**

Run: `pnpm --filter @chatsundere/user-client build`
Expected: exit code 0.

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/routes/login/index.tsx
git commit -m "Rewiden login passkey gate and relax UV to 'preferred' per ADR 0022"
```

---

## Task 4: Relax UV in `linking/confirm.tsx` (server-bound passkey registration)

**Files:**
- Modify: `apps/user-client/src/routes/linking/confirm.tsx:201-204`

- [ ] **Step 1: Change the UV setting**

In `apps/user-client/src/routes/linking/confirm.tsx`, find the `authenticatorSelection` block inside `handleBiometricSync` (around line 201-204):

```ts
// OLD:
          authenticatorSelection: {
            userVerification: 'required',
            residentKey: 'preferred',
          },

// NEW:
          authenticatorSelection: {
            // ADR 0022: blanket UV='preferred'. PRF (ADR 0005) remains
            // mandatory and is enforced via the prfFirst check below.
            userVerification: 'preferred',
            residentKey: 'preferred',
          },
```

- [ ] **Step 2: Type-check passes**

Run: `pnpm --filter @chatsundere/user-client build`
Expected: exit code 0.

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/routes/linking/confirm.tsx
git commit -m "Relax UV to 'preferred' in server-bound passkey registration per ADR 0022"
```

---

## Task 5: Update user-facing copy on unlock surfaces

**Files:**
- Modify: `apps/user-client/src/lib/copy.ts`

The brief: change copy where UV is no longer guaranteed to be biometric. That is the *unlock* surface — "Unlock with biometric" is a misleading label now that an unlocked Bitwarden vault may complete the ceremony with no biometric step. Add-a-biometric setup copy in Settings stays "biometric" because that flow is explicitly about setting up the device's local biometric.

Concrete: the brief picks "Sign in with passkey" / "Unlock with passkey" as the new wording.

- [ ] **Step 1: Identify exact copy strings to update**

Run:

```bash
rg -n "biometric|Biometric" apps/user-client/src/lib/copy.ts
```

Strings to **change** (unlock surface):

- `login.biometricCta` — "Unlock with biometric" → "Sign in with passkey"
- `login.errors.biometricFailed` — "Biometric unlock failed. Try your passphrase." → "Could not verify with passkey. Try your passphrase."

Strings to **keep** (setup / device-local biometric surface):

- `settings.authMethods.biometricSectionLabel` → keep "Biometric on this device" (the section is specifically about the device's local biometric setup).
- `settings.authMethods.addBiometricCta` and friends → keep (this flow uses `registerLocalBiometric` which is about device biometric setup).
- `settings.serverLinking.syncBiometricBanner` and `biometricSync*` → keep (these are about mirroring the *local biometric* to the server, terminology is correct).
- `settings.account.*` references to biometric in destructive-action warnings → keep (they describe what the user will lose, which is their device-local biometric setups).

- [ ] **Step 2: Apply the two copy edits**

In `apps/user-client/src/lib/copy.ts`:

```ts
// OLD:
    biometricCta: 'Unlock with biometric',

// NEW:
    biometricCta: 'Sign in with passkey',
```

```ts
// OLD:
      biometricFailed: 'Biometric unlock failed. Try your passphrase.',

// NEW:
      biometricFailed: 'Could not verify with passkey. Try your passphrase.',
```

Optionally rename the property keys themselves (`biometricCta` → `passkeyUnlockCta`, `biometricFailed` → `passkeyUnlockFailed`). If renaming, update every reader (only the two sites in `login/index.tsx`). The brief does not mandate the property-name rename, but it improves grep-ability. Recommendation: rename. Cheap.

If renaming, also update:
- `apps/user-client/src/routes/login/index.tsx:216` — `{copy.login.biometricCta}` → `{copy.login.passkeyUnlockCta}`.
- `apps/user-client/src/routes/login/index.tsx:188` — `{copy.login.errors.biometricFailed}` → `{copy.login.errors.passkeyUnlockFailed}` (verify the exact reader line by grep).

- [ ] **Step 3: Type-check passes**

Run: `pnpm --filter @chatsundere/user-client build`
Expected: exit code 0.

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/lib/copy.ts apps/user-client/src/routes/login/index.tsx
git commit -m "Rename unlock copy: 'biometric' → 'passkey' on unlock surfaces"
```

---

## Task 6: Final repo scan for any remaining UV='required'

**Files:**
- Audit: every `userVerification` occurrence in `apps/`.

- [ ] **Step 1: Search the whole repo**

```bash
rg -n "userVerification" apps/ packages/
```

Expected after Tasks 2-4:

```
apps/user-client/src/lib/webauthn.ts:67:        userVerification: 'preferred',
apps/user-client/src/routes/login/index.tsx:146:          userVerification: 'preferred',
apps/user-client/src/routes/linking/confirm.tsx:202:            userVerification: 'preferred',
apps/auth-service/src/webauthn/server.ts:38:      userVerification: 'preferred',
apps/auth-service/src/webauthn/server.ts:59:    userVerification: 'preferred',
```

(Line numbers may shift after edits — values are what matters.)

If any `'required'` remains in `apps/user-client/`, change it to `'preferred'` with the same code comment referencing ADR 0022.

- [ ] **Step 2: Verify there are no `'discouraged'` settings either**

```bash
rg -n "userVerification.*discouraged" apps/ packages/
```

Expected: no hits.

- [ ] **Step 3: If any UV='required' remains, fix and commit**

If a fix was needed:

```bash
git add <file>
git commit -m "Catch trailing UV='required' site missed in main relaxation"
```

If no fix was needed, no commit. This task is verification only.

---

## Task 7: Server-side audit — no defensive `userVerified` check

**Files:**
- Audit: `apps/auth-service/src/webauthn/server.ts` and `apps/auth-service/src/routes/**`

The brief notes that `@simplewebauthn/server` reports the UV flag in the verified result but does not gate on it. We need to make sure no defensive `if (!verification.userVerified) reject(...)` exists anywhere in the auth-service.

- [ ] **Step 1: Search for `userVerified` reads in the auth-service**

```bash
rg -n "userVerified" apps/auth-service/src/
```

For each hit, evaluate:
- Is it a *log* / *audit-record* write? → Fine. Leave it. The brief explicitly allows informational use.
- Is it a *gate* (e.g. `if (!verification.userVerified) return Response.json({error: ...}, 403)`)? → Remove the gate. Add a comment referencing ADR 0022.

- [ ] **Step 2: Add a comment to `webauthn/server.ts` documenting the policy**

In `apps/auth-service/src/webauthn/server.ts`, near each of the two `userVerification: 'preferred'` lines, add (if not already present):

```ts
// ADR 0022: 'preferred' to match the user-client policy. Cross-platform
// passkeys (Bitwarden Desktop, Yubikey-no-PIN) are accepted; the
// authenticator's intrinsic behaviour decides whether UV actually happens.
```

- [ ] **Step 3: If any gate was removed, commit**

```bash
git add apps/auth-service/src/
git commit -m "Document server-side UV='preferred' policy per ADR 0022"
```

Otherwise, no commit (verification only).

---

## Task 8: Run the test suites

**Files:**
- All test files in `apps/user-client` and `apps/auth-service`.

- [ ] **Step 1: User-client tests**

```bash
cd apps/user-client
pnpm test
```

Expected: all green. If any test asserts `userVerification: 'required'` in a fixture or mock, update the fixture to `'preferred'`. If a test asserts `uvpaaAvailable` gating behaviour, update it to assert `webAuthnAvailable` gating behaviour. Commit any test updates with:

```bash
git add apps/user-client/src
git commit -m "Update tests for relaxed UV policy"
```

- [ ] **Step 2: Auth-service tests (if Task 7 changed anything)**

```bash
cd apps/auth-service
TEST_DATABASE_URL=postgres://chatsundere:dev@localhost:5432/auth_db_test \
  REDIS_URL=redis://localhost:6379/0 \
  bun test
```

Expected: all green. (Phase 0 auth-service should not assert UV; if it does, update consistently.)

- [ ] **Step 3: Full repo build**

```bash
cd /home/chris/workspace/chatsundere
pnpm run build
```

Expected: exit code 0.

---

## Task 9: Manual verification matrix

Chris runs through the device matrix from `passkey-uv-policy.md` §Manual verification:

- [ ] **Step 1: Touch ID Mac**

Device: a Mac with Touch ID and a previously-registered passkey.
Action: log in via the passkey unlock button.
Expected: UV happens (Touch ID prompts), unlock succeeds, app opens.

- [ ] **Step 2: Windows Hello PC**

Device: a Windows PC with Hello and a previously-registered passkey.
Action: log in via the passkey unlock button.
Expected: UV happens (Hello prompts), unlock succeeds.

- [ ] **Step 3: Bitwarden Desktop, vault unlocked**

Device: Linux, Bitwarden Desktop, vault unlocked, a passkey registered through Bitwarden.
Action: log in via the passkey unlock button.
Expected: **succeeds** (was previously refused under UV='required'). No vault-master-password re-prompt.

- [ ] **Step 4: Yubikey 5C NFC without PIN**

Device: any platform, Yubikey 5C NFC with no PIN configured, a passkey registered.
Action: log in via the passkey unlock button.
Expected: **succeeds** (was previously refused). Touch is the only ceremony interaction.

- [ ] **Step 5: Yubikey 5C NFC with PIN configured**

Device: as above, with PIN set.
Action: log in via the passkey unlock button.
Expected: UV happens via PIN prompt, unlock succeeds.

- [ ] **Step 6: PRF-less authenticator regression check**

If Chris has a non-PRF authenticator to hand (e.g. an old FIDO-only Yubikey, or simulated via a browser DevTools setting):
Action: try to register the authenticator as a new biometric in Settings → Auth methods.
Expected: registration is **still refused** with the PRF-required error message. This is the ADR 0005 guarantee. **MUST NOT REGRESS.**

If Chris has no PRF-less device, document the case as untestable manually and note it in the manual-verification matrix for the eventual e2e suite.

- [ ] **Step 7: Document the outcome**

Update `obsidian/insights/follow-ups-index.md` and `obsidian/STATUS.md` only after Larissa (Task 10) is also clean.

---

## Task 10: Larissa courtesy pass

Per CLAUDE.md §9 + `obsidian/insights/2026-05-20-pattern-frontend-changes-affecting-crypto-semantics.md`, frontend changes that affect crypto-acceptance surface get a Larissa courtesy pass even when frontend-only.

- [ ] **Step 1: Summon Larissa with focused scope**

Use the Agent tool (`subagent_type: general-purpose`) with a prompt of the form:

```
You are Larissa, an Opus-class security auditor for Chatsundere. Audit the
UV-relaxation diff on this branch (since master). The scope is the UV axis
only — PRF (ADR 0005) remains mandatory, and the change is supposed to be
strictly on the per-operation authentication-strength axis.

Files in scope:
- apps/user-client/src/lib/webauthn.ts (registerLocalBiometric)
- apps/user-client/src/lib/webauthn-availability.ts (new helper)
- apps/user-client/src/routes/login/index.tsx (unlock + gate rewidening)
- apps/user-client/src/routes/linking/confirm.tsx (server-bound passkey reg)
- apps/user-client/src/routes/settings/auth-methods.tsx (helper extraction)
- apps/user-client/src/lib/copy.ts (copy update)
- apps/auth-service/src/webauthn/server.ts (already 'preferred'; comment added)

Concerns to evaluate:
1. PRF axis: is PRF still enforced on every relevant code path? Verify by tracing the prfFirst check in each ceremony.
2. UV axis: does the relaxation change any other security boundary? Anything beyond "the authenticator decides whether UV actually happens"?
3. Server-side: any latent defensive `if (!verification.userVerified)` check that would defeat the client-side relaxation?
4. Copy: does any retained "biometric" copy now misrepresent what is happening (i.e. would the user reasonably expect biometric when the ceremony actually was vault-unlock-only)?
5. ADR consistency: does the diff implement what ADR 0022 specifies, or does it overshoot?

Reference: obsidian/decisions/0022-uv-policy-for-webauthn-passkeys.md
Reference: obsidian/briefs/phase 0/passkey-uv-policy.md
Reference: obsidian/insights/2026-05-20-pattern-frontend-changes-affecting-crypto-semantics.md

Report findings with severity (Critical / High / Medium / Low) and concrete
file:line references. Be terse.
```

- [ ] **Step 2: Address Critical / High findings**

Per CLAUDE.md §9, not deferrable without Chris sign-off.

- [ ] **Step 3: Document any Medium / Low deferrals**

Move into `obsidian/insights/security-deferrals.md` with a follow-up trigger; mirror in `follow-ups-index.md`.

---

## Task 11: Squash and final commit

- [ ] **Step 1: Inspect the working tree**

```bash
git status
git log --oneline master..HEAD
```

Expected: per-task checkpoint commits since master.

- [ ] **Step 2: Soft-reset to master**

```bash
git reset --soft master
git status
```

Expected: every change staged, working directory unchanged.

- [ ] **Step 3: Create the final squash commit**

```bash
git commit -m "$(cat <<'EOF'
Relax WebAuthn UV policy to 'preferred' per ADR 0022

Changes UV from 'required' to 'preferred' across every WebAuthn ceremony
in apps/user-client (registerLocalBiometric, login unlock, server-bound
passkey registration during linking). PRF (ADR 0005) remains mandatory
and is unchanged.

User-visible effect: Bitwarden Desktop with unlocked vault, Yubikeys
without PIN, and similar cross-platform passkeys now unlock Chatsundere
instead of being refused. Matches Gmail / GitHub / Microsoft consumer
default.

Login gate rewidened: showBiometric (UVPAA-only) → passkeyUnlockAvailable
(any WebAuthn-capable device with at least one passkey). Unlock CTA copy
shifts from "Unlock with biometric" to "Sign in with passkey" where the
ceremony is no longer guaranteed to be biometric. Settings → "Add
biometric" copy retained (that flow IS specifically biometric setup).

Server-side already at 'preferred' (auth-service/src/webauthn/server.ts);
added a comment referencing ADR 0022 for reviewer context.

Larissa courtesy-pass clean. See obsidian/briefs/phase 0/passkey-uv-policy.md
and obsidian/decisions/0022-uv-policy-for-webauthn-passkeys.md for full
context.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify**

```bash
git log --oneline -3
git status
```

Expected: one new commit, clean working tree.

- [ ] **Step 5: Update STATUS.md and follow-ups-index**

- In `obsidian/insights/follow-ups-index.md`: move "Wire UV-relaxation in code (3 sites)" row from "Active — Implementation" to "Resolved".
- In `obsidian/STATUS.md`: move "UV-relaxation wiring in user-client" from "Briefed, awaiting implementation" to "Done". Refresh "Last updated:" and "Next session".

- [ ] **Step 6: Commit the documentation update**

```bash
git add obsidian/STATUS.md obsidian/insights/follow-ups-index.md
git commit -m "Update STATUS and follow-ups-index after UV-relaxation squash [skip ci]"
```
