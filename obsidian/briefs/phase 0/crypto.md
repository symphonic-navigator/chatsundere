# Chatsundere — Crypto Module Briefing

**For:** Liz (implementation)
**From:** Lyra (architecture) + Chris (vision)
**Package:** `packages/crypto` (`@chatsundere/crypto`)
**License:** LGPLv3
**Date:** 2026-05-18

---

## Purpose

`@chatsundere/crypto` is the client-side cryptographic foundation of
Chatsundere. It encapsulates all key management, OPAQUE client
operations, WebAuthn PRF handling, master key wrapping, and DEK
derivation. Other client-side packages (user-client, admin-client)
consume this library; they never touch raw crypto APIs.

Server-side code MUST NOT depend on this package. The package is
intentionally client-only and has no symmetric counterpart on the server.

## Hard Guarantees

1. The library NEVER sends plaintext keys, passphrases, or recovery
   keys anywhere. All network operations happen through callbacks
   provided by the consumer; the library returns blobs.
2. The library NEVER persists keys to disk on its own. The consumer
   decides persistence (e.g., wrapped MK in IndexedDB encrypted with
   session AMK is fine; MK or AMK in plaintext storage is forbidden).
3. The library uses WebCrypto SubtleCrypto for all primitive ops
   (AES-GCM, HKDF, SHA-256). The only WASM dependency is OPAQUE.
4. The library zeroes out key buffers when sessions end (best-effort
   in JS; documented limitation).

## Dependencies

- `@serenity-kit/opaque` — OPAQUE client implementation
- WebCrypto API (built-in to browser and Bun)
- `@simplewebauthn/browser` — WebAuthn client helpers (used by consumer,
  but we export thin wrappers)

NO direct crypto-js, sjcl, or similar. WebCrypto only.

## Public API

The library exports several "sessions" and operations. Sessions encapsulate
the master key and provide methods for derived operations.

### Module exports

```typescript
// @chatsundere/crypto

// Algorithm constants (versioned for future migration)
export const ALGO_VERSION = 'v1';
export const WRAP_ALGO = 'AES-256-GCM';
export const HKDF_HASH = 'SHA-256';

// Branded types for safety
export type MasterKey = Uint8Array & { readonly __brand: 'MasterKey' };
export type AMK = Uint8Array & { readonly __brand: 'AMK' };
export type DEK = Uint8Array & { readonly __brand: 'DEK' };
export type RecoveryKey = Uint8Array & { readonly __brand: 'RecoveryKey' };

// Wire shapes for server interaction
export interface WrappedKey {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  algo: string;  // 'AES-256-GCM'
}

export interface KdfParams {
  algo: 'hkdf-sha256';
  info: string;
}
```

### Registration flow

```typescript
// Step 1: generate a fresh MK, wrap it with the AMK derived from auth method
export async function generateMasterKey(): Promise<MasterKey>;

export async function generateRecoveryKey(): Promise<RecoveryKey>;

export function recoveryKeyToBase32(key: RecoveryKey): string;
// Returns Crockford-base32 with 4-char groups, e.g.:
// "K7QW-9X4P-2NM3-..." (24 chars + dashes)

export function recoveryKeyFromBase32(s: string): RecoveryKey;
// Tolerates dashes/spaces/lowercase; validates checksum.

// Step 2: derive AMK from auth method
export async function deriveAmkFromOpaqueExportKey(
  exportKey: Uint8Array
): Promise<AMK>;

export async function deriveAmkFromPrfOutput(
  prfOutput: Uint8Array
): Promise<AMK>;

export async function deriveAmkFromRecoveryKey(
  rk: RecoveryKey
): Promise<AMK>;

// Step 3: wrap the MK with the AMK
export async function wrapMasterKey(
  mk: MasterKey,
  amk: AMK
): Promise<WrappedKey>;

// Step 4: also derive proof-of-MK (for recovery flow server-side proof)
export async function deriveMkProofValue(mk: MasterKey): Promise<Uint8Array>;
// = HMAC-SHA256(MK, 'chatsundere-mk-proof-v1')
// Sent to server once at registration, used later to verify recovery unwrap.
```

### OPAQUE client wrapper

Wraps `@serenity-kit/opaque` with our types.

