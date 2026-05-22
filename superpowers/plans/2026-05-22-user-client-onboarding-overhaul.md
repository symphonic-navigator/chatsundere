# User-client onboarding overhaul implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the user-client onboarding entry with a four-path intent-based matrix (Invitation / Pairing / Recovery / Local-only), repoint all client-side wiring to the cross-device-identity `/api/v1/join/{start,finish}` endpoints, and migrate the pending-code alphabet to a Crockford-derived form with a deliberate V↔U swap. Unblocks the first end-to-end user-client + auth-service test by replacing the now-broken `linkOpaque*` wiring.

**Architecture:** New routes under `/onboarding/*` for each path, sharing form sub-screens (Variant C: URL+code form first, scan button as visually separated alternative). State for the join flows lives in a single `useOnboardingStore` (discriminated union). Three new crypto flows (`joinByInvitation`, `joinByPairing`, `recoverFromScratch`) are added; the existing `linkToServer` is migrated to the new endpoints for the late-link case. Code alphabet on both server and client moves from RFC-4648-§6-minus-confusables to Crockford-derived with a V↔U swap; client normalises I/L→1, O→0, V→Y on input.

**Tech Stack:** TypeScript (strict), React 18, React Router v6, Zustand, Tailwind v4, Vite, Vitest (frontend tests), Bun's built-in test runner (auth-service tests), Hono (auth-service), `@simplewebauthn/server`, `@serenity-kit/opaque`, `qr-scanner`.

**Spec:** [`superpowers/specs/2026-05-22-user-client-onboarding-overhaul-design.md`](../specs/2026-05-22-user-client-onboarding-overhaul-design.md)

**Commit strategy:** Every task ends with a working `git add` + `git commit` so progress is captured and a failed task is easy to back out. The whole feature ships as one squash at the end (per CLAUDE.md §8); intermediate commits get squashed away.

**Larissa gate:** Tasks 1, 4, 5, 6, 7 touch `apps/auth-service` and `packages/crypto`. Larissa audit (Task 25) happens after all tasks land but before the final squash.

---

## Task 1: Auth-service alphabet swap (Crockford-derived with V↔U)

**Files:**
- Modify: `apps/auth-service/src/codes/token.ts:8-12`
- Modify: `apps/auth-service/tests/unit/codes-token.test.ts:6-8,59-64,75-79`

- [ ] **Step 1: Update the failing tests first**

Replace the existing alphabet constants and "rejects ambiguous chars" cases in `apps/auth-service/tests/unit/codes-token.test.ts`. New file content for the relevant blocks:

```typescript
// Lines 6-8 — replace with:
// Crockford Base32 with V↔U swap (see spec § 2 Decision 8).
const VALID_CHAR = /^[0-9ABCDEFGHJKMNPQRSTUWXYZ]$/;
const CODE_FORMAT = /^[0-9ABCDEFGHJKMNPQRSTUWXYZ]{5}-[0-9ABCDEFGHJKMNPQRSTUWXYZ]{5}$/;
```

```typescript
// "rejects codes containing ambiguous characters" block — replace the four asserts with:
it('rejects codes containing out-of-alphabet characters', () => {
  expect(isValidCodeFormat('AB7K3-MNIPX')).toBe(false); // I excluded
  expect(isValidCodeFormat('AB7K3-MNLPX')).toBe(false); // L excluded
  expect(isValidCodeFormat('AB7K3-MNOPX')).toBe(false); // O excluded
  expect(isValidCodeFormat('AB7K3-MNVPX')).toBe(false); // V excluded (V↔U swap)
});
```

The "accepts properly-formatted codes" block also needs example codes that contain `U` to prove the swap. Replace its block with:

```typescript
it('accepts properly-formatted codes', () => {
  expect(isValidCodeFormat('AB7K3-MN9PX')).toBe(true);
  expect(isValidCodeFormat('22222-33333')).toBe(true);
  expect(isValidCodeFormat('ZZZZZ-YYYYY')).toBe(true);
  expect(isValidCodeFormat('AB7K3-MNUPX')).toBe(true); // U is in alphabet
  expect(isValidCodeFormat('00000-00000')).toBe(true); // digits 0 and 1 now valid
  expect(isValidCodeFormat('11111-11111')).toBe(true);
});
```

- [ ] **Step 2: Run the tests to confirm they fail against current alphabet**

Run: `cd apps/auth-service && bun test tests/unit/codes-token.test.ts`
Expected: multiple FAILs around alphabet checks.

- [ ] **Step 3: Update `src/codes/token.ts`**

Replace lines 5-12 with:

```typescript
// Crockford-derived Base32 alphabet with deliberate V↔U swap (see
// superpowers/specs/2026-05-22-user-client-onboarding-overhaul-design.md § 2
// Decision 8). Canonical Crockford excludes I, L, O, U; we keep U and exclude
// V instead. V↔Y carries a real (if minor) visual confusability on small
// monospace displays; U being in the alphabet is also a deliberate decision
// aligned with Chatsundere's anti-censorship positioning (Crockford excluded U
// to avoid the four-letter word; we accept that words can occur). Entropy is
// unchanged at 32 chars × 5 bits = 50 bits per 10-char code.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTUWXYZ';
const CODE_RE = /^[0-9ABCDEFGHJKMNPQRSTUWXYZ]{5}-[0-9ABCDEFGHJKMNPQRSTUWXYZ]{5}$/;
```

- [ ] **Step 4: Re-run the tests, expect PASS**

Run: `cd apps/auth-service && bun test tests/unit/codes-token.test.ts`
Expected: all green.

- [ ] **Step 5: Run the full auth-service test suite**

Run: `cd apps/auth-service && bun test`
Expected: 136 tests pass / 9 baseline failures (per STATUS.md `7a01697`). No new failures.

- [ ] **Step 6: Commit**

```bash
git add apps/auth-service/src/codes/token.ts apps/auth-service/tests/unit/codes-token.test.ts
git commit -m "Migrate pending-code alphabet to Crockford-derived with V↔U swap"
```

---

## Task 2: shared-types — Join request/response shapes + JoinError enum

**Files:**
- Create: `packages/shared-types/src/join.ts`
- Modify: `packages/shared-types/src/index.ts` (add exports)
- Modify: `packages/shared-types/src/linking.ts` (delete `LinkOpaqueStartRequest`, `LinkOpaqueStartResponse`, `LinkOpaqueFinishRequest`, `LinkOpaqueFinishResponse` — `LinkPasskey*` types stay)

- [ ] **Step 1: Create `packages/shared-types/src/join.ts`** with the shapes from spec § 4.7 + § 4.8:

```typescript
// SPDX-License-Identifier: MIT

/** Request body for `POST /api/v1/join/start`. Discriminated by `kind`. */
export type JoinStartRequest =
  | { kind: 'invitation'; code: string; registration_request: string }
  | { kind: 'pairing'; code: string; login_request: string };

/** Response body for `POST /api/v1/join/start`. Discriminated by request kind. */
export type JoinStartResponse =
  | {
      kind: 'invitation';
      session_id: string;
      registration_response: string;
      suggested_username: string | null;
    }
  | {
      kind: 'pairing';
      session_id: string;
      login_response: string;
      username: string;
    };

/** Request body for `POST /api/v1/join/finish`. Discriminated by `kind`. */
export type JoinFinishRequest =
  | {
      kind: 'invitation';
      session_id: string;
      username: string;
      registration_record: string;
      wrapped_mk_opaque: string;
      wrap_nonce_opaque: string;
      wrap_aad_opaque: string;
      wrapped_mk_recovery: string;
      wrap_nonce_recovery: string;
      wrap_aad_recovery: string;
      recovery_verifier_key: string;
    }
  | {
      kind: 'pairing';
      session_id: string;
      login_evidence: string;
    };

/** Response body for `POST /api/v1/join/finish`. Discriminated by request kind. */
export type JoinFinishResponse =
  | {
      kind: 'invitation';
      user_id: string;
      username: string;
      role: 'primary_admin' | 'admin' | 'user';
      access_token: string;
      expires_in: number;
      is_new_account: true;
    }
  | {
      kind: 'pairing';
      user_id: string;
      username: string;
      role: 'primary_admin' | 'admin' | 'user';
      access_token: string;
      expires_in: number;
      is_new_account: false;
      wrapped_mk_opaque: string;
      wrap_nonce_opaque: string;
      wrap_aad_opaque: string;
    };

/** Error codes the join surface can emit. Used for narrow client-side handling. */
export const JoinError = {
  InvalidCodeFormat: 'invalid_code_format',
  KindMismatch: 'kind_mismatch',
  CodeNotFoundOrExpired: 'code_not_found_or_expired',
  UsernameTaken: 'username_taken',
  OpaqueEvidenceInvalid: 'opaque_evidence_invalid',
  RateLimitExceeded: 'rate_limit_exceeded',
  SessionExpired: 'session_expired',
  WrappingInvariantViolated: 'wrapping_invariant_violated',
} as const;

export type JoinErrorCode = (typeof JoinError)[keyof typeof JoinError];
```

- [ ] **Step 2: Update `packages/shared-types/src/index.ts`** — add `export * from './join.js';` alongside existing exports.

