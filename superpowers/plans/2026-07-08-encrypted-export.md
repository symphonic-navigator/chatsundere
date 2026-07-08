# Encrypted transfer packs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execute in a dedicated git worktree (CLAUDE.md §8) — the main tree stays on `master`.

**Goal:** Add optional, password-based encryption to persona and knowledge-library transfer packs, decryptable on import.

**Architecture:** A thin outer shell. `writePersonaPack` / `writeKnowledgePack` are untouched; when a password is supplied, their plaintext gzip-tar output is encrypted (Argon2id → HKDF → AES-256-GCM, house `aeadEncrypt` + `addIntegrityHmac`) into an `EncryptedContainer`, then packed into the **same** gzip-tar envelope with `manifest.json` (`format: "chatsundere/encrypted"` + KDF metadata) and `payload.bin` (ciphertext). Import detects the new format, prompts for the password, decrypts to the inner pack Blob, and re-runs the **existing** import path on it.

**Tech Stack:** TypeScript (strict), `@chatsundere/crypto` (Argon2id via hash-wasm, WebCrypto AES-GCM/HKDF/HMAC), React 18, the existing `chatsundere-transfer` tar writer/reader. Crypto tests via `bun test`; user-client tests via Vitest.

## Global Constraints

- **British English** in every artefact — code, comments, JSDoc, copy, commit messages.
- **TS strict + `noUncheckedIndexedAccess`.** No `any` without an inline justification comment. No non-null `!` (Biome bans it).
- **Every package-public function carries a one-line JSDoc.**
- **Standalone password** — never derived from the account master key.
- **Default off on both export surfaces.** Nothing ticked ⇒ one-tap plaintext export, byte-for-byte as today.
- **Backward compatibility (hard):** v0.1.3 plaintext packs (`chatsundere/persona` / `chatsundere/knowledge`, no encryption fields) must import unchanged. Encryption metadata lives **only** on the `chatsundere/encrypted` manifest and is never required on persona/knowledge manifests.
- **Crypto is a Larissa path** (`packages/crypto`); **the export/import UI is a Laura path**. Both audit before squash.
- Argon2id params come from the exported `ARGON2ID_PARAMS`; bumping them requires an ADR.
- Commit style: imperative subject, `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`.

---

### Task 1: Crypto — encrypt/decrypt an export pack

**Files:**
- Create: `packages/crypto/src/export/encrypt-export.ts`
- Modify: `packages/crypto/src/errors.ts` (add `'wrong_password'` code)
- Modify: `packages/crypto/src/index.ts` (re-exports)
- Test: `packages/crypto/tests/export.test.ts`

**Interfaces:**
- Consumes: `argon2id`, `hkdfSha256` (`../primitives/kdf.js`); `aeadEncrypt`, `aeadDecrypt` (`../primitives/aead.js`); `deriveIntegrityKey`, `addIntegrityHmac`, `verifyIntegrityHmac` (`../primitives/integrity.js`); `getRandomBytes` (`../primitives/random.js`); `toBase64Url`, `fromBase64Url` (`../encoding/base64url.js`); `ALGO_VERSION`, `ARGON2ID_PARAMS`, `WRAP_ALGO`, `asAmk`, `AMK` (`../types.js`); `CryptoError` (`../errors.js`).
- Produces: `encryptExportPack(password: string, packBytes: Uint8Array, enclosedFormat: EnclosedFormat): Promise<EncryptedContainer>`; `decryptExportPack(password: string, container: EncryptedContainer): Promise<Uint8Array>`; types `EnclosedFormat`, `ExportKdfParams`, `EncryptedContainer`.

- [ ] **Step 1: Write the failing test** — `packages/crypto/tests/export.test.ts`

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { CryptoError } from '../src/errors.js';
import {
  type EncryptedContainer,
  decryptExportPack,
  encryptExportPack,
} from '../src/export/encrypt-export.js';

const inner = new TextEncoder().encode('the inner pack bytes — pretend gzip');