```typescript
export interface OpaqueClientRegistration {
  startRegistration(passphrase: string): {
    state: Uint8Array;  // opaque blob to keep in memory
    request: Uint8Array;  // base64url-encoded, send to server
  };
  
  finishRegistration(args: {
    state: Uint8Array;
    response: Uint8Array;  // from server
    username: string;
    serverIdentity: string;  // typically the auth service URL
  }): {
    record: Uint8Array;  // send to server as registration_record
    exportKey: Uint8Array;  // KEEP IN MEMORY, used to derive AMK
  };
}

export interface OpaqueClientLogin {
  startLogin(passphrase: string): {
    state: Uint8Array;
    ke1: Uint8Array;  // send to server
  };
  
  finishLogin(args: {
    state: Uint8Array;
    ke2: Uint8Array;  // from server
    username: string;
    serverIdentity: string;
  }): {
    ke3: Uint8Array;  // send to server
    exportKey: Uint8Array;
    sessionKey: Uint8Array;  // shared secret with server; we don't typically use this directly
  };
}

export function createOpaqueClient(): {
  registration: OpaqueClientRegistration;
  login: OpaqueClientLogin;
};
```

### Login flow

```typescript
// Unwrap a stored wrapped master key
export async function unwrapMasterKey(
  wrapped: WrappedKey,
  amk: AMK
): Promise<MasterKey>;
// Throws CryptoError if GCM auth tag fails (wrong AMK / corrupted).
```

### Master Key Session

After successful login, consumer holds a `MasterKeySession`. This is the
gateway to all derived operations.

```typescript
export interface MasterKeySession {
  readonly id: string;  // session ID for logging
  readonly userId: string;
  
  // Derive a DEK for a specific purpose / context
  deriveDek(context: string): Promise<DEK>;
  // = HKDF(MK, salt=empty, info=`chatsundere-dek-v1::${context}`)
  // Context examples: `vault/conversations`, `vault/personas`, `prefs`
  
  // Encrypt/decrypt with a derived DEK
  encrypt(plaintext: Uint8Array, context: string): Promise<{
    ciphertext: Uint8Array;
    nonce: Uint8Array;
  }>;
  
  decrypt(args: {
    ciphertext: Uint8Array;
    nonce: Uint8Array;
    context: string;
  }): Promise<Uint8Array>;
  
  // Re-wrap MK with a new AMK (used during password change, add passkey)
  rewrapWithAmk(newAmk: AMK): Promise<WrappedKey>;
  
  // Produce proof-of-knowledge for recovery flow
  produceProofValue(): Promise<Uint8Array>;
  
  // Explicitly close the session and zero buffers
  close(): void;
}

export function createMasterKeySession(args: {
  userId: string;
  mk: MasterKey;
}): MasterKeySession;
```

### Conveniences

```typescript
// Most consumers use these high-level helpers rather than the primitives.

export async function registerWithPassphrase(args: {
  username: string;
  passphrase: string;
  invitationToken: string;
  serverIdentity: string;
  // Callbacks to talk to server
  callOpaqueRegisterStart(req: {
    invitation_token: string;
    registration_request: string;
  }): Promise<{ registration_response: string }>;
  callOpaqueRegisterFinish(req: {
    invitation_token: string;
    registration_record: string;
    wrapped_master_key: string;
    wrap_nonce: string;
    recovery_key_wrapped_master_key: string;
    recovery_key_wrap_nonce: string;
    mk_proof_value: string;
  }): Promise<{ user_id: string; access_token: string; refresh_token: string }>;
}): Promise<{
  userId: string;
  recoveryKey: string;  // base32-encoded; SHOW USER ONCE
  session: MasterKeySession;
  accessToken: string;
  refreshToken: string;
}>;

export async function loginWithPassphrase(args: {
  username: string;
  passphrase: string;
  serverIdentity: string;
  callOpaqueLoginStart(req: { username: string; ke1: string }): Promise<{
    ke2: string;
    wrapped_master_key: string;
    wrap_nonce: string;
  }>;
  callOpaqueLoginFinish(req: { username: string; ke3: string }): Promise<{
    user_id: string;
    role: string;
    access_token: string;
    refresh_token: string;
  }>;
}): Promise<{
  userId: string;
  role: string;
  session: MasterKeySession;
  accessToken: string;
  refreshToken: string;
}>;

// Analogous helpers for passkey and recovery flows
export async function registerWithPasskey(args: {...}): Promise<{...}>;
export async function loginWithPasskey(args: {...}): Promise<{...}>;
export async function loginWithRecoveryKey(args: {...}): Promise<{...}>;
```

## Error Handling

```typescript
export class CryptoError extends Error {
  constructor(public code: CryptoErrorCode, message: string) {
    super(message);
  }
}

export type CryptoErrorCode =
  | 'wrong_passphrase'        // OPAQUE login failed or wrap auth tag mismatch
  | 'wrong_recovery_key'      // recovery key didn't unwrap
  | 'passkey_not_available'   // WebAuthn not supported
  | 'prf_not_supported'       // PRF extension absent
  | 'corrupted_data'          // wrapped key or nonce malformed
  | 'expired_state'           // OPAQUE state was lost (e.g., page refresh)
  | 'invalid_recovery_key_format'
  | 'internal';
```