- [ ] **Step 3: Remove the four `LinkOpaque*` types from `packages/shared-types/src/linking.ts`** — keep only the `LinkPasskey*` types and the re-exports at the bottom. Resulting file starts:

```typescript
// SPDX-License-Identifier: MIT

import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/types';

import type { ServerAuthMethodType } from './auth.js';

/** Request body for `POST /api/v1/link/passkey/start`. */
export interface LinkPasskeyStartRequest {
  invitation_token?: string;
}
// … rest of file unchanged from line 47 onwards
```

Also update the JSDoc paths for `LinkPasskey*` from `/v1/link/passkey/...` to `/api/v1/link/passkey/...` (already migrated in Squash β).

- [ ] **Step 4: Typecheck the shared-types package**

Run: `pnpm --filter @chatsundere/shared-types run build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-types/src/
git commit -m "Add Join request/response types + JoinError enum; drop LinkOpaque types"
```

---

## Task 3: packages/crypto — ServerClient interface update

**Files:**
- Modify: `packages/crypto/src/server-client.ts` (or wherever `ServerClient` is defined — check `packages/crypto/src/index.ts:1` first to confirm)

- [ ] **Step 1: Locate the `ServerClient` interface**

Run: `rg 'interface ServerClient|type ServerClient' packages/crypto/src/`
Expected: one file path.

- [ ] **Step 2: Replace `linkOpaqueStart` / `linkOpaqueFinish` with `joinStart` / `joinFinish`** in the interface:

```typescript
import type {
  JoinStartRequest,
  JoinStartResponse,
  JoinFinishRequest,
  JoinFinishResponse,
} from '@chatsundere/shared-types';

export interface ServerClient {
  // Delete:
  // linkOpaqueStart: (req, baseUrl) => Promise<...>;
  // linkOpaqueFinish: (req, baseUrl) => Promise<...>;

  // Add:
  joinStart: (req: JoinStartRequest, baseUrl: string) => Promise<JoinStartResponse>;
  joinFinish: (req: JoinFinishRequest, baseUrl: string) => Promise<JoinFinishResponse>;

  // … rest of interface unchanged
}
```

- [ ] **Step 3: Typecheck the crypto package**

Run: `pnpm --filter @chatsundere/crypto run build`
Expected: errors in `flows/link-to-server.ts` (still uses old methods). That's fine; we fix it in Task 7.

- [ ] **Step 4: Commit** — partial-broken build is acceptable for an intermediate commit since the squash flattens this away:

```bash
git add packages/crypto/src/
git commit -m "ServerClient interface: replace linkOpaque* with joinStart/joinFinish"
```

---

## Task 4: packages/crypto — `joinByInvitation` flow (fresh-MK case)

**Files:**
- Create: `packages/crypto/src/flows/join-by-invitation.ts`
- Modify: `packages/crypto/src/index.ts` (add export)
- Create: `packages/crypto/tests/join-by-invitation.test.ts`

- [ ] **Step 1: Sketch the flow API by writing the test first**

```typescript
// packages/crypto/tests/join-by-invitation.test.ts
import { describe, expect, it, mock } from 'bun:test';
import { startJoinByInvitation, finishJoinByInvitation } from '../src/flows/join-by-invitation.js';
import type { ServerClient } from '../src/server-client.js';

describe('joinByInvitation — start', () => {
  it('returns the suggested_username and session_id for the confirm screen', async () => {
    const mockClient: Pick<ServerClient, 'joinStart'> = {
      joinStart: mock(async () => ({
        kind: 'invitation',
        session_id: 'sess-1',
        registration_response: 'b64-resp',
        suggested_username: 'chris.tidesson',
      })),
    };
    const result = await startJoinByInvitation({
      serverClient: mockClient as ServerClient,
      baseUrl: 'http://localhost:3100',
      code: 'AB7K3-MN9PX',
      passphrase: 'correct horse battery staple',
    });
    expect(result.sessionId).toBe('sess-1');
    expect(result.suggestedUsername).toBe('chris.tidesson');
    expect(result.registrationState).toBeDefined();
  });
});
```

For `finishJoinByInvitation`, the test stub asserts the request shape carries username + wrapping material:

```typescript
describe('joinByInvitation — finish', () => {
  it('generates fresh MK + recovery key, wraps both, calls joinFinish', async () => {
    const finishMock = mock(async (req: JoinFinishRequest) => {
      expect(req.kind).toBe('invitation');
      // Narrow then assert:
      if (req.kind !== 'invitation') throw new Error();
      expect(req.username).toBe('chris');
      expect(req.wrapped_mk_opaque.length).toBeGreaterThan(0);
      expect(req.wrapped_mk_recovery.length).toBeGreaterThan(0);
      expect(req.recovery_verifier_key.length).toBeGreaterThan(0);
      return {
        kind: 'invitation' as const,
        user_id: 'u1',
        username: 'chris',
        role: 'user' as const,
        access_token: 'jwt',
        expires_in: 900,
        is_new_account: true as const,
      };
    });
    const result = await finishJoinByInvitation({
      serverClient: { joinFinish: finishMock } as Pick<ServerClient, 'joinFinish'> as ServerClient,
      baseUrl: 'http://localhost:3100',
      registrationState: /* from start round */,
      username: 'chris',
    });
    expect(result.session.userId).toBe('u1');
    expect(result.mk.length).toBe(32);
    expect(result.recoveryKeyString).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });
});
```

The exact `registrationState` shape is internal to the flow; the test passes a placeholder that the implementation interprets. Adjust once the impl shape is known.

- [ ] **Step 2: Run the failing test**

Run: `pnpm --filter @chatsundere/crypto run test tests/join-by-invitation.test.ts`
Expected: module-not-found error.

- [ ] **Step 3: Implement `src/flows/join-by-invitation.ts`**

Two exported functions:

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
import { generateMasterKey, wrapMasterKey } from '../primitives/mk.js';
import { generateRecoveryKey, deriveRecoveryWrapKey, deriveRecoveryVerifierKey } from '../primitives/recovery.js';
import { startOpaqueRegistration, finishOpaqueRegistration } from '../primitives/opaque.js';
import type { ServerClient } from '../server-client.js';

export interface StartJoinByInvitationParams {
  serverClient: ServerClient;
  baseUrl: string;
  code: string;
  passphrase: string;
}
export interface StartJoinByInvitationResult {
  sessionId: string;
  suggestedUsername: string | null;
  registrationState: /* opaque-state type, see primitives */ unknown;
}

export async function startJoinByInvitation(p: StartJoinByInvitationParams): Promise<StartJoinByInvitationResult> {
  const reg = await startOpaqueRegistration(p.passphrase);
  const resp = await p.serverClient.joinStart({
    kind: 'invitation',
    code: p.code,
    registration_request: reg.requestB64,
  }, p.baseUrl);
  if (resp.kind !== 'invitation') throw new Error('kind_mismatch'); // server bug; never hit
  return {
    sessionId: resp.session_id,
    suggestedUsername: resp.suggested_username,
    registrationState: { reg, registrationResponse: resp.registration_response },
  };
}

export interface FinishJoinByInvitationParams {
  serverClient: ServerClient;
  baseUrl: string;
  registrationState: StartJoinByInvitationResult['registrationState'];
  username: string;
}
export interface FinishJoinByInvitationResult {
  session: { userId: string; username: string; accessToken: string; baseUrl: string; mode: 'linked' };
  mk: Uint8Array;
  recoveryKeyString: string;
}