describe('encryptExportPack / decryptExportPack', () => {
  test('round-trips under the correct password', async () => {
    const c = await encryptExportPack('correct horse', inner, 'chatsundere/persona');
    const out = await decryptExportPack('correct horse', c);
    expect(new TextDecoder().decode(out)).toBe('the inner pack bytes — pretend gzip');
  });

  test('wrong password throws wrong_password', async () => {
    const c = await encryptExportPack('right', inner, 'chatsundere/knowledge');
    await expect(decryptExportPack('wrong', c)).rejects.toMatchObject({ code: 'wrong_password' });
  });

  test('tampered ciphertext is rejected', async () => {
    const c = await encryptExportPack('pw', inner, 'chatsundere/persona');
    c.payload[0] = (c.payload[0] ?? 0) ^ 0xff;
    await expect(decryptExportPack('pw', c)).rejects.toBeInstanceOf(CryptoError);
  });

  test('enclosedFormat is bound into the tag', async () => {
    const c = await encryptExportPack('pw', inner, 'chatsundere/persona');
    const swapped: EncryptedContainer = { ...c, enclosedFormat: 'chatsundere/knowledge' };
    await expect(decryptExportPack('pw', swapped)).rejects.toBeInstanceOf(CryptoError);
  });

  test('kdf params are stored and sufficient to decrypt', async () => {
    const c = await encryptExportPack('pw', inner, 'chatsundere/persona');
    expect(c.kdf.name).toBe('argon2id');
    expect(c.kdf.memorySizeKiB).toBeGreaterThan(0);
    expect(await decryptExportPack('pw', c)).toEqual(inner);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/crypto && bun test tests/export.test.ts`
Expected: FAIL — cannot resolve `../src/export/encrypt-export.js`.

- [ ] **Step 3: Add the `wrong_password` error code**

In `packages/crypto/src/errors.ts`, add `'wrong_password'` to the `CryptoErrorCode` union (place it after `'wrong_passphrase'`):

```ts
export type CryptoErrorCode =
  | 'wrong_passphrase'
  | 'wrong_password'
  | 'wrong_recovery_key'
  // …rest unchanged…
```

- [ ] **Step 4: Write the implementation** — `packages/crypto/src/export/encrypt-export.ts`

```ts
// SPDX-License-Identifier: LGPL-3.0-only

import { fromBase64Url, toBase64Url } from '../encoding/base64url.js';
import { CryptoError } from '../errors.js';
import { aeadDecrypt, aeadEncrypt } from '../primitives/aead.js';
import {
  addIntegrityHmac,
  deriveIntegrityKey,
  verifyIntegrityHmac,
} from '../primitives/integrity.js';
import { argon2id, hkdfSha256 } from '../primitives/kdf.js';
import { getRandomBytes } from '../primitives/random.js';
import { ALGO_VERSION, ARGON2ID_PARAMS, type AMK, WRAP_ALGO, asAmk } from '../types.js';

/** Which kind of transfer pack the ciphertext encloses. */
export type EnclosedFormat = 'chatsundere/persona' | 'chatsundere/knowledge';

/** Argon2id parameters stored with the container so a future cost bump can still decrypt old files. */
export interface ExportKdfParams {
  readonly name: 'argon2id';
  readonly salt: string; // base64url
  readonly memorySizeKiB: number;
  readonly iterations: number;
  readonly parallelism: number;
  readonly hashLength: number;
}

/** A password-encrypted transfer pack: metadata plus the AES-256-GCM ciphertext. */
export interface EncryptedContainer {
  readonly algoVersion: string;
  readonly enclosedFormat: EnclosedFormat;
  readonly kdf: ExportKdfParams;
  readonly nonce: string; // base64url
  readonly integrityHmac: string; // base64url
  readonly payload: Uint8Array; // ciphertext
}

const EXPORT_INFO = 'chatsundere-export-v1';

function exportAad(enclosedFormat: EnclosedFormat): Uint8Array {
  return new TextEncoder().encode(`${EXPORT_INFO}::${enclosedFormat}`);
}

async function deriveExportKey(password: string, salt: Uint8Array): Promise<AMK> {
  const stretched = await argon2id(password, salt, ARGON2ID_PARAMS);
  return asAmk(await hkdfSha256(stretched, salt, EXPORT_INFO));
}

/**
 * Encrypt a transfer-pack byte stream under a freely chosen password. Derives a
 * data key via Argon2id + HKDF, seals with AES-256-GCM, and binds the enclosed
 * format into the AAD. The password is never stored.
 */
export async function encryptExportPack(
  password: string,
  packBytes: Uint8Array,
  enclosedFormat: EnclosedFormat,
): Promise<EncryptedContainer> {
  const salt = getRandomBytes(ARGON2ID_PARAMS.saltLength);
  const key = await deriveExportKey(password, salt);
  const aad = exportAad(enclosedFormat);
  const sealed = await addIntegrityHmac(
    await aeadEncrypt(key, packBytes, aad),
    await deriveIntegrityKey(key),
  );
  return {
    algoVersion: ALGO_VERSION,
    enclosedFormat,
    kdf: {
      name: 'argon2id',
      salt: toBase64Url(salt),
      memorySizeKiB: ARGON2ID_PARAMS.memorySizeKiB,
      iterations: ARGON2ID_PARAMS.iterations,
      parallelism: ARGON2ID_PARAMS.parallelism,
      hashLength: ARGON2ID_PARAMS.hashLength,
    },
    nonce: toBase64Url(sealed.nonce),
    integrityHmac: toBase64Url(sealed.integrity_hmac),
    payload: sealed.ciphertext,
  };
}

/**
 * Decrypt a container produced by `encryptExportPack`. Throws
 * `CryptoError('wrong_password')` when the derived key fails the integrity
 * check, `CryptoError('corrupted_data')` on a tampered ciphertext.
 */
export async function decryptExportPack(
  password: string,
  container: EncryptedContainer,
): Promise<Uint8Array> {
  const salt = fromBase64Url(container.kdf.salt);
  const stretched = await argon2id(password, salt, {
    memorySizeKiB: container.kdf.memorySizeKiB,
    iterations: container.kdf.iterations,
    parallelism: container.kdf.parallelism,
    hashLength: container.kdf.hashLength,
    saltLength: salt.length,
  });
  const key = asAmk(await hkdfSha256(stretched, salt, EXPORT_INFO));
  const aad = exportAad(container.enclosedFormat);
  const wrapped = {
    ciphertext: container.payload,
    nonce: fromBase64Url(container.nonce),
    algo: WRAP_ALGO,
    aad,
    integrity_hmac: fromBase64Url(container.integrityHmac),
  } as const;

  let ok = false;
  try {
    ok = await verifyIntegrityHmac(wrapped, await deriveIntegrityKey(key));
  } catch {
    ok = false;
  }
  if (!ok) {
    throw new CryptoError('wrong_password', 'export integrity check failed');
  }
  return aeadDecrypt(key, wrapped, aad);
}
```

- [ ] **Step 5: Re-export from the package index** — `packages/crypto/src/index.ts`

Add near the other primitive exports:

```ts
export { encryptExportPack, decryptExportPack } from './export/encrypt-export.js';
export type { EnclosedFormat, ExportKdfParams, EncryptedContainer } from './export/encrypt-export.js';
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd packages/crypto && bun test tests/export.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Build the package so downstream consumers see the new exports**

Run: `pnpm --filter @chatsundere/crypto build`
Expected: success (stale `dist/` otherwise masks the new symbols for the user-client — see project memory `rebuild-packages-after-base-change`).

- [ ] **Step 8: Commit**

```bash
git add packages/crypto/src/export/encrypt-export.ts packages/crypto/src/errors.ts packages/crypto/src/index.ts packages/crypto/tests/export.test.ts
git commit -m "Add password-based encrypt/decrypt for transfer packs

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 2: Transfer container — pack, read, decrypt

**Files:**
- Create: `apps/user-client/src/lib/chatsundere-transfer/encrypted-container.ts`
- Modify: `apps/user-client/src/lib/chatsundere-transfer/manifest.ts` (new manifest type + detect the new format)
- Test: `apps/user-client/tests/lib/chatsundere-transfer/encrypted-container.test.ts`

**Interfaces:**
- Consumes: `encryptExportPack`, `decryptExportPack`, `EncryptedContainer` (`@chatsundere/crypto` — Task 1); `tar`, `gzip`, `TarFile` (`../archive/tar-write.js`); `gunzip`, `untar` (`../chatsune-import/archive-reader.js`); `TRANSFER_VERSION` (`./manifest.js`).
- Produces: `wrapEncrypted(container, opts?): Promise<Blob>`; `readEncryptedContainer(input: Blob): Promise<EncryptedContainer>`; `decryptTransferPack(input: Blob, password: string): Promise<Blob>`; type `EncryptedManifest` (from `manifest.js`).

- [ ] **Step 1: Extend the manifest module** — `apps/user-client/src/lib/chatsundere-transfer/manifest.ts`

Add the interface after `KnowledgeManifest`:

```ts
export interface EncryptedManifest {
  format: 'chatsundere/encrypted';
  version: number;
  algoVersion: string;
  enclosedFormat: 'chatsundere/persona' | 'chatsundere/knowledge';
  kdf: {
    name: 'argon2id';
    salt: string;
    memorySizeKiB: number;
    iterations: number;
    parallelism: number;
    hashLength: number;
  };
  nonce: string;
  integrityHmac: string;
  exportedAt: string;
  appVersion: string;
}
```

Add `'chatsundere/encrypted'` to the `DetectedFormat` union and to the `KNOWN` set:

```ts
export type DetectedFormat =
  | 'chatsune/persona'
  | 'chatsune/knowledge'
  | 'chatsundere/persona'
  | 'chatsundere/knowledge'
  | 'chatsundere/encrypted'
  | 'unknown';

const KNOWN: ReadonlySet<string> = new Set([
  'chatsune/persona',
  'chatsune/knowledge',
  'chatsundere/persona',
  'chatsundere/knowledge',
  'chatsundere/encrypted',
]);
```

- [ ] **Step 2: Write the failing test** — `apps/user-client/tests/lib/chatsundere-transfer/encrypted-container.test.ts`

```ts
// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
import { encryptExportPack } from '@chatsundere/crypto';
import { describe, expect, it } from 'vitest';
import {
  decryptTransferPack,
  readEncryptedContainer,
  wrapEncrypted,
} from '../../../src/lib/chatsundere-transfer/encrypted-container.js';
import { readManifestFormat } from '../../../src/lib/chatsundere-transfer/import-detect.js';
import { detectArchiveFormat } from '../../../src/lib/chatsundere-transfer/manifest.js';

const inner = new TextEncoder().encode('inner-pack-bytes');

describe('encrypted transfer container', () => {
  it('wraps a container and reads it back; detects as encrypted', async () => {
    const c = await encryptExportPack('pw', inner, 'chatsundere/persona');
    const blob = await wrapEncrypted(c, { appVersion: '9.9.9' });
    const back = await readEncryptedContainer(blob);
    expect(back.enclosedFormat).toBe('chatsundere/persona');
    expect(back.payload).toEqual(c.payload);
    expect(await readManifestFormat(blob)).toBe('chatsundere/encrypted');
  });

  it('decryptTransferPack returns the inner bytes with the right password', async () => {
    const c = await encryptExportPack('pw', inner, 'chatsundere/knowledge');
    const blob = await wrapEncrypted(c);
    const out = new Uint8Array(await (await decryptTransferPack(blob, 'pw')).arrayBuffer());
    expect(new TextDecoder().decode(out)).toBe('inner-pack-bytes');
  });

  it('decryptTransferPack rejects a wrong password', async () => {
    const c = await encryptExportPack('pw', inner, 'chatsundere/persona');
    const blob = await wrapEncrypted(c);
    await expect(decryptTransferPack(blob, 'nope')).rejects.toMatchObject({
      code: 'wrong_password',
    });
  });

  it('backward-compat: plaintext manifests without encryption fields still detect', () => {
    expect(detectArchiveFormat({ format: 'chatsundere/persona', version: 1 })).toBe(
      'chatsundere/persona',
    );
    expect(detectArchiveFormat({ format: 'chatsundere/knowledge', version: 1 })).toBe(
      'chatsundere/knowledge',
    );
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test tests/lib/chatsundere-transfer/encrypted-container.test.ts`
Expected: FAIL — cannot resolve `encrypted-container.js`.

- [ ] **Step 4: Write the implementation** — `apps/user-client/src/lib/chatsundere-transfer/encrypted-container.ts`

```ts
// SPDX-License-Identifier: AGPL-3.0-only

import { type EncryptedContainer, decryptExportPack } from '@chatsundere/crypto';
import { type TarFile, gzip, tar } from '../archive/tar-write.js';
import { gunzip, untar } from '../chatsune-import/archive-reader.js';
import { type EncryptedManifest, TRANSFER_VERSION } from './manifest.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

export interface WrapEncryptedOptions {
  exportedAt?: string;
  appVersion?: string;
}

/** Pack an `EncryptedContainer` into the standard gzip-tar envelope (`manifest.json` + `payload.bin`). */
export async function wrapEncrypted(
  container: EncryptedContainer,
  opts: WrapEncryptedOptions = {},
): Promise<Blob> {
  const manifest: EncryptedManifest = {
    format: 'chatsundere/encrypted',
    version: TRANSFER_VERSION,
    algoVersion: container.algoVersion,
    enclosedFormat: container.enclosedFormat,
    kdf: container.kdf,
    nonce: container.nonce,
    integrityHmac: container.integrityHmac,
    exportedAt: opts.exportedAt ?? '',
    appVersion: opts.appVersion ?? '',
  };
  const files: TarFile[] = [
    { name: 'manifest.json', bytes: enc.encode(JSON.stringify(manifest)) },
    { name: 'payload.bin', bytes: container.payload },
  ];
  const gz: Uint8Array<ArrayBuffer> = new Uint8Array(await gzip(tar(files)));
  return new Blob([gz], { type: 'application/gzip' });
}

/** Read an encrypted container back out of its gzip-tar envelope. */
export async function readEncryptedContainer(input: Blob): Promise<EncryptedContainer> {
  const raw = new Uint8Array(await input.arrayBuffer());
  const files = new Map<string, Uint8Array>();
  for (const e of untar(await gunzip(raw))) files.set(e.name, e.bytes);
  const manifestBytes = files.get('manifest.json');
  const payload = files.get('payload.bin');
  if (!manifestBytes || !payload) {
    throw new Error('This encrypted export is missing data — the file may be damaged.');
  }
  const manifest = JSON.parse(dec.decode(manifestBytes)) as EncryptedManifest;
  return {
    algoVersion: manifest.algoVersion,
    enclosedFormat: manifest.enclosedFormat,
    kdf: manifest.kdf,
    nonce: manifest.nonce,
    integrityHmac: manifest.integrityHmac,
    payload,
  };
}

/**
 * Decrypt an encrypted transfer pack to its inner plaintext pack Blob. Throws
 * `CryptoError('wrong_password')` when the password is wrong.
 */
export async function decryptTransferPack(input: Blob, password: string): Promise<Blob> {
  const container = await readEncryptedContainer(input);
  const innerBytes = await decryptExportPack(password, container);
  const inner: Uint8Array<ArrayBuffer> = new Uint8Array(innerBytes);
  return new Blob([inner], { type: 'application/gzip' });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test tests/lib/chatsundere-transfer/encrypted-container.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/lib/chatsundere-transfer/manifest.ts apps/user-client/src/lib/chatsundere-transfer/encrypted-container.ts apps/user-client/tests/lib/chatsundere-transfer/encrypted-container.test.ts
git commit -m "Add encrypted transfer-pack container (wrap/read/decrypt)

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 3: Export data layer — optional password on persona & library export

**Files:**
- Modify: `apps/user-client/src/data/chatsundere-export.ts`
- Test: `apps/user-client/tests/data/chatsundere-export.test.ts` (add cases; reuse the existing `beforeEach` seed + `readArchiveFile` helper)

**Interfaces:**
- Consumes: `encryptExportPack` (`@chatsundere/crypto`); `wrapEncrypted` (`../lib/chatsundere-transfer/encrypted-container.js`); existing `writePersonaPack`, `writeKnowledgePack`.
- Produces: `exportPersona(personaId, opts, password?): Promise<Blob>`; `exportLibrary(libraryId, password?): Promise<Blob>` (both gain an optional trailing `password?: string`).

- [ ] **Step 1: Write the failing test** — append to `apps/user-client/tests/data/chatsundere-export.test.ts`

Add these imports at the top (alongside the existing ones):

```ts
import { decryptExportPack } from '@chatsundere/crypto';
import { readEncryptedContainer } from '../../src/lib/chatsundere-transfer/encrypted-container.js';
import { readManifestFormat } from '../../src/lib/chatsundere-transfer/import-detect.js';
import { readPersonaPack } from '../../src/lib/chatsundere-transfer/persona-pack.js';
```

Add inside `describe('exportPersona', …)` (uses the file's existing seeded persona `p1` / `Fable`):

```ts
it('with a password, produces an encrypted pack that decrypts back to the plaintext pack', async () => {
  const blob = await exportPersona('p1', { memory: true, artefacts: true, images: false }, 'hunter2');

  // The outer file is detected as encrypted, not persona.
  expect(await readManifestFormat(blob)).toBe('chatsundere/encrypted');

  // Decrypt → the inner pack parses as a persona pack for the same persona.
  const container = await readEncryptedContainer(blob);
  expect(container.enclosedFormat).toBe('chatsundere/persona');
  const innerBytes = await decryptExportPack('hunter2', container);
  const parsed = await readPersonaPack(new Blob([innerBytes as Uint8Array<ArrayBuffer>]));
  expect(parsed.payload.persona.name).toBe('Fable');
});

it('without a password, is unchanged (persona format, one-tap)', async () => {
  const blob = await exportPersona('p1', { memory: true, artefacts: true, images: false });
  expect(await readManifestFormat(blob)).toBe('chatsundere/persona');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test tests/data/chatsundere-export.test.ts`
Expected: FAIL — `exportPersona` ignores the third argument, so `readManifestFormat` returns `chatsundere/persona`.

- [ ] **Step 3: Add the encryption helper + password params** — `apps/user-client/src/data/chatsundere-export.ts`

Add imports at the top:

```ts
import { encryptExportPack } from '@chatsundere/crypto';
import type { EnclosedFormat } from '@chatsundere/crypto';
import { wrapEncrypted } from '../lib/chatsundere-transfer/encrypted-container.js';
```

Add a private helper (place it above `exportPersona`):

```ts
/** Encrypt a plaintext pack Blob under `password` when one is given; otherwise return it unchanged. */
async function maybeEncrypt(
  plain: Blob,
  enclosedFormat: EnclosedFormat,
  password: string | undefined,
  meta: { exportedAt: string; appVersion: string },
): Promise<Blob> {
  if (!password) return plain;
  const bytes = new Uint8Array(await plain.arrayBuffer());
  const container = await encryptExportPack(password, bytes, enclosedFormat);
  return wrapEncrypted(container, meta);
}
```

Change `exportPersona`'s signature and its final `return`:

```ts
export async function exportPersona(
  personaId: string,
  opts: PersonaExportOptions,
  password?: string,
): Promise<Blob> {
  // …everything above `return writePersonaPack(...)` is unchanged…
  const meta = { exportedAt: new Date(Date.now()).toISOString(), appVersion: APP_VERSION.version };
  const plain = await writePersonaPack(payload, meta);
  return maybeEncrypt(plain, 'chatsundere/persona', password, meta);
}
```

Change `exportLibrary` likewise:

```ts
export async function exportLibrary(libraryId: string, password?: string): Promise<Blob> {
  // …everything above the final `return writeKnowledgePack(...)` is unchanged…
  const meta = { exportedAt: new Date(Date.now()).toISOString(), appVersion: APP_VERSION.version };
  const plain = await writeKnowledgePack(payload, meta);
  return maybeEncrypt(plain, 'chatsundere/knowledge', password, meta);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @chatsundere/user-client test tests/data/chatsundere-export.test.ts`
Expected: PASS (existing cases + 2 new).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/data/chatsundere-export.ts apps/user-client/tests/data/chatsundere-export.test.ts
git commit -m "Wire optional password encryption into persona & library export

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 4: Encryption form helper + shared `EncryptExportSection`

**Files:**
- Create: `apps/user-client/src/lib/chatsundere-transfer/encryption-form.ts`
- Create: `apps/user-client/src/components/transfer/EncryptExportSection.tsx`
- Test: `apps/user-client/tests/lib/chatsundere-transfer/encryption-form.test.ts`
- Test: `apps/user-client/tests/component/encrypt-export-section.test.tsx`

**Interfaces:**
- Produces: `EncryptFormState { enabled; password; confirm }`; `INITIAL_ENCRYPT_FORM`; `resolveExportPassword(state): { ok: true; password: string | undefined } | { ok: false; reason: string }`; `<EncryptExportSection state onChange />`.

- [ ] **Step 1: Write the failing helper test** — `apps/user-client/tests/lib/chatsundere-transfer/encryption-form.test.ts`

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { resolveExportPassword } from '../../../src/lib/chatsundere-transfer/encryption-form.js';

describe('resolveExportPassword', () => {
  it('off → ok with no password', () => {
    expect(resolveExportPassword({ enabled: false, password: '', confirm: '' })).toEqual({
      ok: true,
      password: undefined,
    });
  });

  it('on + empty → blocked', () => {
    expect(resolveExportPassword({ enabled: true, password: '', confirm: '' }).ok).toBe(false);
  });

  it('on + mismatch → blocked', () => {
    const r = resolveExportPassword({ enabled: true, password: 'a', confirm: 'b' });
    expect(r).toMatchObject({ ok: false });
  });

  it('on + match → ok with the password', () => {
    expect(resolveExportPassword({ enabled: true, password: 'abc', confirm: 'abc' })).toEqual({
      ok: true,
      password: 'abc',
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test tests/lib/chatsundere-transfer/encryption-form.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the helper** — `apps/user-client/src/lib/chatsundere-transfer/encryption-form.ts`

```ts
// SPDX-License-Identifier: AGPL-3.0-only

export interface EncryptFormState {
  enabled: boolean;
  password: string;
  confirm: string;
}

/** The default (off) state for an encryption form. */
export const INITIAL_ENCRYPT_FORM: EncryptFormState = { enabled: false, password: '', confirm: '' };

export type ResolvedExportPassword =
  | { ok: true; password: string | undefined }
  | { ok: false; reason: string };

/** Resolve an encryption form to a usable password (undefined when off) or a blocking reason. */
export function resolveExportPassword(state: EncryptFormState): ResolvedExportPassword {
  if (!state.enabled) return { ok: true, password: undefined };
  if (state.password.length === 0) return { ok: false, reason: 'Enter a password to encrypt with.' };
  if (state.password !== state.confirm) return { ok: false, reason: 'The two passwords do not match.' };
  return { ok: true, password: state.password };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test tests/lib/chatsundere-transfer/encryption-form.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing component test** — `apps/user-client/tests/component/encrypt-export-section.test.tsx`

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { EncryptExportSection } from '../../src/components/transfer/EncryptExportSection.js';
import {
  type EncryptFormState,
  INITIAL_ENCRYPT_FORM,
} from '../../src/lib/chatsundere-transfer/encryption-form.js';

function Harness(): JSX.Element {
  const [state, setState] = useState<EncryptFormState>(INITIAL_ENCRYPT_FORM);
  return <EncryptExportSection state={state} onChange={setState} />;
}

describe('EncryptExportSection', () => {
  it('is off by default and hides the password fields', () => {
    render(<Harness />);
    expect((screen.getByLabelText(/encrypt with a password/i) as HTMLInputElement).checked).toBe(
      false,
    );
    expect(screen.queryByLabelText(/^password$/i)).toBeNull();
  });

  it('reveals password + confirm and the no-recovery notice when ticked', () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText(/encrypt with a password/i));
    expect(screen.getByLabelText(/^password$/i)).toBeTruthy();
    expect(screen.getByLabelText(/confirm password/i)).toBeTruthy();
    expect(screen.getByText(/there is no recovery/i)).toBeTruthy();
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test tests/component/encrypt-export-section.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 7: Write the component** — `apps/user-client/src/components/transfer/EncryptExportSection.tsx`

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import type { EncryptFormState } from '../../lib/chatsundere-transfer/encryption-form.js';

export interface EncryptExportSectionProps {
  state: EncryptFormState;
  onChange: (next: EncryptFormState) => void;
}

/**
 * Optional password-encryption controls for an export. Off by default; ticking
 * the box reveals a password + confirmation field and a plain no-recovery note.
 */
export function EncryptExportSection({ state, onChange }: EncryptExportSectionProps): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <label htmlFor="export-encrypt" className="cursor-pointer text-sm text-paper">
            Encrypt with a password
          </label>
          <p className="text-[11px] text-paper-soft">Off: the file is not password-protected.</p>
        </div>
        <input
          id="export-encrypt"
          type="checkbox"
          checked={state.enabled}
          onChange={(e) =>
            onChange({ ...state, enabled: e.target.checked, password: '', confirm: '' })
          }
          className="mt-0.5 shrink-0 accent-paper"
        />
      </div>
      {state.enabled ? (
        <div className="flex flex-col gap-2">
          <input
            aria-label="Password"
            type="password"
            autoComplete="new-password"
            value={state.password}
            onChange={(e) => onChange({ ...state, password: e.target.value })}
            placeholder="Password"
            className="rounded-md border border-paper-soft/30 bg-transparent px-3 py-1.5 text-sm text-paper"
          />
          <input
            aria-label="Confirm password"
            type="password"
            autoComplete="new-password"
            value={state.confirm}
            onChange={(e) => onChange({ ...state, confirm: e.target.value })}
            placeholder="Confirm password"
            className="rounded-md border border-paper-soft/30 bg-transparent px-3 py-1.5 text-sm text-paper"
          />
          <p className="text-[11px] text-amber-300/80">
            If you lose this password, the file cannot be opened — there is no recovery.
          </p>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test tests/component/encrypt-export-section.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add apps/user-client/src/lib/chatsundere-transfer/encryption-form.ts apps/user-client/src/components/transfer/EncryptExportSection.tsx apps/user-client/tests/lib/chatsundere-transfer/encryption-form.test.ts apps/user-client/tests/component/encrypt-export-section.test.tsx
git commit -m "Add shared encryption-form helper and EncryptExportSection

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 5: Persona export overlay — add the encryption option

**Files:**
- Modify: `apps/user-client/src/components/transfer/ExportOverlay.tsx`
- Test: `apps/user-client/tests/component/export-overlay.test.tsx` (extend)

**Interfaces:**
- Consumes: `EncryptExportSection`, `resolveExportPassword`, `INITIAL_ENCRYPT_FORM`, `EncryptFormState`; `exportPersona(personaId, opts, password?)` (Task 3).

- [ ] **Step 1: Write the failing tests** — append to `apps/user-client/tests/component/export-overlay.test.tsx`

The existing `exportPersonaMock` is `async () => new Blob(['x'])`. The two existing assertions (`toHaveBeenCalledWith('p1', {…})`) stay valid because the overlay omits the third arg when encryption is off. Add:

```ts
it('encrypts and names the file -encrypted when a matching password is set', async () => {
  exportPersonaMock.mockClear();
  triggerDownloadMock.mockClear();
  render(<ExportOverlay personaId="p3" personaName="Ivy" onClose={() => {}} />);

  fireEvent.click(screen.getByLabelText(/encrypt with a password/i));
  fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'secret' } });
  fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: /^export$/i }));

  expect(exportPersonaMock).toHaveBeenCalledWith('p3', { memory: true, artefacts: true, images: false }, 'secret');
  await Promise.resolve();
  expect(triggerDownloadMock).toHaveBeenCalledWith(
    expect.anything(),
    expect.stringContaining('-chatsundere-encrypted.tar.gz'),
  );
});

it('disables Export while the passwords do not match', () => {
  render(<ExportOverlay personaId="p4" personaName="Jae" onClose={() => {}} />);
  fireEvent.click(screen.getByLabelText(/encrypt with a password/i));
  fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'a' } });
  fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'b' } });
  expect((screen.getByRole('button', { name: /^export$/i }) as HTMLButtonElement).disabled).toBe(true);
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `pnpm --filter @chatsundere/user-client test tests/component/export-overlay.test.tsx`
Expected: the two new tests FAIL (no encryption controls yet); the two original tests still PASS.

- [ ] **Step 3: Wire the overlay** — `apps/user-client/src/components/transfer/ExportOverlay.tsx`

Add imports:

```ts
import { EncryptExportSection } from './EncryptExportSection.js';
import {
  type EncryptFormState,
  INITIAL_ENCRYPT_FORM,
  resolveExportPassword,
} from '../../lib/chatsundere-transfer/encryption-form.js';
```

Add state next to the existing `useState` calls:

```ts
const [enc, setEnc] = useState<EncryptFormState>(INITIAL_ENCRYPT_FORM);
```

Replace `handleExport` with:

```ts
async function handleExport(): Promise<void> {
  const resolved = resolveExportPassword(enc);
  if (!resolved.ok) return;
  setExporting(true);
  try {
    const blob = resolved.password
      ? await exportPersona(personaId, { memory, artefacts, images }, resolved.password)
      : await exportPersona(personaId, { memory, artefacts, images });
    const suffix = resolved.password ? '-chatsundere-encrypted.tar.gz' : '-chatsundere.tar.gz';
    triggerDownload(blob, `${slug(personaName)}${suffix}`);
    toastStore.show({ message: 'Persona exported', tone: 'success', durationMs: 3000 });
    onClose();
  } catch (e) {
    toastStore.show({
      message: e instanceof Error ? e.message : 'Export failed',
      tone: 'warn',
      durationMs: 3500,
    });
    setExporting(false);
  }
}
```

Add the section inside the toggle column, after the Images `ToggleRow` (before the closing `</div>` of `mb-4 mt-2 flex flex-col gap-3`), then the reason line:

```tsx
          <EncryptExportSection state={enc} onChange={setEnc} />
        </div>
        {(() => {
          const r = resolveExportPassword(enc);
          return !r.ok ? (
            <p className="mb-2 text-[11px] text-amber-300/80">{r.reason}</p>
          ) : null;
        })()}
```

Update the Export button's `disabled`:

```tsx
disabled={exporting || !resolveExportPassword(enc).ok}
```

- [ ] **Step 4: Run to verify all pass**

Run: `pnpm --filter @chatsundere/user-client test tests/component/export-overlay.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/transfer/ExportOverlay.tsx apps/user-client/tests/component/export-overlay.test.tsx
git commit -m "Add encryption option to the persona export overlay

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 6: Library export overlay — new surface with the encryption option

**Files:**
- Create: `apps/user-client/src/components/transfer/LibraryExportOverlay.tsx`
- Modify: `apps/user-client/src/routes/app/knowledge/library.tsx` (open the overlay from the ⋯ menu; remove the direct `onExportLibrary`)
- Test: `apps/user-client/tests/component/library-export-overlay.test.tsx`

**Interfaces:**
- Consumes: `EncryptExportSection`, `resolveExportPassword`, `INITIAL_ENCRYPT_FORM`; `exportLibrary(libraryId, password?)` (Task 3); `slug`, `triggerDownload`; `toastStore`; `Button`.
- Produces: `<LibraryExportOverlay libraryId libraryName onClose />`.

- [ ] **Step 1: Write the failing test** — `apps/user-client/tests/component/library-export-overlay.test.tsx`

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { exportLibraryMock, triggerDownloadMock } = vi.hoisted(() => ({
  exportLibraryMock: vi.fn(async () => new Blob(['x'])),
  triggerDownloadMock: vi.fn(),
}));

vi.mock('../../src/data/chatsundere-export.js', () => ({
  exportLibrary: exportLibraryMock,
  exportPersona: vi.fn(),
}));
vi.mock('../../src/lib/download.js', () => ({
  triggerDownload: triggerDownloadMock,
  slug: (s: string) => s.toLowerCase(),
}));
vi.mock('../../src/state/toast.store.js', () => ({
  toastStore: { show: vi.fn() },
  useToastStore: vi.fn(),
}));

import { LibraryExportOverlay } from '../../src/components/transfer/LibraryExportOverlay.js';

describe('LibraryExportOverlay', () => {
  it('one-tap plaintext export when encryption is off', async () => {
    exportLibraryMock.mockClear();
    triggerDownloadMock.mockClear();
    render(<LibraryExportOverlay libraryId="lib-1" libraryName="Lore" onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /^export$/i }));
    expect(exportLibraryMock).toHaveBeenCalledWith('lib-1');
    await Promise.resolve();
    expect(triggerDownloadMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('-chatsundere.tar.gz'),
    );
  });

  it('encrypts with a matching password', async () => {
    exportLibraryMock.mockClear();
    render(<LibraryExportOverlay libraryId="lib-2" libraryName="Lore" onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText(/encrypt with a password/i));
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'pw' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: /^export$/i }));
    expect(exportLibraryMock).toHaveBeenCalledWith('lib-2', 'pw');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test tests/component/library-export-overlay.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Write the overlay** — `apps/user-client/src/components/transfer/LibraryExportOverlay.tsx`

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { exportLibrary } from '../../data/chatsundere-export.js';
import {
  type EncryptFormState,
  INITIAL_ENCRYPT_FORM,
  resolveExportPassword,
} from '../../lib/chatsundere-transfer/encryption-form.js';
import { slug, triggerDownload } from '../../lib/download.js';
import { toastStore } from '../../state/toast.store.js';
import { Button } from '../ui/Button.js';
import { EncryptExportSection } from './EncryptExportSection.js';

export interface LibraryExportOverlayProps {
  libraryId: string;
  libraryName: string;
  onClose: () => void;
}

/**
 * Transient export overlay for a knowledge library. Its only option is optional
 * password encryption (off by default → one-tap plaintext export).
 */
export function LibraryExportOverlay({
  libraryId,
  libraryName,
  onClose,
}: LibraryExportOverlayProps): JSX.Element {
  const [enc, setEnc] = useState<EncryptFormState>(INITIAL_ENCRYPT_FORM);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const resolved = resolveExportPassword(enc);

  async function handleExport(): Promise<void> {
    if (!resolved.ok) return;
    setExporting(true);
    try {
      const blob = resolved.password
        ? await exportLibrary(libraryId, resolved.password)
        : await exportLibrary(libraryId);
      const suffix = resolved.password ? '-chatsundere-encrypted.tar.gz' : '-chatsundere.tar.gz';
      triggerDownload(blob, `${slug(libraryName)}${suffix}`);
      toastStore.show({ message: 'Library exported', tone: 'success', durationMs: 3000 });
      onClose();
    } catch (e) {
      toastStore.show({
        message: e instanceof Error ? e.message : 'Export failed',
        tone: 'warn',
        durationMs: 3500,
      });
      setExporting(false);
    }
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: fixed stacking layer that drives the zoom animation; <dialog> requires showModal()
    <div className="cs-dialog-root" role="dialog" aria-modal="true" aria-label={`Export ${libraryName}`}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop tap maps to cancel; Escape handled on document */}
      <div className="cs-dialog-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="cs-dialog-card cs-zoom-in">
        <div className="cs-dialog-title">Export {libraryName}</div>
        <div className="mb-4 mt-2">
          <EncryptExportSection state={enc} onChange={setEnc} />
          {!resolved.ok ? (
            <p className="mt-2 text-[11px] text-amber-300/80">{resolved.reason}</p>
          ) : null}
        </div>
        <div className="cs-dialog-actions">
          <Button tone="neutral" onClick={onClose}>
            Cancel
          </Button>
          <Button
            tone="primary"
            priority
            disabled={exporting || !resolved.ok}
            onClick={() => {
              void handleExport();
            }}
          >
            Export
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test tests/component/library-export-overlay.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the overlay into the library page** — `apps/user-client/src/routes/app/knowledge/library.tsx`

Add the import:

```ts
import { LibraryExportOverlay } from '../../../components/transfer/LibraryExportOverlay.js';
```

Add state (near the other `useState` calls in the detail component):

```ts
const [showExport, setShowExport] = useState(false);
```

**Delete** the `onExportLibrary` function (lines ~183–196) and change the ⋯ menu `Export` item to open the overlay:

```tsx
              {
                label: 'Export',
                onSelect: () => setShowExport(true),
              },
```

Render the overlay just after `{helpOverlay}`:

```tsx
      {showExport ? (
        <LibraryExportOverlay
          libraryId={existing.id}
          libraryName={existing.name}
          onClose={() => setShowExport(false)}
        />
      ) : null}
```

Remove now-unused imports from `library.tsx`: `exportLibrary` (from `chatsundere-export.js`) and, if they are used nowhere else in the file, `slug` / `triggerDownload`. Verify with a search before deleting:

Run: `rg -n 'exportLibrary|triggerDownload|\bslug\b' apps/user-client/src/routes/app/knowledge/library.tsx`
Delete only the imports whose sole use was `onExportLibrary`.

- [ ] **Step 6: Type-check the touched app**

Run: `pnpm --filter @chatsundere/user-client exec tsc --noEmit`
Expected: no errors (catches an over-eager import deletion).

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/components/transfer/LibraryExportOverlay.tsx apps/user-client/src/routes/app/knowledge/library.tsx apps/user-client/tests/component/library-export-overlay.test.tsx
git commit -m "Add library export overlay with the encryption option

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 7: Import — decrypt prompt + persona host wiring

**Files:**
- Create: `apps/user-client/src/components/transfer/DecryptPromptOverlay.tsx`
- Modify: `apps/user-client/src/components/persona-editor/ChatsuneImportControl.tsx`
- Test: `apps/user-client/tests/component/decrypt-prompt-overlay.test.tsx`

**Interfaces:**
- Consumes: `Button`; `decryptTransferPack` (`../../lib/chatsundere-transfer/encrypted-container.js`); `CryptoError` (`@chatsundere/crypto`); existing `readManifestFormat`, `importPersonaPack`.
- Produces: `<DecryptPromptOverlay onSubmit onCancel error busy />`.

- [ ] **Step 1: Write the failing test** — `apps/user-client/tests/component/decrypt-prompt-overlay.test.tsx`

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DecryptPromptOverlay } from '../../src/components/transfer/DecryptPromptOverlay.js';

describe('DecryptPromptOverlay', () => {
  it('submits the typed password and shows an error while keeping it', () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <DecryptPromptOverlay onSubmit={onSubmit} onCancel={() => {}} error={null} busy={false} />,
    );
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /unlock/i }));
    expect(onSubmit).toHaveBeenCalledWith('secret');

    rerender(
      <DecryptPromptOverlay
        onSubmit={onSubmit}
        onCancel={() => {}}
        error="That password didn’t work — try again."
        busy={false}
      />,
    );
    expect(screen.getByText(/didn.t work/i)).toBeTruthy();
    // The field keeps what was typed (component is not remounted).
    expect((screen.getByLabelText(/^password$/i) as HTMLInputElement).value).toBe('secret');
  });

  it('disables Unlock while the field is empty', () => {
    render(<DecryptPromptOverlay onSubmit={vi.fn()} onCancel={() => {}} error={null} busy={false} />);
    expect((screen.getByRole('button', { name: /unlock/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test tests/component/decrypt-prompt-overlay.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Write the component** — `apps/user-client/src/components/transfer/DecryptPromptOverlay.tsx`

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { Button } from '../ui/Button.js';

export interface DecryptPromptOverlayProps {
  onSubmit: (password: string) => void;
  onCancel: () => void;
  /** Non-null after a failed attempt; the typed password is preserved. */
  error: string | null;
  busy: boolean;
}

/** Password prompt shown when importing an encrypted transfer pack. */
export function DecryptPromptOverlay({
  onSubmit,
  onCancel,
  error,
  busy,
}: DecryptPromptOverlayProps): JSX.Element {
  const [password, setPassword] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  return (
    // biome-ignore lint/a11y/useSemanticElements: fixed stacking layer that drives the zoom animation; <dialog> requires showModal()
    <div className="cs-dialog-root" role="dialog" aria-modal="true" aria-label="Enter export password">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop tap maps to cancel; Escape handled on document */}
      <div className="cs-dialog-backdrop" onClick={onCancel} aria-hidden="true" />
      <div className="cs-dialog-card cs-zoom-in">
        <div className="cs-dialog-title">This export is encrypted</div>
        <p className="mb-3 mt-1 text-[11px] text-paper-soft">
          Enter the password it was exported with.
        </p>
        <input
          aria-label="Password"
          type="password"
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full rounded-md border border-paper-soft/30 bg-transparent px-3 py-1.5 text-sm text-paper"
        />
        {error ? <p className="mt-2 text-[11px] text-amber-300/80">{error}</p> : null}
        <div className="cs-dialog-actions">
          <Button tone="neutral" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            tone="primary"
            priority
            disabled={busy || password.length === 0}
            onClick={() => onSubmit(password)}
          >
            Unlock
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test tests/component/decrypt-prompt-overlay.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the persona import host** — `apps/user-client/src/components/persona-editor/ChatsuneImportControl.tsx`

Add imports:

```ts
import { CryptoError } from '@chatsundere/crypto';
import { decryptTransferPack } from '../../lib/chatsundere-transfer/encrypted-container.js';
import { DecryptPromptOverlay } from '../transfer/DecryptPromptOverlay.js';
```

Add state (next to the other `useState` hooks):

```ts
const [pendingEncrypted, setPendingEncrypted] = useState<Blob | null>(null);
const [decrypting, setDecrypting] = useState(false);
const [decryptError, setDecryptError] = useState<string | null>(null);
```

Change `onPick`'s parameter type from `File` to `Blob` and add the encrypted branch as the first format check (the rest of the function is unchanged):

```ts
  async function onPick(file: Blob): Promise<void> {
    setError(null);
    setPreview(null);
    setPersonaCollision(null);

    const format = await readManifestFormat(file);

    if (format === 'chatsundere/encrypted') {
      setDecryptError(null);
      setPendingEncrypted(file);
      return;
    }

    if (format === 'chatsundere/persona') {
      // …unchanged…
```

Add the decrypt handler (after `onPick`):

```ts
  async function onDecryptSubmit(password: string): Promise<void> {
    const file = pendingEncrypted;
    if (!file) return;
    setDecrypting(true);
    setDecryptError(null);
    try {
      const inner = await decryptTransferPack(file, password);
      setPendingEncrypted(null);
      setDecrypting(false);
      await onPick(inner);
    } catch (e) {
      setDecrypting(false);
      if (e instanceof CryptoError && e.code === 'wrong_password') {
        setDecryptError('That password didn’t work — try again.');
      } else {
        setPendingEncrypted(null);
        setError(e instanceof Error ? e.message : 'Could not open this file.');
      }
    }
  }
```

Render the overlay — add just inside the top-level `<div className="mb-3">`, before the `<input>`:

```tsx
      {pendingEncrypted ? (
        <DecryptPromptOverlay
          onSubmit={(pw) => void onDecryptSubmit(pw)}
          onCancel={() => {
            setPendingEncrypted(null);
            setDecryptError(null);
          }}
          error={decryptError}
          busy={decrypting}
        />
      ) : null}
```

(The `<input onChange>` already passes a `File`, which satisfies the widened `Blob` parameter — no change needed there.)

- [ ] **Step 6: Type-check**

Run: `pnpm --filter @chatsundere/user-client exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/components/transfer/DecryptPromptOverlay.tsx apps/user-client/src/components/persona-editor/ChatsuneImportControl.tsx apps/user-client/tests/component/decrypt-prompt-overlay.test.tsx
git commit -m "Prompt for a password when importing an encrypted persona pack

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 8: Import — library host wiring

**Files:**
- Modify: `apps/user-client/src/routes/app/knowledge.tsx`

**Interfaces:**
- Consumes: `DecryptPromptOverlay` (Task 7); `decryptTransferPack`; `CryptoError`; existing `readManifestFormat`, `importKnowledgePack`.

- [ ] **Step 1: Wire the library import host** — `apps/user-client/src/routes/app/knowledge.tsx`

Add imports:

```ts
import { CryptoError } from '@chatsundere/crypto';
import { DecryptPromptOverlay } from '../../components/transfer/DecryptPromptOverlay.js';
import { decryptTransferPack } from '../../lib/chatsundere-transfer/encrypted-container.js';
```

Add state (next to the other `useState` hooks in `KnowledgeList`):

```ts
const [pendingEncrypted, setPendingEncrypted] = useState<Blob | null>(null);
const [decrypting, setDecrypting] = useState(false);
const [decryptError, setDecryptError] = useState<string | null>(null);
```

Change `onPickImport`'s parameter type from `File` to `Blob` and add the encrypted branch as the first format check:

```ts
  async function onPickImport(file: Blob): Promise<void> {
    setImportError(null);
    setLibraryCollision(null);

    const format = await readManifestFormat(file);

    if (format === 'chatsundere/encrypted') {
      setDecryptError(null);
      setPendingEncrypted(file);
      return;
    }

    if (format === 'chatsundere/knowledge') {
      // …unchanged…
```

Add the decrypt handler (after `onPickImport`):

```ts
  async function onDecryptSubmit(password: string): Promise<void> {
    const file = pendingEncrypted;
    if (!file) return;
    setDecrypting(true);
    setDecryptError(null);
    try {
      const inner = await decryptTransferPack(file, password);
      setPendingEncrypted(null);
      setDecrypting(false);
      await onPickImport(inner);
    } catch (e) {
      setDecrypting(false);
      if (e instanceof CryptoError && e.code === 'wrong_password') {
        setDecryptError('That password didn’t work — try again.');
      } else {
        setPendingEncrypted(null);
        setImportError(e instanceof Error ? e.message : 'Could not open this file.');
      }
    }
  }
```

Render the overlay — just after `{helpOverlay}` inside the returned `PageScaffold`:

```tsx
      {pendingEncrypted ? (
        <DecryptPromptOverlay
          onSubmit={(pw) => void onDecryptSubmit(pw)}
          onCancel={() => {
            setPendingEncrypted(null);
            setDecryptError(null);
          }}
          error={decryptError}
          busy={decrypting}
        />
      ) : null}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @chatsundere/user-client exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Full gate — repo type-check + the touched suites**

Run: `pnpm typecheck --force`
Expected: all packages green (`--force` avoids a cached pass on the type-touching change — project memory `turbo-caches-typecheck`).

Run: `pnpm --filter @chatsundere/user-client test tests/lib/chatsundere-transfer tests/data/chatsundere-export.test.ts tests/component`
Expected: all pass.

Run: `cd packages/crypto && bun test`
Expected: baseline + the new `export.test.ts` all pass.

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/routes/app/knowledge.tsx
git commit -m "Prompt for a password when importing an encrypted library pack

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Manual verification (Chris, on device — spec §10)

The import host wiring (Tasks 7–8, file-input glue) is verified here rather than by brittle RTL file-input tests, per the project's "manual verification beats automated coverage for UX" principle:

1. Export a persona with encryption **off** → `…-chatsundere.tar.gz`, imports as today.
2. Export it with encryption **on** (password + confirm) → `…-chatsundere-encrypted.tar.gz`.
3. Fresh client → import → password prompt → correct password → history, reasoning, memory, avatar, pills/tool-calls present.
4. Import again with a **wrong** password → constructive "didn’t work" message, the field keeps what was typed, no dead-end; correct password then succeeds.
5. Repeat 2–4 for a knowledge **library** (vectors adopt on the correct password).
6. Confirm a password/confirm mismatch disables "Export" with a visible reason.
7. **Backward compatibility:** import an actual **v0.1.3** export (persona + library, no encryption) → imports with no password prompt.

## Audit gates (before squash)

- **Larissa** — `packages/crypto` (Task 1): KDF/AEAD/AAD binding, wrong-password mapping, password never persisted or logged.
- **Laura** — the encrypt option on both export overlays + the import password prompt; no-recovery communication; constructive wrong-password path.

## Self-review notes

- **Spec coverage:** §3 container → Task 2; §3 backward-compat → Task 2 (detect) + Task 8 gate + manual §10.7; §4 crypto → Task 1; §5 wiring → Tasks 2/3/7/8; §6 UI → Tasks 4/5/6/7; §7 tests → Tasks 1–7; §8 audits → this section; §10 manual → above.
- **Type consistency:** `EnclosedFormat`, `EncryptedContainer`, `EncryptFormState`, `resolveExportPassword`, `decryptTransferPack`, `wrapEncrypted`/`readEncryptedContainer` used with identical signatures across tasks.
- **`exportPersona` third-arg compatibility:** the overlay omits the third argument when encryption is off, so the two pre-existing `export-overlay` assertions stay valid.