Never include cryptographic material in error messages.

## PRF Handling Details

WebCrypto PRF gives us a 32-byte output deterministically for the same
authenticator + same input salt. Salt is fixed application-wide:

```typescript
const PRF_INPUT_SALT = new TextEncoder().encode('chatsundere-mk-derivation-v1');
```

Hash that to a 32-byte value for use as PRF input (SHA-256). This is
the value passed in `extensions.prf.eval.first` during WebAuthn calls.

If a passkey doesn't support PRF (older platforms), `passkey_prf_supported`
is false in the auth_method record. **In that case, that passkey cannot
wrap the MK.** We need to handle this:

**Option A: Refuse to register PRF-less passkeys.**

- Pro: clean architecture
- Con: excludes users on older platforms

**Option B: PRF-less passkey only for auth, not for MK.**

- Then the user MUST also have a passphrase or another PRF-passkey for
  data access. Passkey only gets them a JWT but doesn't unwrap MK.
- This means at registration time we'd skip the wrap_master_key fields.

**Chris's call: Option A for now.** Phase 0 requires PRF support. If
this excludes users, we revisit. Document this clearly in UI: "Your
device doesn't support secure key derivation. Use a passphrase instead."

## Implementation Notes

### Buffer zeroing

When a session closes:

```typescript
function zeroBuffer(buf: Uint8Array) {
  for (let i = 0; i < buf.length; i++) buf[i] = 0;
}
```

We can't truly guarantee zeroing (GC, copies), but best-effort matters.

### Constant-time operations

Don't use `===` to compare secrets. Use:

```typescript
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
```

(WebCrypto authenticated decryption gives us this for free for AES-GCM.)

### Base encoding

Use `Uint8Array <-> base64url` helpers (no padding). A small util:

```typescript
export function toBase64Url(bytes: Uint8Array): string { ... }
export function fromBase64Url(s: string): Uint8Array { ... }
```

For recovery key: Crockford base32 (case-insensitive, no `O`/`I`/`L`).
With 4-char groups and a checksum char at the end. 32 bytes → 26 chars
without dashes, format as `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX`.

### Where things live in the client

- The MasterKeySession lives in memory only (JS heap).
- The access token lives in memory only.
- The refresh token lives in an HTTP-only cookie (handled by browser).
- Wrapped MK, KDF params, mk_proof_value never need to live in the
  client at all — they're on the server, fetched at login.

For multi-tab support: each tab has its own session. BroadcastChannel
can be used by the consumer to sync logout across tabs, but the library
itself doesn't do this.

## Testing

- Unit tests for every primitive: `wrapMasterKey`, `unwrapMasterKey`,
  `deriveAmk*`, `deriveDek`, encrypt/decrypt round-trip.
- Test vectors: a few hardcoded (passphrase, salt, expected AMK)
  triples to catch unintended changes.
- Cross-platform tests: same library code runs in browser (via Vitest
  with happy-dom) and in Bun (for server-side things like wrapping
  the bootstrap admin's recovery key during CLI).
- Property tests for: wrap-then-unwrap is identity; tamper with nonce
  causes auth failure; tamper with ciphertext causes auth failure.

## What Liz Should NOT Do

- Don't add any crypto algorithm not listed here without architecture
  review. The set is small and chosen deliberately.
- Don't add "convenience" methods that take passphrases and store them.
- Don't log keys, exportKeys, sessionKeys, or anything bytewise-related
  to secrets. Pino redact paths if anything sensitive could leak.
- Don't add server-side capability to this package. If something needs
  a server counterpart, put it in `apps/auth-service` directly.

## Phase 0 Deliverables

1. All primitives implemented: wrap/unwrap, AMK derivation (all three
   sources), DEK derivation, encrypt/decrypt.
2. OPAQUE client wrapper around @serenity-kit/opaque.
3. Recovery key generation + base32 encoding/decoding.
4. High-level `registerWith*` and `loginWith*` helpers.
5. MasterKeySession with all methods.
6. CryptoError class and meaningful error codes.
7. Unit + integration test coverage > 90% for crypto module.
8. SECURITY.md in the package directory explaining threat model.

## Phase 1 Additions

- Helpers for stream-encrypting larger payloads (chunked AES-GCM)
- Helpers for content-addressed storage (hash-as-key patterns)
- DEK rotation utilities

## Open Question for Chris/Lyra

Q: Should the library expose a way to **derive a deterministic ID
from a secret** (e.g., to namespace blobs in the vault without
revealing names)? Useful for sync-service URL paths. Defer to Phase 1.