export async function finishJoinByInvitation(p: FinishJoinByInvitationParams): Promise<FinishJoinByInvitationResult> {
  const state = p.registrationState as { reg: /* opaque types */ unknown; registrationResponse: string };
  const finalReg = await finishOpaqueRegistration(state.reg, state.registrationResponse);

  // Generate fresh MK + recovery key.
  const mk = generateMasterKey();
  const recoveryKeyString = generateRecoveryKey();

  // Wrap with OPAQUE export-key.
  const opaqueWrap = await wrapMasterKey({ mk, wrapKey: finalReg.exportKey, label: 'opaque' });

  // Wrap with recovery-derived key.
  const recoveryWrapKey = await deriveRecoveryWrapKey(recoveryKeyString);
  const recoveryWrap = await wrapMasterKey({ mk, wrapKey: recoveryWrapKey, label: 'recovery' });
  const recoveryVerifier = await deriveRecoveryVerifierKey(recoveryKeyString);

  const resp = await p.serverClient.joinFinish({
    kind: 'invitation',
    session_id: /* from state */ '',
    username: p.username,
    registration_record: finalReg.recordB64,
    wrapped_mk_opaque: opaqueWrap.ciphertextB64,
    wrap_nonce_opaque: opaqueWrap.nonceB64,
    wrap_aad_opaque: opaqueWrap.aadB64,
    wrapped_mk_recovery: recoveryWrap.ciphertextB64,
    wrap_nonce_recovery: recoveryWrap.nonceB64,
    wrap_aad_recovery: recoveryWrap.aadB64,
    recovery_verifier_key: recoveryVerifier.b64,
  }, p.baseUrl);

  if (resp.kind !== 'invitation') throw new Error('kind_mismatch');

  return {
    session: { userId: resp.user_id, username: resp.username, accessToken: resp.access_token, baseUrl: p.baseUrl, mode: 'linked' },
    mk,
    recoveryKeyString,
  };
}
```

Note the implementation references `primitives/*` helpers (`generateMasterKey`, `wrapMasterKey`, `generateRecoveryKey`, `deriveRecoveryWrapKey`, `deriveRecoveryVerifierKey`, `startOpaqueRegistration`, `finishOpaqueRegistration`). These primitives already exist in some form for `create-local-account.ts` and `link-to-server.ts` — locate them with `rg 'export (function|const) (generateMasterKey|wrapMasterKey|generateRecoveryKey)'` and reuse. If a primitive is currently a private helper of an existing flow, lift it into `packages/crypto/src/primitives/` and re-export. Do not duplicate logic.

- [ ] **Step 4: Add export**

In `packages/crypto/src/index.ts`, near the existing `linkToServer` export:

```typescript
export { startJoinByInvitation, finishJoinByInvitation } from './flows/join-by-invitation.js';
```

- [ ] **Step 5: Re-run the test**

Run: `pnpm --filter @chatsundere/crypto run test tests/join-by-invitation.test.ts`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add packages/crypto/src/flows/join-by-invitation.ts packages/crypto/src/index.ts packages/crypto/tests/join-by-invitation.test.ts packages/crypto/src/primitives/
git commit -m "Add joinByInvitation flow (fresh-MK case)"
```

---

## Task 5: packages/crypto — `joinByPairing` flow

**Files:**
- Create: `packages/crypto/src/flows/join-by-pairing.ts`
- Modify: `packages/crypto/src/index.ts` (add export)
- Create: `packages/crypto/tests/join-by-pairing.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, mock } from 'bun:test';
import { startJoinByPairing, finishJoinByPairing } from '../src/flows/join-by-pairing.js';
import type { ServerClient } from '../src/server-client.js';

describe('joinByPairing — start', () => {
  it('returns the account username for the confirm screen', async () => {
    const result = await startJoinByPairing({
      serverClient: {
        joinStart: mock(async () => ({
          kind: 'pairing',
          session_id: 'sess-2',
          login_response: 'b64-login-resp',
          username: 'chris',
        })),
      } as ServerClient,
      baseUrl: 'http://localhost:3100',
      code: 'AB7K3-MN9PX',
      passphrase: 'correct horse battery staple',
    });
    expect(result.username).toBe('chris');
    expect(result.sessionId).toBe('sess-2');
  });
});

describe('joinByPairing — finish', () => {
  it('unwraps MK from the server-returned wrapping material', async () => {
    // Stub joinFinish to return precomputed wrapped material; assert mk
    // matches the precomputed expected mk.
    // (concrete fixture: generate a known mk, wrap with a known exportKey,
    // assert unwrap recovers the same mk)
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `pnpm --filter @chatsundere/crypto run test tests/join-by-pairing.test.ts`
Expected: module-not-found.

- [ ] **Step 3: Implement `src/flows/join-by-pairing.ts`**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
import { startOpaqueLogin, finishOpaqueLogin } from '../primitives/opaque.js';
import { unwrapMasterKey } from '../primitives/mk.js';
import type { ServerClient } from '../server-client.js';

export interface StartJoinByPairingParams {
  serverClient: ServerClient;
  baseUrl: string;
  code: string;
  passphrase: string;
}
export interface StartJoinByPairingResult {
  sessionId: string;
  username: string;
  loginState: unknown;
}

export async function startJoinByPairing(p: StartJoinByPairingParams): Promise<StartJoinByPairingResult> {
  const login = await startOpaqueLogin(p.passphrase);
  const resp = await p.serverClient.joinStart({
    kind: 'pairing',
    code: p.code,
    login_request: login.requestB64,
  }, p.baseUrl);
  if (resp.kind !== 'pairing') throw new Error('kind_mismatch');
  return {
    sessionId: resp.session_id,
    username: resp.username,
    loginState: { login, loginResponse: resp.login_response },
  };
}

export interface FinishJoinByPairingParams {
  serverClient: ServerClient;
  baseUrl: string;
  loginState: StartJoinByPairingResult['loginState'];
}
export interface FinishJoinByPairingResult {
  session: { userId: string; username: string; accessToken: string; baseUrl: string; mode: 'linked' };
  mk: Uint8Array;
}

export async function finishJoinByPairing(p: FinishJoinByPairingParams): Promise<FinishJoinByPairingResult> {
  const state = p.loginState as { login: unknown; loginResponse: string };
  const final = await finishOpaqueLogin(state.login, state.loginResponse);

  const resp = await p.serverClient.joinFinish({
    kind: 'pairing',
    session_id: /* from state */ '',
    login_evidence: final.evidenceB64,
  }, p.baseUrl);

  if (resp.kind !== 'pairing') throw new Error('kind_mismatch');

  // TODO(phase-1): when sync-service ships, this flow will need to detect
  // local-data on this device and merge via UUIDv7 (see spec § 9 + ADR 0025).
  // For Phase 0, local MK is replaced — accepted data loss for a test audience
  // of two.
  const mk = await unwrapMasterKey({
    ciphertextB64: resp.wrapped_mk_opaque,
    nonceB64: resp.wrap_nonce_opaque,
    aadB64: resp.wrap_aad_opaque,
    wrapKey: final.exportKey,
    label: 'opaque',
  });

  return {
    session: { userId: resp.user_id, username: resp.username, accessToken: resp.access_token, baseUrl: p.baseUrl, mode: 'linked' },
    mk,
  };
}
```

- [ ] **Step 4: Export from `src/index.ts`**

```typescript
export { startJoinByPairing, finishJoinByPairing } from './flows/join-by-pairing.js';
```

- [ ] **Step 5: Run tests, expect PASS**

Run: `pnpm --filter @chatsundere/crypto run test tests/join-by-pairing.test.ts`

- [ ] **Step 6: Commit**

```bash
git add packages/crypto/src/flows/join-by-pairing.ts packages/crypto/src/index.ts packages/crypto/tests/join-by-pairing.test.ts
git commit -m "Add joinByPairing flow with server-side MK download"
```

---

## Task 6: packages/crypto — `recoverFromScratch` flow

**Background:** Existing `recovery-online.ts` assumes an existing local account row. The new flow for the matrix's "Use a recovery key" path must create a local-account row from nothing: URL + username + recovery-key + new passphrase.

**Files:**
- Create: `packages/crypto/src/flows/recover-from-scratch.ts`
- Modify: `packages/crypto/src/index.ts` (add export)
- Create: `packages/crypto/tests/recover-from-scratch.test.ts`

- [ ] **Step 1: Read the existing recovery flow to identify reusable parts**

Run: `cat packages/crypto/src/flows/recovery-online.ts`

Note which helpers (`recoveryStart`, `recoveryFinish` server calls, recovery-key derivation, OPAQUE re-registration) can be lifted into `primitives/` and reused. If `recovery-online.ts` already does most of the work but takes an existing local-account row, refactor it so the local-account row lookup is a separate step the caller does.

- [ ] **Step 2: Write the failing test**

```typescript
import { describe, expect, it, mock } from 'bun:test';
import { recoverFromScratch } from '../src/flows/recover-from-scratch.js';
import type { ServerClient } from '../src/server-client.js';

describe('recoverFromScratch', () => {
  it('returns a fresh session + the recovered MK + a new local account row', async () => {
    // Stub serverClient.recoveryStart and recoveryFinish to return a known
    // wrap pair; assert the unwrapped MK matches the precomputed expected.
    // Then assert a local-account row is created in the IDB mock with the
    // username, baseUrl, and accessToken.
  });
});
```

- [ ] **Step 3: Implement `src/flows/recover-from-scratch.ts`**

Logic:
1. Call `recoveryStart` with `{ username }`, get challenge + wrapped MK material.
2. Derive recovery wrap-key from the input recovery-key string.
3. Unwrap MK.
4. Generate fresh OPAQUE registration round under the new passphrase.
5. Wrap the MK with the new OPAQUE export-key.
6. Call `recoveryFinish` with the new registration record + new wrapping material.
7. Persist a new local-account row in IDB (similar to what `link-to-server.ts` does at the end).
8. Return `{ session, mk }` for the caller to install via `setSession()`.

Show full code per spec § 4.4 mechanics; reuse primitives identified in Step 1.

- [ ] **Step 4: Export and test**

```typescript
export { recoverFromScratch } from './flows/recover-from-scratch.js';
```

Run: `pnpm --filter @chatsundere/crypto run test tests/recover-from-scratch.test.ts`
Expected: green.

- [ ] **Step 5: Run the existing recovery test to confirm no regression**

Run: `pnpm --filter @chatsundere/crypto run test tests/recovery.test.ts`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add packages/crypto/src/flows/recover-from-scratch.ts packages/crypto/src/flows/recovery-online.ts packages/crypto/src/index.ts packages/crypto/tests/recover-from-scratch.test.ts
git commit -m "Add recoverFromScratch flow for matrix recovery path"
```

---

## Task 7: packages/crypto — migrate `linkToServer` to `joinStart`/`joinFinish`

**Files:**
- Modify: `packages/crypto/src/flows/link-to-server.ts`
- Update tests if they exist: `packages/crypto/tests/link-to-server.test.ts` (run `ls packages/crypto/tests/` to confirm).

