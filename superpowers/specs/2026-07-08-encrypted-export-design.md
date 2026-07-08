# Encrypted transfer packs — optional password encryption (design)

## 1. Why

Several field users asked for password protection on their exports. A persona or
knowledge-library pack today is plaintext inside a gzip tarball; anyone who
obtains the file can read the whole conversation history, memory, and documents.
We add an **optional** password-encryption layer so a user can protect an export
before it leaves the device, and supply the password again on import.

The feature is a thin **outer shell** around the existing transfer packs. The
plaintext path is unchanged, byte for byte; encryption is off by default on both
export surfaces so the fast, uncritical export stays a single tap.

## 2. Guiding principles (settled with Chris)

- **Standalone password, never account-bound.** Import is create-new-only and
  must work on a fresh device with no account, so the export password cannot hang
  off the account master key. It is a freely chosen, self-contained secret,
  KDF-stretched into a data key.
- **No recovery.** Password lost = file lost, exactly as everywhere else in
  Chatsundere. We guard the one irreversible failure mode — a typo — with a
  confirmation field, and warn plainly. We do **not** impose complexity rules
  (anti-paternalism; consistent with the product's freedom stance).
- **Default off, both surfaces.** Encryption is opt-in on persona *and* library
  export.
- **Deliberately small.** One shell, no restructuring of the pack writers,
  readers, or the import determinism core.

## 3. Container format

The encrypted container is the **same gzip tarball envelope as today**, so the
existing `readManifestFormat` peek works unchanged and simply sees a new format
value. Two entries:

- `manifest.json` — `format: "chatsundere/encrypted"`, plus:
  - `enclosedFormat`: `"chatsundere/persona"` | `"chatsundere/knowledge"`
  - `algoVersion`: `"v1"`
  - `kdf`: `{ name: "argon2id", salt (base64url), memorySizeKiB, iterations, parallelism, hashLength }`
  - `nonce`: base64url (12 bytes, AES-GCM)
  - `integrityHmac`: base64url (the house-convention HMAC over the sealed bundle)
- `payload.bin` — the **encrypted inner pack**: the ciphertext of the complete,
  unmodified gzip-tar produced by `writePersonaPack` / `writeKnowledgePack`.

The inner pack's own gzip is kept (encrypting already-compressed bytes; the outer
gzip over ciphertext is a size no-op but keeps a single read/write code path).

### Backward compatibility (hard requirement)

Exports produced by **v0.1.3** (and any earlier plaintext pack) carry
`format: "chatsundere/persona"` / `"chatsundere/knowledge"` and **no encryption
fields**. They must keep importing exactly as today. This is inherent to the
design — we only *add* the `chatsundere/encrypted` branch; the two existing
formats and their import path are byte-unchanged. "Encryption info absent" ⇒
plaintext ⇒ existing path, never an error. The single obligation on the
implementation: the encryption metadata (`kdf`, `nonce`, `integrityHmac`,
`enclosedFormat`) is present **only** on the `chatsundere/encrypted` manifest and
is never made required on the persona/knowledge manifests, so an old manifest
that lacks it still parses. Pinned by a test (§7) and manual verification (§10).

Filename when encrypted: `<slug>-chatsundere-encrypted.tar.gz` (the `-encrypted`
marker signals it to the user in the downloads folder). Plaintext exports keep
`<slug>-chatsundere.tar.gz`.

Argon2 params are stored in the manifest so a later cost bump (which requires an
ADR per `packages/crypto` convention) can still decrypt older exports —
forward-compatibility.

## 4. Crypto flow (`packages/crypto/src/export/`)

A new first-class flow module, mirroring `flows/create-local-account.ts`,
composed entirely from existing primitives (no new primitive, no new algorithm):

```
salt   = getRandomBytes(ARGON2ID_PARAMS.saltLength)          // 16 bytes
stretch = argon2id(password, salt, ARGON2ID_PARAMS)          // hash-wasm
key    = hkdfSha256(stretch, salt, "chatsundere-export-v1")  // 32-byte data key
sealed = aeadEncrypt(key, packBytes, aad)                    // AES-256-GCM, random nonce
sealed = addIntegrityHmac(sealed, deriveIntegrityKey(key))   // house convention
```

- `aad = utf8("chatsundere-export-v1::" + enclosedFormat)` — binds version and
  enclosed type into the GCM tag, preventing metadata swaps.
- The GCM tag alone already authenticates; we add `addIntegrityHmac` to stay
  consistent with every other sealed bundle in the codebase and to match
  Larissa's expectations. Wrong password → wrong key → HMAC verify fails
  (constant-time) → mapped to a "wrong password" outcome.

Public surface (re-exported from `packages/crypto/src/index.ts`):

- `encryptExportPack(password: string, packBytes: Uint8Array, enclosedFormat: EnclosedFormat): Promise<EncryptedContainer>`
- `decryptExportPack(password: string, container: EncryptedContainer): Promise<Uint8Array>` — throws `CryptoError('wrong_password')` (new code) on key/HMAC failure, `CryptoError('corrupted_data')` on tamper.

`EncryptedContainer` = the manifest metadata (§3) + `payload` bytes; the
tar (un)packing of that container lives in the user-client transfer layer, not in
`packages/crypto` (crypto stays file-format-agnostic — it takes and returns
bytes). The password is never persisted; it is held transiently for the single
operation only.