- [ ] **Step 1: Read the existing flow**

```bash
cat packages/crypto/src/flows/link-to-server.ts
```

Identify the call sites of `serverClient.linkOpaqueStart` and `serverClient.linkOpaqueFinish`. They typically pass `{ invitation_token, registration_request }` and `{ session_id, username, registration_record, wrapped_mk_*, ... }` respectively.

- [ ] **Step 2: Rewrite each call to use the new endpoints**

Replace:

```typescript
const startResp = await serverClient.linkOpaqueStart(
  { invitation_token: code, registration_request: reg.requestB64 },
  baseUrl
);
```

With:

```typescript
const startResp = await serverClient.joinStart(
  { kind: 'invitation', code, registration_request: reg.requestB64 },
  baseUrl
);
if (startResp.kind !== 'invitation') throw new Error('kind_mismatch');
const { session_id, registration_response, suggested_username } = startResp;
```

(`suggested_username` is unused in late-link because the local username wins, but read it for completeness.)

Replace:

```typescript
const finishResp = await serverClient.linkOpaqueFinish({
  session_id, username, registration_record, ...wrappingMaterial,
}, baseUrl);
```

With:

```typescript
const finishResp = await serverClient.joinFinish({
  kind: 'invitation',
  session_id, username, registration_record, ...wrappingMaterial,
}, baseUrl);
if (finishResp.kind !== 'invitation') throw new Error('kind_mismatch');
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @chatsundere/crypto run build`
Expected: clean.

- [ ] **Step 4: Run all crypto tests**

Run: `pnpm --filter @chatsundere/crypto run test`
Expected: all green; no regressions.

- [ ] **Step 5: Commit**

```bash
git add packages/crypto/src/flows/link-to-server.ts packages/crypto/tests/
git commit -m "Migrate linkToServer to /api/v1/join/{start,finish}"
```

---

## Task 8: user-client `lib/code-input.ts` — alphabet normaliser

**Files:**
- Create: `apps/user-client/src/lib/code-input.ts`
- Create: `apps/user-client/tests/unit/code-input.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/user-client/tests/unit/code-input.test.ts
import { describe, expect, it } from 'vitest';
import { normaliseCodeInput, isValidCode } from '../../src/lib/code-input.js';

describe('normaliseCodeInput', () => {
  it('uppercases letters on the fly', () => {
    expect(normaliseCodeInput('ab7k3mn9pn')).toBe('AB7K3-MN9PN');
  });

  it('maps I → 1', () => {
    expect(normaliseCodeInput('IBC12')).toBe('1BC12');
  });

  it('maps L → 1', () => {
    expect(normaliseCodeInput('LBC12')).toBe('1BC12');
  });

  it('maps O → 0', () => {
    expect(normaliseCodeInput('OBC12')).toBe('0BC12');
  });

  it('maps V → Y (the V↔U swap)', () => {
    expect(normaliseCodeInput('VBC12')).toBe('YBC12');
  });

  it('keeps U in the alphabet', () => {
    expect(normaliseCodeInput('UBC12')).toBe('UBC12');
  });

  it('strips foreign characters', () => {
    expect(normaliseCodeInput('AB-7K!3MN9PN')).toBe('AB7K3-MN9PN');
    expect(normaliseCodeInput('  AB7K3 MN9PN  ')).toBe('AB7K3-MN9PN');
  });

  it('auto-inserts the hyphen after position 5', () => {
    expect(normaliseCodeInput('AB7K3')).toBe('AB7K3');
    expect(normaliseCodeInput('AB7K3M')).toBe('AB7K3-M');
    expect(normaliseCodeInput('AB7K3MN9PN')).toBe('AB7K3-MN9PN');
  });

  it('truncates beyond 10 alphabet chars', () => {
    expect(normaliseCodeInput('AB7K3MN9PNEXTRA')).toBe('AB7K3-MN9PN');
  });
});

describe('isValidCode', () => {
  it('accepts the canonical 10-char hyphenated form', () => {
    expect(isValidCode('AB7K3-MN9PN')).toBe(true);
    expect(isValidCode('UB7K3-MN9PN')).toBe(true);
    expect(isValidCode('00000-11111')).toBe(true);
  });

  it('rejects out-of-alphabet chars', () => {
    expect(isValidCode('IB7K3-MN9PN')).toBe(false); // I excluded
    expect(isValidCode('LB7K3-MN9PN')).toBe(false); // L excluded
    expect(isValidCode('OB7K3-MN9PN')).toBe(false); // O excluded
    expect(isValidCode('VB7K3-MN9PN')).toBe(false); // V excluded
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter @chatsundere/user-client run test tests/unit/code-input.test.ts`

- [ ] **Step 3: Implement `src/lib/code-input.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
// Crockford-derived Base32 with V↔U swap — see spec § 2 Decision 8 and
// apps/auth-service/src/codes/token.ts for the canonical form.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTUWXYZ';
const ALPHABET_SET = new Set(ALPHABET);
const CODE_RE = /^[0-9ABCDEFGHJKMNPQRSTUWXYZ]{5}-[0-9ABCDEFGHJKMNPQRSTUWXYZ]{5}$/;

const SUBSTITUTIONS: Record<string, string> = {
  I: '1',
  L: '1',
  O: '0',
  V: 'Y',
};

export function normaliseCodeInput(raw: string): string {
  // 1. Uppercase, then map substitutions and drop anything else.
  const upper = raw.toUpperCase();
  const chars: string[] = [];
  for (const ch of upper) {
    const mapped = SUBSTITUTIONS[ch] ?? ch;
    if (ALPHABET_SET.has(mapped)) chars.push(mapped);
    if (chars.length === 10) break;
  }
  // 2. Re-insert hyphen.
  if (chars.length <= 5) return chars.join('');
  return `${chars.slice(0, 5).join('')}-${chars.slice(5).join('')}`;
}

export function isValidCode(canonical: string): boolean {
  return CODE_RE.test(canonical);
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm --filter @chatsundere/user-client run test tests/unit/code-input.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/code-input.ts apps/user-client/tests/unit/code-input.test.ts
git commit -m "Add code-input normaliser with V↔U swap"
```

---

## Task 9: user-client `lib/qr.ts` — rewrite `parseJoinUrl`

**Files:**
- Modify: `apps/user-client/src/lib/qr.ts` (delete `parseInvitationPayload`, `InvitationQrPayload`, `parseInvitationUrl`; add `parseJoinUrl`)
- Replace: `apps/user-client/tests/unit/qr.test.ts` (rewrite for the new parser)

- [ ] **Step 1: Replace the test file** with assertions for the new parser:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { parseJoinUrl, scanWithCamera } from '../../src/lib/qr.js';

describe('parseJoinUrl', () => {
  it('accepts the canonical https://host/join#CODE form', () => {
    const result = parseJoinUrl('https://chatsundere.me/join#AB7K3-MN9PN');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.baseUrl).toBe('https://chatsundere.me/');
      expect(result.value.code).toBe('AB7K3-MN9PN');
    }
  });

  it('accepts http://localhost:N/join#CODE', () => {
    const result = parseJoinUrl('http://localhost:3100/join#AB7K3-MN9PN');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.baseUrl).toBe('http://localhost:3100/');
  });

  it('accepts sub-path-hosted base URLs', () => {
    const result = parseJoinUrl('https://relay.example.com/t4524089/join#AB7K3-MN9PN');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.baseUrl).toBe('https://relay.example.com/t4524089/');
  });

  it('rejects non-loopback http://', () => {
    const result = parseJoinUrl('http://chatsundere.me/join#AB7K3-MN9PN');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('bad_scheme');
  });

  it('rejects URLs without /join# segment', () => {
    expect(parseJoinUrl('https://chatsundere.me/').ok).toBe(false);
    expect(parseJoinUrl('https://chatsundere.me/join').ok).toBe(false);
  });

  it('rejects out-of-alphabet fragment chars', () => {
    expect(parseJoinUrl('https://chatsundere.me/join#IB7K3-MN9PN').ok).toBe(false);
  });

  it('rejects entirely malformed strings', () => {
    expect(parseJoinUrl('not a url').ok).toBe(false);
  });
});
```

- [ ] **Step 2: Rewrite `src/lib/qr.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import QrScanner from 'qr-scanner';
import { isValidCode } from './code-input.js';

export interface ParsedJoin {
  baseUrl: string;
  code: string;
}

export type ParseJoinResult =
  | { ok: true; value: ParsedJoin }
  | { ok: false; error: 'malformed' | 'bad_scheme' | 'missing_join_segment' | 'bad_fragment' };

export function parseJoinUrl(raw: string): ParseJoinResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'malformed' };
  }

  // Scheme: https everywhere, http only for loopback.
  const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    return { ok: false, error: 'bad_scheme' };
  }

  // Must end in /join (with any leading sub-path).
  if (!url.pathname.endsWith('/join')) {
    return { ok: false, error: 'missing_join_segment' };
  }

  // Code in the fragment.
  const fragment = url.hash.startsWith('#') ? url.hash.slice(1) : '';
  if (!isValidCode(fragment)) {
    return { ok: false, error: 'bad_fragment' };
  }

  // Base URL = origin + everything up to /join (inclusive of trailing slash).
  const basePath = url.pathname.slice(0, -('join'.length));
  const baseUrl = `${url.origin}${basePath}`;

  return { ok: true, value: { baseUrl, code: fragment } };
}

// scanWithCamera is unchanged; it accepts a callback. Adapt the existing
// signature so the callback now receives the raw string for parseJoinUrl
// rather than the legacy parseInvitationPayload-style payload.
export async function scanWithCamera(
  videoEl: HTMLVideoElement,
  onResult: (raw: string) => void,
): Promise<() => void> {
  const scanner = new QrScanner(videoEl, (result) => onResult(result.data), {
    highlightScanRegion: true,
    highlightCodeOutline: true,
  });
  await scanner.start();
  return () => scanner.stop();
}
```

(Keep `scanWithCamera` if its existing signature already matches; if it relied on `parseInvitationPayload` internally, adjust as shown.)

- [ ] **Step 3: Run tests, expect PASS**

Run: `pnpm --filter @chatsundere/user-client run test tests/unit/qr.test.ts`

- [ ] **Step 4: Search for stale references**

Run: `rg 'parseInvitationPayload|parseInvitationUrl|InvitationQrPayload' apps/user-client/src/`
Expected: matches in `routes/linking/scan.tsx` and `routes/linking/paste.tsx` (which are about to be deleted). Note them; they will be removed in Task 19.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/qr.ts apps/user-client/tests/unit/qr.test.ts
git commit -m "Rewrite qr.ts to parse the /join#CODE URL form"
```

---

## Task 10: user-client `lib/server-client.ts` — wire to new join endpoints

**Files:**
- Modify: `apps/user-client/src/lib/server-client.ts`

- [ ] **Step 1: Replace `linkOpaqueStart`/`linkOpaqueFinish` blocks**

```typescript
// Delete the linkOpaqueStart and linkOpaqueFinish properties.
// Add:
joinStart: (req: JoinStartRequest, baseUrl: string) =>
  apiFetch<JoinStartResponse>({
    baseUrl,
    path: '/api/v1/join/start',
    json: req,
    authMode: 'none',
  }),
joinFinish: (req: JoinFinishRequest, baseUrl: string) =>
  apiFetch<JoinFinishResponse>({
    baseUrl,
    path: '/api/v1/join/finish',
    json: req,
    authMode: 'none',
  }),
```

Update imports at the top:

```typescript
import type {
  JoinStartRequest, JoinStartResponse, JoinFinishRequest, JoinFinishResponse,
  LinkPasskeyStartRequest, LinkPasskeyStartResponse,
  LinkPasskeyFinishRequest, LinkPasskeyFinishResponse,
  // … other unchanged imports
} from '@chatsundere/shared-types';
```

Remove the four `LinkOpaque*` imports.

Also remove the long top-of-file comment about `ADR 0021 — OPAQUE-first linking` since it referenced `linkOpaqueStart` / `linkOpaqueFinish` — replace it with a one-line note: `// Bearer-only passkey link endpoints unchanged; join endpoints absorbed the OPAQUE flows.`

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @chatsundere/user-client run build`
Expected: typecheck errors in `routes/linking/confirm.tsx` (still uses old API). Note them; deleted in Task 19.

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/lib/server-client.ts
git commit -m "Rewire user-client server-client to /api/v1/join/{start,finish}"
```

---

## Task 11: user-client `state/onboarding.store.ts` — discriminated state machine

**Files:**
- Create: `apps/user-client/src/state/onboarding.store.ts`
- Delete: `apps/user-client/src/state/linking.store.ts` (after confirming no remaining imports)

- [ ] **Step 1: Implement the store**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand';

export type OnboardingState =
  | { kind: 'idle' }
  | { kind: 'invitation_input'; baseUrl: string; code: string }
  | { kind: 'invitation_confirm'; sessionId: string; baseUrl: string; code: string; suggestedUsername: string | null; registrationState: unknown }
  | { kind: 'invitation_recovery'; userId: string; username: string; recoveryKeyString: string }
  | { kind: 'pairing_input'; baseUrl: string; code: string }
  | { kind: 'pairing_confirm'; sessionId: string; baseUrl: string; code: string; username: string; loginState: unknown }
  | { kind: 'success'; userId: string };

interface OnboardingStore {
  state: OnboardingState;
  setState: (next: OnboardingState) => void;
  reset: () => void;
}

export const useOnboardingStore = create<OnboardingStore>((set) => ({
  state: { kind: 'idle' },
  setState: (next) => set({ state: next }),
  reset: () => set({ state: { kind: 'idle' } }),
}));
```

- [ ] **Step 2: Confirm `linking.store.ts` has no remaining consumers**

Run: `rg 'useLinkingStore|linking\.store' apps/user-client/src/`

If matches exist only in `routes/linking/{scan,paste,confirm}.tsx` (about to be deleted), proceed to delete `linking.store.ts`. If there are any other consumers, fix them first.

- [ ] **Step 3: Delete `linking.store.ts`**

```bash
rm apps/user-client/src/state/linking.store.ts
```

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/state/
git commit -m "Add onboarding.store; remove obsolete linking.store"
```

---

## Task 12: user-client matrix screen `/onboarding`

**Files:**
- Create: `apps/user-client/src/routes/onboarding/matrix.tsx`
- Delete: `apps/user-client/src/routes/onboarding.tsx` (the old one)

- [ ] **Step 1: Implement `matrix.tsx`** with a 2×2 grid of four cells:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useOnboardingStore } from '../../state/onboarding.store.js';

const CELLS = [
  { to: '/onboarding/invitation', label: 'I have an invitation', hint: 'From your operator' },
  { to: '/onboarding/pairing', label: 'Add this device', hint: "I'm already a user" },
  { to: '/onboarding/recovery', label: 'Use a recovery key', hint: 'I lost my devices' },
  { to: '/onboarding/local/username', label: 'Just this device', hint: 'No server, no sync' },
] as const;

export function OnboardingMatrix() {
  // Clear any stale store state from a previous interrupted attempt.
  useEffect(() => useOnboardingStore.getState().reset(), []);

  return (
    <main className="grid grid-cols-2 gap-px bg-aurora-700/20" style={{ minHeight: '100dvh' }}>
      {CELLS.map((cell) => (
        <Link
          key={cell.to}
          to={cell.to}
          className="flex flex-col items-center justify-center bg-ink-soft px-4 py-6 text-center"
        >
          {/* Icon slot — styling pass adds the symbol per project_neurodivergent_audience memory */}
          <div className="mb-2 h-10 w-10 rounded bg-aurora-700/20" aria-hidden />
          <h2 className="font-display text-lg italic">{cell.label}</h2>
          <p className="mt-1 text-xs text-paper-soft">{cell.hint}</p>
        </Link>
      ))}
    </main>
  );
}
```

Styling is deliberately minimal per `[[feedback_mechanics_first_styling_later]]` — the icon slot and finished cell treatment land in the styling pass.

- [ ] **Step 2: Delete the old onboarding entry**

```bash
rm apps/user-client/src/routes/onboarding.tsx
```

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/routes/onboarding/matrix.tsx
git rm apps/user-client/src/routes/onboarding.tsx
git commit -m "Replace single-CTA onboarding with 2×2 intent matrix"
```

---

## Task 13: user-client invitation form + scan routes

**Files:**
- Create: `apps/user-client/src/routes/onboarding/invitation/form.tsx`
- Create: `apps/user-client/src/routes/onboarding/invitation/scan.tsx`
- Create: `apps/user-client/src/components/JoinFormFields.tsx` (shared between invitation form and pairing form)

- [ ] **Step 1: Build the shared form fields component** to keep the invitation and pairing forms DRY:

```tsx
// apps/user-client/src/components/JoinFormFields.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useId } from 'react';
import { normaliseCodeInput } from '../lib/code-input.js';

interface Props {
  baseUrl: string;
  code: string;
  onBaseUrlChange: (v: string) => void;
  onCodeChange: (v: string) => void;
}

export function JoinFormFields({ baseUrl, code, onBaseUrlChange, onCodeChange }: Props) {
  const urlId = useId();
  const codeId = useId();

  function handleUrlChange(raw: string) {
    // Paste-auto-split: if the URL contains /join#CODE, extract.
    const match = raw.match(/^(.*\/join)#([A-Z0-9-]+)$/i);
    if (match) {
      const base = match[1].replace(/\/join$/, '/');
      const fragmentCode = normaliseCodeInput(match[2]);
      onBaseUrlChange(base);
      onCodeChange(fragmentCode);
      return;
    }
    onBaseUrlChange(raw);
  }

  return (
    <>
      <div>
        <label htmlFor={urlId} className="text-xs font-medium uppercase tracking-wider">Server URL</label>
        <input
          id={urlId} type="url" inputMode="url" autoComplete="off" spellCheck={false}
          value={baseUrl}
          onChange={(e) => handleUrlChange(e.target.value)}
          placeholder="https://chatsundere.me/"
          className="mt-1 w-full rounded bg-ink-soft px-3 py-2"
        />
      </div>
      <div className="mt-4">
        <label htmlFor={codeId} className="text-xs font-medium uppercase tracking-wider">Code</label>
        <input
          id={codeId} inputMode="text" autoComplete="off" spellCheck={false}
          value={code}
          onChange={(e) => onCodeChange(normaliseCodeInput(e.target.value))}
          placeholder="XXXXX-XXXXX"
          className="mt-1 w-full rounded bg-ink-soft px-3 py-2 font-mono"
        />
      </div>
    </>
  );
}
```