## 5. Transfer layer wiring (`apps/user-client/src/lib/chatsundere-transfer/`)

- New `encrypted-container.ts`: `wrapEncrypted(container): Promise<Blob>` (build
  the outer gzip-tar from manifest + `payload.bin`) and
  `readEncryptedContainer(blob): Promise<EncryptedContainer>` (peek + parse). The
  manifest metadata is what `detectArchiveFormat` already reads.
- `manifest.ts`: add `chatsundere/encrypted` to the format discriminator and the
  `EncryptedManifest` interface.
- `import-detect.ts` / `detectArchiveFormat`: recognise `chatsundere/encrypted`.

### Export (`apps/user-client/src/data/chatsundere-export.ts`)

`exportPersona` / `exportLibrary` gain an optional `password?: string` parameter.
When present: produce the pack Blob as today → read its bytes →
`encryptExportPack` → `wrapEncrypted` → return the encrypted Blob. When absent:
unchanged.

### Import (`apps/user-client/src/data/chatsundere-import.ts` + hosts)

The import hosts (`ChatsuneImportControl.tsx`, `knowledge.tsx`) already call
`readManifestFormat` and branch. New branch: `chatsundere/encrypted` →

1. Prompt for the password (shared UI, §6).
2. `readEncryptedContainer` → `decryptExportPack` → inner pack `Uint8Array`.
3. On `wrong_password`: surface the constructive error (§6), keep the entered
   password, do not close the flow.
4. On success: wrap the decrypted bytes as a Blob → run the **existing**
   `readManifestFormat` on it → branch to `importPersonaPack` /
   `importKnowledgePack` exactly as today. No change to the import determinism
   core, id-remap, or collision handling.

## 6. UI / entry points

A shared **`EncryptExportSection`** component (`components/transfer/`):

- Checkbox "Encrypt with a password" — **default off**. Ticking it reveals a
  password field, a confirmation field, and a plain no-recovery note ("If you
  lose this password, the file cannot be opened — there is no recovery.").
- Confirmation ≠ password → the export action is disabled with a visible reason.
- No complexity rules.

Placement:

- **Persona export** — added as a fourth option below the three existing switches
  in `ExportOverlay.tsx`. `handleExport` passes the password through to
  `exportPersona`.
- **Library export** — today a direct one-tap download in
  `routes/app/knowledge/library.tsx`. Gains a small, matching **export overlay**
  hosting only `EncryptExportSection`. Nothing ticked → one tap "Export", as
  before.

A shared **`DecryptPromptOverlay`** (or the same section in single-field mode)
for import: one password field + the constructive wrong-password error, input
preserved.

## 7. Testing

- `packages/crypto` unit (`bun test`): encrypt→decrypt round-trip; wrong password
  → `wrong_password`; tampered ciphertext/nonce/salt → failure; stored-params
  forward-compat (decrypt a fixture sealed with explicit params).
- user-client integration (`vitest`): persona and library **encrypted**
  export → import round-trip (reuse the existing pill/artefact full-fidelity
  round-trip fixture, run through the encrypted shell); wrong-password path keeps
  input and surfaces the message; plaintext path unchanged.
- **Backward compatibility**: a plaintext pack fixture with a v0.1.3-shaped
  manifest (persona and knowledge, no encryption fields) imports through the
  unchanged path — asserts detection returns the plaintext format and never
  demands encryption metadata.
- Component: `EncryptExportSection` confirm-mismatch disables the action with a
  reason; default-off state.

## 8. Audit gates

- **Larissa** (mandatory — `packages/crypto` path): the new export flow, AAD
  binding, KDF param handling, wrong-password mapping, no-secret-leak (password
  never persisted/logged).
- **Laura** (user-reachable flow change): the encrypt option on both export
  surfaces and the import password prompt; the no-recovery communication and the
  constructive wrong-password path.

## 9. Out of scope

- The legacy Chatsune bridge import/export (predecessor format) — our own packs
  only.
- Encrypting at-rest local Dexie data (already covered by the account crypto
  domain; unrelated).
- Any server involvement (client-only feature).
- Key-file / recovery-code alternatives to a typed password.

## 10. Manual verification (Chris, on device)

1. Export a persona with "Encrypt with a password" **off** → file is
   `…-chatsundere.tar.gz`, imports exactly as today.
2. Export the same persona with encryption **on**, set a password + confirm →
   file is `…-chatsundere-encrypted.tar.gz`.
3. On a fresh client, import it → password prompt → correct password → history,
   reasoning, memory, avatar, pills/tool-calls all present.
4. Import again with a **wrong** password → constructive "wrong password"
   message, the field keeps what was typed, no dead-end; correct password then
   succeeds.
5. Repeat 2–4 for a knowledge **library** (vectors adopt on the correct password).
6. Confirm the confirmation-field mismatch disables "Export" with a visible
   reason.
7. **Backward compatibility**: import an actual export produced by the live
   **v0.1.3** client (persona and library, no encryption) → imports exactly as
   before, no password prompt.

## 11. Open questions

None outstanding — design settled with Chris 2026-07-08.