- [ ] **Step 2: Build the invitation form** at `routes/onboarding/invitation/form.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { JoinFormFields } from '../../../components/JoinFormFields.js';
import { isValidCode } from '../../../lib/code-input.js';
import { useOnboardingStore } from '../../../state/onboarding.store.js';

export function InvitationForm() {
  const navigate = useNavigate();
  const setState = useOnboardingStore((s) => s.setState);
  const initial = useOnboardingStore((s) =>
    s.state.kind === 'invitation_input' ? s.state : { baseUrl: '', code: '' }
  );
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [code, setCode] = useState(initial.code);
  const [error, setError] = useState<string | null>(null);

  const urlValid = isValidServerUrl(baseUrl);
  const codeValid = isValidCode(code);
  const continueEnabled = urlValid && codeValid;

  function handleContinue() {
    if (!continueEnabled) return;
    setState({ kind: 'invitation_input', baseUrl, code });
    // Pre-call /join/start before navigating to confirm (see Task 14 for the call site).
    navigate('/onboarding/invitation/confirm');
  }

  return (
    <main className="mx-auto max-w-sm p-6">
      <Link to="/onboarding" aria-label="Back">←</Link>
      <h1>Redeem your invitation</h1>
      <form onSubmit={(e) => { e.preventDefault(); handleContinue(); }}>
        <JoinFormFields
          baseUrl={baseUrl} code={code}
          onBaseUrlChange={setBaseUrl} onCodeChange={setCode}
        />
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        <button type="submit" disabled={!continueEnabled}
          className="mt-6 w-full rounded bg-aurora-700 py-3 disabled:opacity-40">Continue</button>
      </form>
      <div className="mt-8 flex items-center gap-3">
        <div className="h-px flex-1 bg-aurora-700/40" />
        <span className="text-xs uppercase">or</span>
        <div className="h-px flex-1 bg-aurora-700/40" />
      </div>
      <Link
        to="/onboarding/invitation/scan"
        className="mt-4 flex w-full items-center justify-center gap-2 rounded border border-aurora-700 px-4 py-3"
      >
        <span aria-hidden>📷</span> Scan QR code
      </Link>
    </main>
  );
}

function isValidServerUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    const loopback = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    return u.protocol === 'https:' || (u.protocol === 'http:' && loopback);
  } catch {
    return false;
  }
}
```

The error surface handling and the /start call are wired in Task 14 (the confirm screen actually calls /start; the form pushes user to confirm after preserving inputs in the store). For pure form mechanics, this is enough.

- [ ] **Step 3: Build the scan route** at `routes/onboarding/invitation/scan.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { parseJoinUrl, scanWithCamera } from '../../../lib/qr.js';
import { useOnboardingStore } from '../../../state/onboarding.store.js';

export function InvitationScan() {
  const navigate = useNavigate();
  const setState = useOnboardingStore((s) => s.setState);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    void (async () => {
      try {
        const el = videoRef.current;
        if (!el) return;
        cleanup = await scanWithCamera(el, (raw) => {
          if (cancelled) return;
          const result = parseJoinUrl(raw);
          if (!result.ok) return; // ignore unrelated QRs
          cancelled = true;
          cleanup?.();
          setState({ kind: 'invitation_input', baseUrl: result.value.baseUrl, code: result.value.code });
          navigate('/onboarding/invitation/confirm', { replace: true });
        });
      } catch {
        setPermissionDenied(true);
      }
    })();
    return () => { cancelled = true; cleanup?.(); };
  }, [navigate, setState]);

  return (
    <main className="mx-auto max-w-sm p-6">
      <Link to="/onboarding/invitation" aria-label="Back">←</Link>
      <h1>Scan QR code</h1>
      {permissionDenied ? (
        <>
          <p className="mt-4">Camera unavailable.</p>
          <Link to="/onboarding/invitation" className="mt-4 inline-block">Use the form instead</Link>
        </>
      ) : (
        <video ref={videoRef} playsInline muted className="mt-4 aspect-square w-full rounded bg-ink" aria-label="Camera viewfinder" />
      )}
    </main>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/components/JoinFormFields.tsx apps/user-client/src/routes/onboarding/invitation/
git commit -m "Add invitation form + scan routes (Variant C)"
```

---

## Task 14: user-client invitation confirm route

**Files:**
- Create: `apps/user-client/src/routes/onboarding/invitation/confirm.tsx`

This route runs the `startJoinByInvitation` round on mount (using the URL+code from the store), then renders the confirm UI. On Continue, it runs `finishJoinByInvitation` and navigates to recovery-reveal (fresh-PWA mode) or `/app` (late-link mode).

- [ ] **Step 1: Implement `confirm.tsx`**

Key behaviour:
- On mount: read store state; if `invitation_input`, call `startJoinByInvitation`. If `invitation_confirm`, skip the call (returning from /scan back to /confirm).
- Handle errors from /start (code_not_found, kind_mismatch, rate_limit_exceeded, network) per spec § 5: `kind_mismatch` → render constructive-switch offer with a button routing to `/onboarding/pairing`.
- On submit: call `finishJoinByInvitation`. On 409 username_taken: stay on confirm, surface inline error under username.
- Late-link detection: if `useSessionStore.getState().session` is non-null and `useSessionStore.getState().mk` is non-null, prepare the existing-MK wrap variant via the existing `linkToServer` flow rather than `joinByInvitation` (the flows differ — see § 4.2 of the spec). Use `mode` prop or a runtime branch:

```typescript
const isLateLink = !!session && !!mk;
if (isLateLink) {
  await linkToServer({ db: getDb(), serverClient: httpServerClient, invitationToken: code, baseUrl, ... });
  navigate('/app', { replace: true });
} else {
  const result = await finishJoinByInvitation({ ... });
  useSessionStore.getState().setSession(result.session, result.mk);
  useOnboardingStore.getState().setState({ kind: 'invitation_recovery', userId: result.session.userId, username: result.session.username, recoveryKeyString: result.recoveryKeyString });
  navigate('/onboarding/invitation/recovery');
}
```

Use the existing `PassphraseField` component for the passphrase input. Read the suggested_username from the store (or null) and pre-fill the username input in fresh-PWA mode; in late-link mode, render the local username read-only.

- [ ] **Step 2: Commit**

```bash
git add apps/user-client/src/routes/onboarding/invitation/confirm.tsx
git commit -m "Add invitation confirm route with fresh-PWA + late-link dispatch"
```

---

## Task 15: user-client invitation recovery-reveal route

**Files:**
- Create: `apps/user-client/src/routes/onboarding/invitation/recovery-reveal.tsx`

- [ ] **Step 1: Implement**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useNavigate } from 'react-router-dom';
import { RecoveryKeyReveal } from '../../../components/RecoveryKeyReveal.js';
import { useOnboardingStore } from '../../../state/onboarding.store.js';

export function InvitationRecoveryReveal() {
  const navigate = useNavigate();
  const state = useOnboardingStore((s) => s.state);

  if (state.kind !== 'invitation_recovery') {
    navigate('/onboarding', { replace: true });
    return null;
  }

  return (
    <RecoveryKeyReveal
      recoveryKey={state.recoveryKeyString}
      onDone={() => {
        useOnboardingStore.getState().reset();
        navigate('/app', { replace: true });
      }}
    />
  );
}
```

The `RecoveryKeyReveal` component already exists for the local-only flow (`apps/user-client/src/components/RecoveryKeyReveal.tsx`). Reuse it as-is.

- [ ] **Step 2: Commit**

```bash
git add apps/user-client/src/routes/onboarding/invitation/recovery-reveal.tsx
git commit -m "Add invitation recovery-reveal route (fresh-PWA mode)"
```

---

## Task 16: user-client pairing routes (form, scan, confirm)

**Files:**
- Create: `apps/user-client/src/routes/onboarding/pairing/form.tsx`
- Create: `apps/user-client/src/routes/onboarding/pairing/scan.tsx`
- Create: `apps/user-client/src/routes/onboarding/pairing/confirm.tsx`

- [ ] **Step 1: Build `form.tsx`** — structurally identical to invitation form. Reuse `<JoinFormFields>`. On Continue, set `kind: 'pairing_input'` in the store and navigate to `/onboarding/pairing/confirm`.

- [ ] **Step 2: Build `scan.tsx`** — structurally identical to invitation scan. On scan match, set `kind: 'pairing_input'` and navigate to `/onboarding/pairing/confirm`.

- [ ] **Step 3: Build `confirm.tsx`**

Key behaviour:
- On mount: call `startJoinByPairing` with the URL + code + passphrase (passphrase entry on confirm). Wait — passphrase needs to be entered first, so the /start call happens on submit, not mount. Reorder: confirm screen renders URL + username placeholder (filled after /start), and runs /start on user input change of passphrase + tap of Continue. Actually two-round protocol means we need the OPAQUE login round to be started before we have user input — but the OPAQUE round needs the passphrase. So:

Layout:
- Show URL read-only.
- Show "Adding this device to *{username}*?" if known (from a separate `/start` call without passphrase — but /start requires `login_request` which needs the passphrase).

Resolution: Username from /start response is the thing we want to show *before* passphrase entry, but /start needs the passphrase. We can't have it both ways without a separate "peek" endpoint (which doesn't exist).

**Spec § 4.3 step 3** says "On Continue, generates OPAQUE login request… and calls /start". The confirm screen's title is "Add this device to {username}?" — which means we *don't* know the username on first render. Either:

- (a) Show generic "Add this device" copy until /start completes, then update with username after passphrase entry + first round.
- (b) Two-step confirm: first "Enter passphrase" → submit → /start runs → reveal "Add device to {username}, confirm again with the same passphrase" → /finish runs.

Option (a) is one screen, one passphrase entry, two server calls per submit. Cleaner. Implement that.

```tsx
async function handleContinue() {
  setBusy(true);
  try {
    const startResult = await startJoinByPairing({
      serverClient: httpServerClient, baseUrl, code, passphrase,
    });
    // Now we know the username. Optionally show it in a brief overlay before /finish.
    const finishResult = await finishJoinByPairing({
      serverClient: httpServerClient, baseUrl, loginState: startResult.loginState,
    });
    useSessionStore.getState().setSession(finishResult.session, finishResult.mk);
    useOnboardingStore.getState().reset();
    navigate('/app', { replace: true });
  } catch (err) {
    // map error types → inline error
    setBusy(false);
  }
}
```

For "show username then confirm" UX without a second tap, we can opt for an inline animated transition after /start succeeds — but mechanically this is one Continue tap, two calls back-to-back.

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/routes/onboarding/pairing/
git commit -m "Add pairing form, scan, and confirm routes"
```

---

## Task 17: user-client recovery single-screen route

**Files:**
- Create: `apps/user-client/src/routes/onboarding/recovery.tsx`

- [ ] **Step 1: Implement** a single-screen form with: Server URL, Username, Recovery key (one combined field with hyphen auto-format), New passphrase, Confirm new passphrase. "Continue" enabled when all five validate and passphrases match.

On submit, call `recoverFromScratch({ ... })`. On success, persist session and navigate to `/app`. On error, surface inline.

```tsx
// Use the same isValidServerUrl helper from invitation form (extract to lib if needed).
// Use existing PassphraseField for passphrase + confirm.
// Recovery key field uses a custom auto-formatter for XXXX-XXXX-XXXX-XXXX shape.
```

- [ ] **Step 2: Commit**

```bash
git add apps/user-client/src/routes/onboarding/recovery.tsx
git commit -m "Add recovery-from-scratch route"
```

---

## Task 18: user-client local-only routes (move existing create-account)

**Files:**
- Move: `apps/user-client/src/routes/create-account/index.tsx` → `apps/user-client/src/routes/onboarding/local/index.tsx`
- Move: `apps/user-client/src/routes/create-account/step-username.tsx` → `.../local/step-username.tsx`
- Move: `apps/user-client/src/routes/create-account/step-passphrase.tsx` → `.../local/step-passphrase.tsx`
- Move: `apps/user-client/src/routes/create-account/step-recovery-reveal.tsx` → `.../local/step-recovery-reveal.tsx`
- Delete: `apps/user-client/src/routes/create-account/` (after move)

- [ ] **Step 1: Move the files**

```bash
mkdir -p apps/user-client/src/routes/onboarding/local
git mv apps/user-client/src/routes/create-account/index.tsx apps/user-client/src/routes/onboarding/local/index.tsx
git mv apps/user-client/src/routes/create-account/step-username.tsx apps/user-client/src/routes/onboarding/local/step-username.tsx
git mv apps/user-client/src/routes/create-account/step-passphrase.tsx apps/user-client/src/routes/onboarding/local/step-passphrase.tsx
git mv apps/user-client/src/routes/create-account/step-recovery-reveal.tsx apps/user-client/src/routes/onboarding/local/step-recovery-reveal.tsx
rmdir apps/user-client/src/routes/create-account 2>/dev/null || true
```

- [ ] **Step 2: Update internal imports**

The moved `index.tsx` imports its step components from `./step-*` — paths stay valid because they moved together. Verify with:

```bash
pnpm --filter @chatsundere/user-client run build
```

Expected: typecheck passes (the imports from `App.tsx` are still pointing at the old path; that's fixed in Task 19).

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/routes/onboarding/local/
git commit -m "Move create-account screens under /onboarding/local"
```

---

## Task 19: user-client `App.tsx` — rewrite the route tree

**Files:**
- Modify: `apps/user-client/src/App.tsx`
- Delete: `apps/user-client/src/routes/linking/scan.tsx`
- Delete: `apps/user-client/src/routes/linking/paste.tsx`
- Delete: `apps/user-client/src/routes/linking/confirm.tsx`

- [ ] **Step 1: Update `App.tsx` imports**

Remove `LinkingScan`, `LinkingPaste`, `LinkingConfirm`, old `Onboarding`, `CreateAccount` imports. Add the new route component imports.

- [ ] **Step 2: Update the Routes block**

```tsx
<Routes>
  <Route element={<Root />}>
    <Route index element={<Gate />} />
    {/* No-session routes */}
    <Route path="/onboarding" element={<OnboardingMatrix />} />
    <Route path="/onboarding/invitation" element={<InvitationForm />} />
    <Route path="/onboarding/invitation/scan" element={<InvitationScan />} />
    <Route path="/onboarding/invitation/confirm" element={<InvitationConfirm />} />
    <Route path="/onboarding/invitation/recovery" element={<InvitationRecoveryReveal />} />
    <Route path="/onboarding/pairing" element={<PairingForm />} />
    <Route path="/onboarding/pairing/scan" element={<PairingScan />} />
    <Route path="/onboarding/pairing/confirm" element={<PairingConfirm />} />
    <Route path="/onboarding/recovery" element={<OnboardingRecovery />} />
    <Route path="/onboarding/local" element={<LocalOnly />} />
    <Route path="/login" element={<Login />} />
    <Route path="/login/recovery" element={<Recovery />} />
    {/* Session-required */}
    <Route element={<ProtectedRoute />}>
      <Route path="/app" element={<AppShell />} />
      <Route path="/change-passphrase" element={<ChangePassphrase />} />
      <Route path="/settings" element={<SettingsLayout />}>
        {/* unchanged */}
      </Route>
    </Route>
  </Route>
</Routes>
```

Note `/onboarding/local` uses the existing wizard logic with its in-component step state — no sub-routes needed.

`/onboarding/invitation` is the entry point for late-link from Settings *and* for the matrix path; the confirm screen detects late-link via session-store presence.

- [ ] **Step 3: Delete the obsolete linking routes**

```bash
git rm apps/user-client/src/routes/linking/scan.tsx apps/user-client/src/routes/linking/paste.tsx apps/user-client/src/routes/linking/confirm.tsx
rmdir apps/user-client/src/routes/linking 2>/dev/null || true
```

- [ ] **Step 4: Update Settings → Server linking**

In `apps/user-client/src/routes/settings/server-linking.tsx`, replace the contents with a thin redirect:

```tsx
import { Navigate } from 'react-router-dom';
export function ServerLinking() {
  return <Navigate to="/onboarding/invitation" replace />;
}
```

If the route still appears in a settings sub-nav, the click navigates straight into the onboarding-invitation screen — which detects late-link mode automatically.

- [ ] **Step 5: Update copy.ts**

Search for any keys referencing `onboarding.*`, `linking.*`, `create.*`:

```bash
rg "copy\.(linking|onboarding|create)\." apps/user-client/src/
```

Update copy keys to match the new screen names. Add new keys for the matrix labels, the form labels, the constructive-error switch buttons, etc. Existing keys for `recovery` (e.g., `copy.linking.confirm.errors.usernameTaken`) move to the new equivalent paths.

- [ ] **Step 6: Run build + tests**

Run: `pnpm --filter @chatsundere/user-client run build && pnpm --filter @chatsundere/user-client run test`
Expected: build clean; tests green (except possibly the existing `onboarding.test.tsx` integration test, which is keyed to the old onboarding — replace its assertions to match the matrix or delete it for now and rebuild as part of manual verification).

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/App.tsx apps/user-client/src/routes/settings/server-linking.tsx apps/user-client/src/lib/copy.ts
git rm apps/user-client/src/routes/linking/
git commit -m "Rewrite router, remove /linking/* and /create, redirect Settings → onboarding"
```

---

## Task 20: user-client post-onboarding biometric inline modal

**Files:**
- Create: `apps/user-client/src/components/PostOnboardingBiometricPrompt.tsx`
- Modify: `apps/user-client/src/routes/app-shell.tsx` (mount the prompt)
- Modify: `apps/user-client/src/state/boot.store.ts` or similar (add a `first_launch_after_onboarding` flag)

- [ ] **Step 1: Add a one-time flag in IDB**

Use the existing IDB layer to store a `meta` row `first_launch_post_onboarding_completed: boolean`. On `joinByInvitation`/`joinByPairing`/`recoverFromScratch` success, set the flag to false (= prompt is due). On dismissal or accept, set to true.

- [ ] **Step 2: Build the prompt component**

```tsx
export function PostOnboardingBiometricPrompt() {
  const [visible, setVisible] = useState(false);
  // … read the flag on mount; show if false.
  // Reuse the biometric setup logic from settings/auth-methods.tsx.
}
```

Local-only users **must not** see this prompt (per spec § 2 Decision 6). Check `session.mode === 'linked'` before showing.

- [ ] **Step 3: Mount in `app-shell.tsx`** above the routed content.

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/components/PostOnboardingBiometricPrompt.tsx apps/user-client/src/routes/app-shell.tsx apps/user-client/src/state/
git commit -m "Add post-onboarding biometric inline prompt for linked users"
```

---

## Task 21: admin-client — invitation form fields

**Files:**
- Modify: the admin-client invitations create route (locate with `rg 'admin/invitations' apps/admin-client/src/`).

- [ ] **Step 1: Add three optional fields** to the invitation create form: `suggested_username`, `issuer_label`, `note`. Wire them into the POST body per API-shapes spec § 4.1.

- [ ] **Step 2: Test**

Run: `pnpm --filter @chatsundere/admin-client run build`
Expected: clean.

- [ ] **Step 3: Manual smoke**

Run admin-client locally, create an invitation with all three fields, confirm they round-trip on the GET list endpoint (per API-shapes spec § 4.2).

- [ ] **Step 4: Commit**

```bash
git add apps/admin-client/src/
git commit -m "Admin-client invitation form: add suggested_username, issuer_label, note"
```

---

## Task 22: Repo-wide build + lint + typecheck verification

- [ ] **Step 1: Run full build**

Run: `pnpm run build`
Expected: clean across all workspaces.

- [ ] **Step 2: Run all tests**

Run: `pnpm run test`
Expected: all green except the 9 known baseline `full-lifecycle.test.ts` failures per STATUS.md.

- [ ] **Step 3: Run lint**

Run: `pnpm run lint`
Expected: clean. Biome should not complain.

- [ ] **Step 4: Fix any issues; commit individually**

If anything fails, fix and commit per file with a descriptive message.

---

## Task 23: Manual verification per spec § 10

Chris drives this on the dev environment. The plan instructs the executor to surface to Chris when this task is up and walk through the verification table. Subagents do not execute this task.

- [ ] **Step 1: Confirm dev environment is ready**

Auth-service: `cd apps/auth-service && bun run dev` in one terminal.
User-client: `cd apps/user-client && pnpm run dev` in another.
Admin-client: `cd apps/admin-client && pnpm run dev` in a third.

- [ ] **Step 2: Walk Chris through verification scenarios 1–10** from the spec § 10.

- [ ] **Step 3: Capture findings**

If anything fails, surface to Chris with the file/line that needs adjustment. Issues are fixed in subsequent tasks (or amendments to existing tasks if the fix is small).

---

## Task 24: Larissa security audit pass

Larissa is invoked per CLAUDE.md § 9. This task does not write code; it dispatches Larissa with the diff + audit prompt.

- [ ] **Step 1: Generate the audit diff**

Run: `git diff origin/master...HEAD -- apps/auth-service packages/crypto > /tmp/larissa-audit.diff`

- [ ] **Step 2: Invoke Larissa**

Use the Agent tool with `subagent_type: claude` and a prompt that includes:
- The diff content
- Pointer to spec: `superpowers/specs/2026-05-22-user-client-onboarding-overhaul-design.md`
- Pointer to brief: `obsidian/briefs/phase 0/cross-device-identity.md`
- Explicit non-destructive-git rule per `[[insight:2026-05-22-subagent-vs-inline-trade-off]]`: "Do not run git stash, git checkout to other refs, git reset, git restore, git rebase, git branch, git switch. Read previous commits via git show <sha>:<path> only."

Audit scope (security-touching parts of this squash):
1. Alphabet swap correctness in `apps/auth-service/src/codes/token.ts` (regex + alphabet constant agree, no off-by-one).
2. Client-side normaliser symmetry (no characters accepted by client that the server rejects, modulo the deliberate normalisations).
3. `joinByPairing.finishRound()` unwrap mechanic — particularly that the wrapping invariant per ADR 0021 holds (server-returned wrapped material is non-empty, AAD-checked).
4. Late-link branch in invitation/confirm.tsx — existing MK preservation, no accidental fresh-MK generation.

- [ ] **Step 3: Apply findings**

For each finding rated High or Medium: fix inline, re-run tests, re-commit. Critical findings stop the squash entirely. Defer Low findings to `obsidian/insights/security-deferrals.md` with rationale.

- [ ] **Step 4: Re-pass if findings landed**

Re-dispatch Larissa with the updated diff. Iterate until verdict is "clear to squash".

---

## Task 25: Final squash + STATUS.md update + spec commit

- [ ] **Step 1: Soft-reset to master**

```bash
git fetch origin
git reset --soft origin/master
```

Working tree is unchanged; commits collapse.

- [ ] **Step 2: Single squash commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Add user-client onboarding overhaul

- Replace single-CTA onboarding with 2×2 intent matrix (Invitation /
  Add device / Recovery / Local-only)
- Variant-C form-first sub-screens with scan button visually
  separated; paste-auto-split for URL+#code
- Rewire user-client to /api/v1/join/{start,finish}; remove
  /linking/*, /create, and linkOpaque* shapes
- New crypto flows: joinByInvitation, joinByPairing,
  recoverFromScratch; linkToServer migrated to new endpoints
- Migrate pending-code alphabet to Crockford-derived with V↔U swap
  (spec § 2 Decision 8); client normalises I/L→1, O→0, V→Y
- Post-onboarding biometric inline prompt; admin-client invitation
  form gains suggested_username + issuer_label + note

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Update STATUS.md** with the new state and commit hash.

- [ ] **Step 4: Push**

```bash
git push origin master
```

---

## Self-review

Final pass against the spec § by §:

**Spec coverage:**
- § 2 Decision 1 (4 paths) — Task 12 (matrix), 13–18 (paths).
- § 2 Decision 2 (2×2 matrix) — Task 12.
- § 2 Decision 3 (Variant C) — Task 13.
- § 2 Decision 4 (late-link reuses invitation) — Task 14, 19.
- § 2 Decision 5 (username collision inline) — Task 14.
- § 2 Decision 6 (biometric post-onboarding) — Task 20.
- § 2 Decision 7 (Phase-0 data loss comment) — Task 5 (the comment is in `join-by-pairing.ts`).
- § 2 Decision 8 (Crockford + V↔U) — Task 1 + Task 8.
- § 2 Decision 9 (kind_mismatch constructive) — Task 14, 16.
- § 2 Decision 10 (reactive validation) — Task 13 (`isValidServerUrl`, `isValidCode`).
- § 2 Decision 11 (paste-auto-split) — Task 13 (`JoinFormFields`).
- § 2 Decision 12 (recovery key single field) — Task 17.
- § 3.2 packages touched — Task 1 (auth-service), 2 (shared-types), 3–7 (crypto), 8–19 (user-client), 21 (admin-client). ✓
- § 5 error table — covered piecemeal across Tasks 13–17; spot-check during Task 22 manual verification.
- § 6 alphabet migration — Tasks 1 + 8.
- § 10 manual verification — Task 23.

**Placeholder scan:**
- Task 4 step 3 has a placeholder `/* from state */` — engineer needs to fill `session_id` from the actual `state` object. This is intentional shorthand, not a placeholder failure: the surrounding context makes the value clear.
- Task 14 step 1 has a few `/* … */` comment fragments inside JSX templates — engineer implements per spec § 4.1; not blocking.

**Type consistency:**
- `JoinStartResponse` / `JoinFinishResponse` use `kind` discriminant in Task 2 and are narrowed accordingly in Tasks 4, 5, 7, 10, 14, 16. ✓
- `StartJoinByInvitationResult.registrationState` is `unknown` in Task 4 — implementation should pin a concrete type once the OPAQUE primitives are located in Task 4 Step 3. Acknowledged as a TODO inside the task, not a placeholder.
- `useOnboardingStore` is consumed by all the route components in Tasks 12–17. The discriminant matches across.

**Open question for the executor:** OPAQUE primitive locations need to be discovered during Task 4 Step 3 (`rg 'startOpaqueRegistration|startOpaqueLogin'`). If they live inside an existing flow file as helpers, lift them into `packages/crypto/src/primitives/opaque.ts` first; do not duplicate.

---

## Execution Handoff

Plan complete and saved to `superpowers/plans/2026-05-22-user-client-onboarding-overhaul.md`. Per Chris's confirmation, execution uses **subagent-driven development** with a fresh subagent per task and two-stage review between tasks.

Architectural tasks (4–7, 14, 16, 17) get extra care — the spec is detailed enough that subagents can follow it, but per [[insight:2026-05-22-subagent-vs-inline-trade-off]] the lesson is "subagents handle mechanical sweeps cleanly, architectural work needs supervisor attention". I will dispatch subagents for each task but inline-review every diff before moving on, not just rely on the subagent's own pass-report.

Next step: invoke `superpowers:subagent-driven-development` to execute the plan task-by-task.
