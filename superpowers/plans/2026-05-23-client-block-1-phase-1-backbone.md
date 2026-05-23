# Client Block 1 — Phase 1 (Backbone) implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the wireframe-independent Backbone of Block 1 — the IndexedDB user-data schema (Dexie), the secret-sealing helper, the full `@chatsundere/llm-unified` package (registry, openai-chat-completions adapter, transport with cors-proxy support, SSE streaming, system-prompt composition, probe), and the onboarding intent-matrix gating that keeps Block-1 users on the local-only path.

**Architecture:** Backbone work splits into two packages — `apps/user-client` (Dexie schema + secret-sealing helper + onboarding gating) and `packages/llm-unified` (the full provider library). Both are wireframe-independent: nothing in this plan ships UI surfaces beyond the existing onboarding-matrix tweak. The remaining UI work (My Settings, My Circle, chat surfaces, History) is deliberately deferred to Phases 2–4 of the parent spec, which gate on Lyra's incoming wireframes.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Dexie 4, Vitest (frontend), Bun's built-in test runner (`@chatsundere/llm-unified`), `fake-indexeddb` (already in user-client devDeps; added to llm-unified devDeps), `@chatsundere/crypto` (existing MasterKey + DEK derivation + WebCrypto AEAD), Tailwind v4 + React 18 + React Router v6 for the onboarding-matrix tweak.

**Spec:** [`superpowers/specs/2026-05-23-client-block-1-design.md`](../specs/2026-05-23-client-block-1-design.md)

**Phase scope:** Phase 1 only. After Task 13 (Integration check) lands, **pause for sync** with Chris on Lyra's incoming wireframe iterations before opening Phase 2. The plan deliberately does not include Settings / Circle / Chat / History surfaces.

**Commit strategy:** Every task ends with a working `git add` + `git commit`. Intermediate commits are squashed into one Phase-1 commit (per CLAUDE.md §8) after Task 13.

**Larissa gate:** Phase 1 does not modify `packages/crypto` (it only consumes its public API). No Larissa pass required for Phase 1. If a future change moves secret-sealing into `packages/crypto`, that change does need Larissa.

---

## File structure

**Created:**

```
apps/user-client/src/lib/secrets.ts                                  (Task 1)
apps/user-client/src/lib/secrets.test.ts                             (Task 1)
apps/user-client/src/boot/client-data-db.ts                          (Task 2)
apps/user-client/src/boot/client-data-db.test.ts                     (Task 2)
packages/llm-unified/src/types.ts                                    (Task 3)
packages/llm-unified/src/composition.ts                              (Task 4)
packages/llm-unified/src/composition.test.ts                         (Task 4)
packages/llm-unified/src/registry.ts                                 (Task 5)
packages/llm-unified/src/registry.test.ts                            (Task 5)
packages/llm-unified/src/providers/_helpers.ts                       (Task 6)
packages/llm-unified/src/providers/nano-gpt.ts                       (Task 6)
packages/llm-unified/src/providers/novita.ts                         (Task 6)
packages/llm-unified/src/providers/ollama-cloud.ts                   (Task 6)
packages/llm-unified/src/providers/_register-builtins.ts             (Task 6)
packages/llm-unified/src/providers/builtins.test.ts                  (Task 6)
packages/llm-unified/src/transport.ts                                (Task 7)
packages/llm-unified/src/transport.test.ts                           (Task 7)
packages/llm-unified/src/streaming.ts                                (Task 8)
packages/llm-unified/src/streaming.test.ts                           (Task 8)
packages/llm-unified/src/adapters/openai-chat-completions.ts         (Task 9)
packages/llm-unified/src/adapters/openai-chat-completions.test.ts    (Task 9)
packages/llm-unified/src/probe.ts                                    (Task 10)
packages/llm-unified/src/probe.test.ts                               (Task 10)
packages/llm-unified/tsconfig.test.json                              (Task 0)
apps/user-client/src/routes/onboarding/matrix.test.tsx               (Task 12)
```

**Modified:**

```
apps/user-client/package.json                                        (Task 0 — add dexie)
packages/llm-unified/package.json                                    (Task 0 — bun test, fake-indexeddb, deps)
packages/llm-unified/src/index.ts                                    (Task 11 — public exports)
apps/user-client/src/routes/onboarding/matrix.tsx                    (Task 12 — gating)
apps/user-client/src/boot/open-db.ts                                 (Task 2 — wire client-data-db open into boot)
```

---

## Task 0: Setup — dependencies and test runner

**Files:**
- Modify: `apps/user-client/package.json`
- Modify: `packages/llm-unified/package.json`
- Create: `packages/llm-unified/tsconfig.test.json`

- [ ] **Step 1: Add Dexie to user-client**

Edit `apps/user-client/package.json` to add Dexie under `dependencies` (alphabetical order, between `@tanstack/react-query` and `qr-scanner`):

```json
    "dexie": "^4.0.0",
```

- [ ] **Step 2: Add Bun test setup + fake-indexeddb to llm-unified**

Replace the existing `scripts.test`, add `scripts.typecheck`, and add `devDependencies` block in `packages/llm-unified/package.json`. Final shape:

```json
{
  "name": "@chatsundere/llm-unified",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "license": "LGPL-3.0-only",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "rm -rf dist && tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.test.json",
    "test": "bun test"
  },
  "devDependencies": {
    "@types/bun": "^1.3.14",
    "@types/node": "^22.0.0",
    "fake-indexeddb": "^6.0.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 3: Create `tsconfig.test.json` for llm-unified**

Create `packages/llm-unified/tsconfig.test.json` so `tsc -p tsconfig.test.json` typechecks tests too:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["bun"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 4: Install + verify**

Run from repo root:

```bash
pnpm install
pnpm --filter @chatsundere/user-client typecheck
pnpm --filter @chatsundere/llm-unified typecheck
```

Both must pass.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/package.json packages/llm-unified/package.json packages/llm-unified/tsconfig.test.json pnpm-lock.yaml
git commit -m "Add Dexie and Bun test setup for Block 1 backbone"
```

---

## Task 1: `secrets.ts` — sealSecret / openSecret helpers

**Files:**
- Create: `apps/user-client/src/lib/secrets.ts`
- Create: `apps/user-client/src/lib/secrets.test.ts`

The helpers derive a context-specific DEK from the MasterKey via the existing `@chatsundere/crypto` `deriveDek('block1/secrets-v1')`, then encrypt with WebCrypto AES-GCM. Round-trip + tamper-detection are covered by unit tests.

- [ ] **Step 1: Write the failing test file**

Create `apps/user-client/src/lib/secrets.test.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeAll } from 'vitest';
import { asMasterKey, getRandomBytes, type MasterKey } from '@chatsundere/crypto';
import { sealSecret, openSecret, type EncryptedBlob } from './secrets.js';

let mk: MasterKey;
let otherMk: MasterKey;

beforeAll(() => {
  mk = asMasterKey(getRandomBytes(32));
  otherMk = asMasterKey(getRandomBytes(32));
});

describe('sealSecret + openSecret', () => {
  it('round-trips an ASCII secret', async () => {
    const blob = await sealSecret('hello-world-api-key', mk);
    const plain = await openSecret(blob, mk);
    expect(plain).toBe('hello-world-api-key');
  });

  it('round-trips a Unicode secret', async () => {
    const secret = 'für-mich-und-😺-und-Ω';
    const blob = await sealSecret(secret, mk);
    const plain = await openSecret(blob, mk);
    expect(plain).toBe(secret);
  });

  it('produces version=1 blobs with 12-byte nonce', async () => {
    const blob = await sealSecret('x', mk);
    expect(blob.version).toBe(1);
    expect(blob.nonce.length).toBe(12);
    expect(blob.ciphertext.length).toBeGreaterThan(0);
  });

  it('produces distinct ciphertexts for the same plaintext (random nonce)', async () => {
    const a = await sealSecret('same-plaintext', mk);
    const b = await sealSecret('same-plaintext', mk);
    expect(a.nonce).not.toEqual(b.nonce);
    expect(a.ciphertext).not.toEqual(b.ciphertext);
  });

  it('fails to open with a different MasterKey', async () => {
    const blob = await sealSecret('top-secret', mk);
    await expect(openSecret(blob, otherMk)).rejects.toThrow();
  });

  it('fails to open a tampered ciphertext (AES-GCM auth tag check)', async () => {
    const blob = await sealSecret('top-secret', mk);
    const tampered: EncryptedBlob = {
      ...blob,
      ciphertext: new Uint8Array(blob.ciphertext),
    };
    tampered.ciphertext[0] = (tampered.ciphertext[0] ?? 0) ^ 0x01;
    await expect(openSecret(tampered, mk)).rejects.toThrow();
  });

  it('refuses to open a blob with unknown version', async () => {
    const blob = await sealSecret('x', mk);
    const wrongVersion = { ...blob, version: 99 as unknown as 1 };
    await expect(openSecret(wrongVersion, mk)).rejects.toThrow(/version/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @chatsundere/user-client test secrets.test.ts
```

Expected: FAIL (`secrets.js` does not exist or has no exports).

- [ ] **Step 3: Implement `secrets.ts`**

Create `apps/user-client/src/lib/secrets.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { deriveDek, getRandomBytes, type MasterKey } from '@chatsundere/crypto';

const SECRETS_DEK_CONTEXT = 'block1/secrets-v1';
const NONCE_BYTES = 12;
const VERSION = 1 as const;

export interface EncryptedBlob {
  version: typeof VERSION;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
}

/**
 * Seal a UTF-8 string under the user's MasterKey using a Block-1-scoped DEK.
 * Random 12-byte nonce. No AAD. Output is structured-clone-safe for Dexie.
 */
export async function sealSecret(plaintext: string, mk: MasterKey): Promise<EncryptedBlob> {
  const dek = await deriveDek(mk, SECRETS_DEK_CONTEXT);
  const nonce = getRandomBytes(NONCE_BYTES);
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    dek as unknown as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );
  const ciphertextBuf = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as BufferSource },
    cryptoKey,
    new TextEncoder().encode(plaintext) as BufferSource,
  );
  return { version: VERSION, ciphertext: new Uint8Array(ciphertextBuf), nonce };
}

/**
 * Open a previously-sealed blob with the same MasterKey. Throws if the
 * version is unknown or the AES-GCM auth tag fails (wrong key, tamper).
 */
export async function openSecret(blob: EncryptedBlob, mk: MasterKey): Promise<string> {
  if (blob.version !== VERSION) {
    throw new Error(`unsupported EncryptedBlob version: ${blob.version}`);
  }
  const dek = await deriveDek(mk, SECRETS_DEK_CONTEXT);
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    dek as unknown as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );
  const plainBuf = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: blob.nonce as BufferSource },
    cryptoKey,
    blob.ciphertext as BufferSource,
  );
  return new TextDecoder().decode(plainBuf);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @chatsundere/user-client test secrets.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/secrets.ts apps/user-client/src/lib/secrets.test.ts
git commit -m "Add sealSecret/openSecret helpers backed by Block-1-scoped DEK"
```

---

## Task 2: `client-data-db.ts` — Dexie schema, migration, seeding

**Files:**
- Create: `apps/user-client/src/boot/client-data-db.ts`
- Create: `apps/user-client/src/boot/client-data-db.test.ts`
- Modify: `apps/user-client/src/boot/open-db.ts`

The Dexie DB `chatsundere_client_data` lives alongside the crypto-managed `chatsundere` DB. Per spec § 2 Decision 8, schema is declarative; v1 seeds three built-in mindspaces and the singleton settings row. Boot wires the new DB open call into the existing `openDb()` flow.

- [ ] **Step 1: Write the failing test file**

Create `apps/user-client/src/boot/client-data-db.test.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  openClientDataDb,
  resetClientDataDbForTests,
  type MindspaceRow,
  type SettingsRow,
} from './client-data-db.js';

beforeEach(async () => {
  await resetClientDataDbForTests();
});

describe('chatsundere_client_data Dexie schema', () => {
  it('opens cleanly on a fresh origin', async () => {
    const db = await openClientDataDb();
    expect(db.verno).toBe(1);
  });

  it('seeds three built-in mindspaces on first open', async () => {
    const db = await openClientDataDb();
    const all = await db.mindspaces.toArray();
    const names = all.map((m) => m.displayName).sort();
    expect(names).toEqual(['Aurum', 'Azuro', 'Verdan']);
    expect(all.every((m: MindspaceRow) => m.builtIn === true)).toBe(true);
  });

  it('seeds the settings singleton with Aurum as default mindspace', async () => {
    const db = await openClientDataDb();
    const settings = await db.settings.get(1);
    expect(settings).toBeDefined();
    expect(settings?.id).toBe(1);
    const aurum = await db.mindspaces.where('displayName').equals('Aurum').first();
    expect(aurum).toBeDefined();
    expect(settings?.defaultMindspaceId).toBe(aurum!.id);
    expect(settings?.globalUnlockerPrompt).toBe('');
    expect(settings?.globalAboutMe).toBe('');
    expect(settings?.corsProxy).toBeNull();
  });

  it('is idempotent on re-open — does not double-seed', async () => {
    await openClientDataDb();
    await resetClientDataDbForTests({ keepData: true });
    const db2 = await openClientDataDb();
    const all = await db2.mindspaces.toArray();
    expect(all.length).toBe(3);
    const settingsRows = await db2.settings.toArray();
    expect(settingsRows.length).toBe(1);
  });

  it('has the declared compound indices', async () => {
    const db = await openClientDataDb();
    const schema = db.tables.find((t) => t.name === 'messages');
    expect(schema).toBeDefined();
    expect(schema!.schema.indexes.some((i) => i.name === '[chatId+createdAt]')).toBe(true);
    const chatSchema = db.tables.find((t) => t.name === 'chats');
    expect(chatSchema!.schema.indexes.some((i) => i.name === '[personaId+lastMessageAt]')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @chatsundere/user-client test client-data-db.test.ts
```

Expected: FAIL (module does not exist).

- [ ] **Step 3: Implement `client-data-db.ts`**

Create `apps/user-client/src/boot/client-data-db.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import Dexie, { type Table } from 'dexie';
import type { EncryptedBlob } from '../lib/secrets.js';

const DB_NAME = 'chatsundere_client_data';

// ===== Row types =====

export interface SettingsRow {
  id: 1;
  globalUnlockerPrompt: string;
  globalAboutMe: string;
  defaultMindspaceId: string;
  animationsEnabled: boolean;
  corsProxy: { url: string; sharedKey: EncryptedBlob } | null;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderRow {
  id: string;
  templateId: string;
  displayName: string;
  baseUrl: string;
  apiKey: EncryptedBlob;
  routing: { kind: 'direct' } | { kind: 'cors-proxy' };
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface MindspacePalette {
  bg: string;
  surfaceBase: string;
  surfaceRaised: string;
  surfaceInput: string;
  accent: string;
  accentSubtle: string;
  accentBorder: string;
  accentBorderActive: string;
  accentGlow: string;
  text: {
    primary: string;
    secondary: string;
    muted: string;
    ghost: string;
  };
}

export type MindspaceTexture = 'cloudy';

export interface MindspaceRow {
  id: string;
  displayName: string;
  palette: MindspacePalette;
  texture: MindspaceTexture;
  builtIn: boolean;
  createdAt: number;
}

export interface PersonaRow {
  id: string;
  name: string;
  colour: string;
  font: 'sans' | 'serif' | 'cursive';
  instructions: string;
  providerId: string;
  modelId: string;
  mindspaceId: string | null;
  aboutMeOverride: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ChatRow {
  id: string;
  personaId: string;
  title: string | null;
  resolvedMindspaceId: string;
  createdAt: number;
  lastMessageAt: number;
  bookmarkedMessageCount: number;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'pill'; pillId: string };

export interface MessageRow {
  id: string;
  chatId: string;
  role: 'user' | 'persona' | 'system';
  contentBlocks: ContentBlock[];
  createdAt: number;
  bookmarked: boolean;
  streamingState: 'complete' | 'incomplete';
}

export interface PillRow {
  id: string;
  messageId: string;
  kind: 'tool-call' | 'kb-injection' | 'image-result' | 'voice-expression';
  positionHint: 'inline' | 'above-text';
  status: 'pending' | 'completed' | 'failed';
  payload: unknown;
  createdAt: number;
}

// ===== Dexie subclass =====

class ClientDataDb extends Dexie {
  settings!: Table<SettingsRow, 1>;
  providers!: Table<ProviderRow, string>;
  mindspaces!: Table<MindspaceRow, string>;
  personas!: Table<PersonaRow, string>;
  chats!: Table<ChatRow, string>;
  messages!: Table<MessageRow, string>;
  pills!: Table<PillRow, string>;

  constructor() {
    super(DB_NAME);
    this.version(1).stores({
      settings: 'id',
      providers: 'id, templateId, enabled',
      mindspaces: 'id, builtIn, displayName',
      personas: 'id, providerId',
      chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
      messages: 'id, chatId, [chatId+createdAt]',
      pills: 'id, messageId',
    });
  }
}

let dbHandle: ClientDataDb | null = null;
let pending: Promise<ClientDataDb> | null = null;

/**
 * Open the user-client data DB and seed built-in mindspaces + settings
 * singleton on first launch. Idempotent — re-running with seeded state
 * is a no-op.
 */
export function openClientDataDb(): Promise<ClientDataDb> {
  if (dbHandle) return Promise.resolve(dbHandle);
  if (pending) return pending;
  pending = (async () => {
    const db = new ClientDataDb();
    await db.open();
    await seedBuiltinsIfNeeded(db);
    dbHandle = db;
    pending = null;
    return db;
  })();
  return pending;
}

export function getClientDataDb(): ClientDataDb {
  if (!dbHandle) throw new Error('client-data DB not opened — call openClientDataDb() during boot first');
  return dbHandle;
}

/**
 * Reset the in-process handle. Used by tests to force re-open against
 * fake-indexeddb between cases. `keepData: true` preserves the underlying
 * IndexedDB content (so we can prove seeding is idempotent across opens).
 */
export async function resetClientDataDbForTests(opts: { keepData?: boolean } = {}): Promise<void> {
  if (dbHandle) {
    dbHandle.close();
    dbHandle = null;
  }
  pending = null;
  if (!opts.keepData) {
    await Dexie.delete(DB_NAME);
  }
}

// ===== Seeding =====

async function seedBuiltinsIfNeeded(db: ClientDataDb): Promise<void> {
  const existingSettings = await db.settings.get(1);
  if (existingSettings) return;  // already seeded — no-op

  const now = Date.now();
  const aurumId = crypto.randomUUID();
  const azuroId = crypto.randomUUID();
  const verdanId = crypto.randomUUID();

  await db.transaction('rw', db.mindspaces, db.settings, async () => {
    await db.mindspaces.bulkAdd([
      buildMindspace(aurumId, 'Aurum', '#c9a84c', now),
      buildMindspace(azuroId, 'Azuro', '#7c9ede', now),
      buildMindspace(verdanId, 'Verdan', '#74c69d', now),
    ]);
    await db.settings.add({
      id: 1,
      globalUnlockerPrompt: '',
      globalAboutMe: '',
      defaultMindspaceId: aurumId,
      animationsEnabled: true,
      corsProxy: null,
      createdAt: now,
      updatedAt: now,
    });
  });
}

function buildMindspace(id: string, displayName: string, accentHex: string, now: number): MindspaceRow {
  const accentRgb = hexToRgb(accentHex);
  const textBase = textRgbForAccent(accentHex);
  return {
    id,
    displayName,
    palette: {
      bg: '#0a0a0a',
      surfaceBase: 'rgba(255,255,255,0.025)',
      surfaceRaised: 'rgba(255,255,255,0.04)',
      surfaceInput: 'rgba(0,0,0,0.3)',
      accent: accentHex,
      accentSubtle: `rgba(${accentRgb},0.06)`,
      accentBorder: `rgba(${accentRgb},0.15)`,
      accentBorderActive: `rgba(${accentRgb},0.35)`,
      accentGlow: `rgba(${accentRgb},0.08)`,
      text: {
        primary: textBase.primary,
        secondary: textBase.secondary,
        muted: `rgba(${textBase.rgb},0.4)`,
        ghost: `rgba(${textBase.rgb},0.2)`,
      },
    },
    texture: 'cloudy',
    builtIn: true,
    createdAt: now,
  };
}

function hexToRgb(hex: string): string {
  const v = hex.replace('#', '');
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `${r},${g},${b}`;
}

function textRgbForAccent(accentHex: string): { primary: string; secondary: string; rgb: string } {
  // Block-1 provisional: text is a desaturated tint of the accent.
  // Lyra will finalise per-mindspace text palettes; this keeps the
  // resolution engine demonstrable until then.
  const v = accentHex.replace('#', '');
  const r = Math.min(255, parseInt(v.slice(0, 2), 16) + 60);
  const g = Math.min(255, parseInt(v.slice(2, 4), 16) + 60);
  const b = Math.min(255, parseInt(v.slice(4, 6), 16) + 60);
  return {
    primary: `rgb(${r},${g},${b})`,
    secondary: `rgb(${Math.max(0, r - 8)},${Math.max(0, g - 8)},${Math.max(0, b - 8)})`,
    rgb: `${r},${g},${b}`,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @chatsundere/user-client test client-data-db.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Wire `openClientDataDb()` into the existing boot flow**

Modify `apps/user-client/src/boot/open-db.ts` so the boot opens both databases in parallel. Replace the file contents with:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { openLocalDb } from '@chatsundere/crypto';
import { openClientDataDb } from './client-data-db.js';

let dbHandle: IDBDatabase | null = null;
let pending: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbHandle) return Promise.resolve(dbHandle);
  if (pending) return pending;
  pending = (async () => {
    const [crypto, _client] = await Promise.all([openLocalDb(), openClientDataDb()]);
    dbHandle = crypto;
    pending = null;
    return crypto;
  })();
  return pending;
}

export function getDb(): IDBDatabase {
  if (!dbHandle) throw new Error('IDB not opened — call openDb() during boot first');
  return dbHandle;
}
```

- [ ] **Step 6: Run the user-client typecheck and existing tests**

```bash
pnpm --filter @chatsundere/user-client typecheck
pnpm --filter @chatsundere/user-client test
```

Both must pass. (Pre-existing tests must not regress; the new tests added above must still pass.)

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/boot/client-data-db.ts apps/user-client/src/boot/client-data-db.test.ts apps/user-client/src/boot/open-db.ts
git commit -m "Add chatsundere_client_data Dexie DB with built-in mindspaces and settings seeding"
```

---

## Task 3: `llm-unified/types.ts` — public types

**Files:**
- Create: `packages/llm-unified/src/types.ts`

Pure type definitions. No runtime, no tests. Used by every other llm-unified file.

- [ ] **Step 1: Create the types file**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only

export type Capability = 'llm' | 'streaming' | 'tools' | 'json-mode' | 'vision';

export interface ConfigField {
  key: string;
  label: string;
  fieldType: 'text' | 'password' | 'url' | 'select';
  secret: boolean;
  required: boolean;
  description: string;
  options?: { value: string; label: string }[];
}

export interface KnownModel {
  id: string;
  displayName: string;
  notes?: string;
}

export interface ProviderDefinition {
  id: string;
  displayName: string;
  iconKey: string;
  baseUrl: string;
  shape: 'openai-chat-completions';
  capabilities: Capability[];
  configFields: ConfigField[];
  probe: { path: string; method: 'GET' | 'POST' };
  secretFields: ReadonlySet<string>;
  corsHint: 'direct' | 'inofficial' | 'requires-proxy';
  knownModels: KnownModel[];
  sortPriority: number;
}

export interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
}

export type StreamChunk =
  | { type: 'token'; text: string }
  | { type: 'tool-call'; toolCallId: string; name: string; argumentsJson: string }
  | { type: 'finish'; reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'unknown' }
  | { type: 'error'; message: string };

export interface ProbeResult {
  ok: boolean;
  status: number;
  modelCount?: number;
  reason?: string;
}

/**
 * Minimal view onto a stored `ProviderRow`. Pass into transport/adapter
 * without coupling llm-unified to the user-client persistence types.
 */
export interface ProviderConfig {
  baseUrl: string;
  routing: { kind: 'direct' } | { kind: 'cors-proxy' };
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @chatsundere/llm-unified typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/llm-unified/src/types.ts
git commit -m "Add llm-unified public type definitions"
```

---

## Task 4: `llm-unified/composition.ts` — system-prompt composition

**Files:**
- Create: `packages/llm-unified/src/composition.ts`
- Create: `packages/llm-unified/src/composition.test.ts`

Pure functional module per spec § 4.4. Joins non-empty layers in the fixed order. Block-1 always passes empty Project + Memory; the slots exist for forward compatibility.

- [ ] **Step 1: Write the failing test file**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, it, expect } from 'bun:test';
import { composeSystemPrompt, type CompositionLayers } from './composition.js';

function baseLayers(overrides: Partial<CompositionLayers> = {}): CompositionLayers {
  return {
    globalUnlocker: '',
    aboutMe: '',
    personaInstructions: 'You are a helpful assistant.',
    projectInstructions: '',
    memoryContext: '',
    ...overrides,
  };
}

describe('composeSystemPrompt', () => {
  it('returns just the persona instructions when only that layer is set', () => {
    const out = composeSystemPrompt(baseLayers());
    expect(out).toBe('You are a helpful assistant.');
  });

  it('joins layers in the spec-defined order with blank-line separators', () => {
    const out = composeSystemPrompt(baseLayers({
      globalUnlocker: 'The user is an adult.',
      aboutMe: 'Chris is a backend developer.',
      personaInstructions: 'You are Aurum.',
      projectInstructions: 'This project explores mindspace textures.',
      memoryContext: 'Previously: discussed cloudy textures.',
    }));
    expect(out).toBe(
      'The user is an adult.\n\nChris is a backend developer.\n\nYou are Aurum.\n\nThis project explores mindspace textures.\n\nPreviously: discussed cloudy textures.',
    );
  });

  it('skips empty layers without leaving blank-line gaps', () => {
    const out = composeSystemPrompt(baseLayers({
      globalUnlocker: 'NSFW allowed.',
      personaInstructions: 'You are Aurum.',
    }));
    expect(out).toBe('NSFW allowed.\n\nYou are Aurum.');
  });

  it('treats whitespace-only layers as empty', () => {
    const out = composeSystemPrompt(baseLayers({
      aboutMe: '   \n  ',
      personaInstructions: 'You are Aurum.',
    }));
    expect(out).toBe('You are Aurum.');
  });

  it('is idempotent — composing twice with the same input yields the same output', () => {
    const layers = baseLayers({ globalUnlocker: 'X', aboutMe: 'Y' });
    expect(composeSystemPrompt(layers)).toBe(composeSystemPrompt(layers));
  });

  it('throws when persona instructions is empty', () => {
    expect(() => composeSystemPrompt(baseLayers({ personaInstructions: '' }))).toThrow(/personaInstructions/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd packages/llm-unified && bun test composition.test.ts
```

Expected: FAIL (module does not exist).

- [ ] **Step 3: Implement `composition.ts`**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only

export interface CompositionLayers {
  globalUnlocker: string;
  aboutMe: string;
  personaInstructions: string;
  projectInstructions: string;
  memoryContext: string;
}

const LAYER_ORDER: readonly (keyof CompositionLayers)[] = [
  'globalUnlocker',
  'aboutMe',
  'personaInstructions',
  'projectInstructions',
  'memoryContext',
];

/**
 * Compose the final system prompt from independently-editable layers.
 * Order (top → bottom) per UX-CONCEPT § "System Prompt Composition":
 * Global Unlocker → About-Me → Persona-Instructions → Project-Instructions
 * → Memory-Context. Whitespace-only layers are treated as empty and
 * skipped. The composed prompt becomes the `system` role content.
 */
export function composeSystemPrompt(layers: CompositionLayers): string {
  if (layers.personaInstructions.trim().length === 0) {
    throw new Error('composeSystemPrompt: personaInstructions must be non-empty');
  }
  const parts: string[] = [];
  for (const key of LAYER_ORDER) {
    const value = layers[key];
    if (value.trim().length > 0) parts.push(value.trim());
  }
  return parts.join('\n\n');
}
```

- [ ] **Step 4: Run to verify pass**

```bash
cd packages/llm-unified && bun test composition.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/composition.ts packages/llm-unified/src/composition.test.ts
git commit -m "Add llm-unified composeSystemPrompt pure module + tests"
```

---

## Task 5: `llm-unified/registry.ts` — provider registry

**Files:**
- Create: `packages/llm-unified/src/registry.ts`
- Create: `packages/llm-unified/src/registry.test.ts`

Flat module-level registry, ported from `../chatsune/backend/modules/providers/_registry.py`. Exposes `registerProvider`, `getProvider`, `listProviders`. Block-1 built-ins land via Task 6.

- [ ] **Step 1: Write the failing test file**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  registerProvider,
  getProvider,
  listProviders,
  _resetRegistryForTests,
} from './registry.js';
import type { ProviderDefinition } from './types.js';

function makeDef(id: string, sortPriority = 100): ProviderDefinition {
  return {
    id,
    displayName: `provider-${id}`,
    iconKey: id,
    baseUrl: `https://${id}.example.com`,
    shape: 'openai-chat-completions',
    capabilities: ['llm', 'streaming'],
    configFields: [],
    probe: { path: '/models', method: 'GET' },
    secretFields: new Set(['api_key']),
    corsHint: 'direct',
    knownModels: [],
    sortPriority,
  };
}

beforeEach(() => {
  _resetRegistryForTests();
});

describe('provider registry', () => {
  it('registers and retrieves a provider', () => {
    const defn = makeDef('alpha');
    registerProvider(defn);
    expect(getProvider('alpha')).toBe(defn);
  });

  it('returns undefined for unknown provider ids', () => {
    expect(getProvider('nope')).toBeUndefined();
  });

  it('throws on duplicate registration', () => {
    registerProvider(makeDef('alpha'));
    expect(() => registerProvider(makeDef('alpha'))).toThrow(/already registered/);
  });

  it('lists providers sorted by sortPriority ascending, then by registration order', () => {
    const a = makeDef('alpha', 30);
    const b = makeDef('bravo', 10);
    const c = makeDef('charlie', 20);
    const d = makeDef('delta', 20);    // ties broken by registration order
    registerProvider(a);
    registerProvider(b);
    registerProvider(c);
    registerProvider(d);
    expect(listProviders().map((p) => p.id)).toEqual(['bravo', 'charlie', 'delta', 'alpha']);
  });

  it('listProviders returns a copy (mutations do not leak back into registry)', () => {
    registerProvider(makeDef('alpha'));
    const list = listProviders();
    list.pop();
    expect(listProviders().length).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd packages/llm-unified && bun test registry.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `registry.ts`**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
import type { ProviderDefinition } from './types.js';

interface Entry {
  defn: ProviderDefinition;
  order: number;
}

let counter = 0;
const registry = new Map<string, Entry>();

/**
 * Register a provider definition. Duplicate ids throw — registration is
 * expected to happen exactly once at module load.
 */
export function registerProvider(defn: ProviderDefinition): void {
  if (registry.has(defn.id)) {
    throw new Error(`provider '${defn.id}' already registered`);
  }
  registry.set(defn.id, { defn, order: counter++ });
}

export function getProvider(id: string): ProviderDefinition | undefined {
  return registry.get(id)?.defn;
}

/**
 * All registered providers, sorted by sortPriority ascending. Ties are
 * broken by registration order. Returns a fresh array on each call so
 * callers can mutate freely.
 */
export function listProviders(): ProviderDefinition[] {
  return [...registry.values()]
    .sort((a, b) => a.defn.sortPriority - b.defn.sortPriority || a.order - b.order)
    .map((e) => e.defn);
}

/** Test-only — clears registry state. */
export function _resetRegistryForTests(): void {
  registry.clear();
  counter = 0;
}
```

- [ ] **Step 4: Run to verify pass**

```bash
cd packages/llm-unified && bun test registry.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/registry.ts packages/llm-unified/src/registry.test.ts
git commit -m "Add llm-unified provider registry with sortPriority ordering"
```

---

## Task 6: Built-in providers — nano-gpt, Novita, Ollama Cloud

**Files:**
- Create: `packages/llm-unified/src/providers/_helpers.ts`
- Create: `packages/llm-unified/src/providers/nano-gpt.ts`
- Create: `packages/llm-unified/src/providers/novita.ts`
- Create: `packages/llm-unified/src/providers/ollama-cloud.ts`
- Create: `packages/llm-unified/src/providers/_register-builtins.ts`
- Create: `packages/llm-unified/src/providers/builtins.test.ts`

Three pre-registered providers per spec § 4.2. All share the OpenAI-chat-completions shape; CORS hints differ.

- [ ] **Step 1: Write the failing test file**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, it, expect, beforeAll } from 'bun:test';
import { _resetRegistryForTests, listProviders, getProvider } from '../registry.js';
import { registerBuiltinProviders } from './_register-builtins.js';

beforeAll(() => {
  _resetRegistryForTests();
  registerBuiltinProviders();
});

describe('built-in providers', () => {
  it('registers nano-gpt, novita, ollama-cloud — exactly three', () => {
    const ids = listProviders().map((p) => p.id);
    expect(ids).toEqual(['nano-gpt', 'novita', 'ollama-cloud']);
  });

  it('nano-gpt has inofficial CORS hint and one known model', () => {
    const p = getProvider('nano-gpt')!;
    expect(p.corsHint).toBe('inofficial');
    expect(p.knownModels.map((m) => m.id)).toEqual(['deepseek-v4-flash']);
    expect(p.shape).toBe('openai-chat-completions');
  });

  it('novita has direct CORS hint and GLM 5.1', () => {
    const p = getProvider('novita')!;
    expect(p.corsHint).toBe('direct');
    expect(p.knownModels.map((m) => m.id)).toEqual(['glm-5.1']);
  });

  it('ollama-cloud requires proxy and has Kimi K2.6', () => {
    const p = getProvider('ollama-cloud')!;
    expect(p.corsHint).toBe('requires-proxy');
    expect(p.knownModels.map((m) => m.id)).toEqual(['kimi-k2.6']);
  });

  it('every built-in declares an api_key config field marked secret + required', () => {
    for (const p of listProviders()) {
      const apiKey = p.configFields.find((f) => f.key === 'api_key');
      expect(apiKey).toBeDefined();
      expect(apiKey!.secret).toBe(true);
      expect(apiKey!.required).toBe(true);
      expect(p.secretFields.has('api_key')).toBe(true);
    }
  });

  it('every built-in declares a probe at /models GET', () => {
    for (const p of listProviders()) {
      expect(p.probe.path).toBe('/models');
      expect(p.probe.method).toBe('GET');
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd packages/llm-unified && bun test providers/builtins.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `_helpers.ts`**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
import type { ConfigField } from '../types.js';

export function apiKeyField(label: string): ConfigField {
  return {
    key: 'api_key',
    label,
    fieldType: 'password',
    secret: true,
    required: true,
    description: 'Encrypted at rest using your Master Key. Stored only on this device.',
  };
}
```

- [ ] **Step 4: Implement `nano-gpt.ts`**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
import { registerProvider } from '../registry.js';
import { apiKeyField } from './_helpers.js';

export function registerNanoGpt(): void {
  registerProvider({
    id: 'nano-gpt',
    displayName: 'nano-gpt',
    iconKey: 'nano-gpt',
    baseUrl: 'https://nano-gpt.com/api/v1',
    shape: 'openai-chat-completions',
    capabilities: ['llm', 'streaming'],
    configFields: [apiKeyField('nano-gpt API key')],
    probe: { path: '/models', method: 'GET' },
    secretFields: new Set(['api_key']),
    corsHint: 'inofficial',
    knownModels: [
      { id: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash', notes: 'Block 1 demo default' },
    ],
    sortPriority: 10,
  });
}
```

- [ ] **Step 5: Implement `novita.ts`**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
import { registerProvider } from '../registry.js';
import { apiKeyField } from './_helpers.js';

export function registerNovita(): void {
  registerProvider({
    id: 'novita',
    displayName: 'Novita AI',
    iconKey: 'novita',
    baseUrl: 'https://api.novita.ai/v3/openai',
    shape: 'openai-chat-completions',
    capabilities: ['llm', 'streaming'],
    configFields: [apiKeyField('Novita AI API key')],
    probe: { path: '/models', method: 'GET' },
    secretFields: new Set(['api_key']),
    corsHint: 'direct',
    knownModels: [
      { id: 'glm-5.1', displayName: 'GLM 5.1', notes: 'The exotic one' },
    ],
    sortPriority: 20,
  });
}
```

- [ ] **Step 6: Implement `ollama-cloud.ts`**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
import { registerProvider } from '../registry.js';
import { apiKeyField } from './_helpers.js';

export function registerOllamaCloud(): void {
  registerProvider({
    id: 'ollama-cloud',
    displayName: 'Ollama Cloud',
    iconKey: 'ollama',
    baseUrl: 'https://ollama.com/v1',
    shape: 'openai-chat-completions',
    capabilities: ['llm', 'streaming'],
    configFields: [apiKeyField('Ollama Cloud API key')],
    probe: { path: '/models', method: 'GET' },
    secretFields: new Set(['api_key']),
    corsHint: 'requires-proxy',
    knownModels: [
      { id: 'kimi-k2.6', displayName: 'Kimi K2.6', notes: 'Block 1 demo default; routes via cors-proxy' },
    ],
    sortPriority: 30,
  });
}
```

- [ ] **Step 7: Implement `_register-builtins.ts`**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
import { registerNanoGpt } from './nano-gpt.js';
import { registerNovita } from './novita.js';
import { registerOllamaCloud } from './ollama-cloud.js';

/**
 * Register all Block-1 built-in providers. Called once at package import
 * (see ../index.ts). Tests reset and re-call after _resetRegistryForTests.
 */
export function registerBuiltinProviders(): void {
  registerNanoGpt();
  registerNovita();
  registerOllamaCloud();
}
```

- [ ] **Step 8: Run to verify pass**

```bash
cd packages/llm-unified && bun test providers/builtins.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 9: Commit**

```bash
git add packages/llm-unified/src/providers/
git commit -m "Add Block-1 built-in providers (nano-gpt, Novita, Ollama Cloud)"
```

---

## Task 7: `transport.ts` — buildRequest with direct vs. cors-proxy routing

**Files:**
- Create: `packages/llm-unified/src/transport.ts`
- Create: `packages/llm-unified/src/transport.test.ts`

Pure builder. Returns a standard `Request` object the adapter can fetch. Direct mode hits `<baseUrl><path>` with `Authorization: Bearer`. cors-proxy mode hits `<proxyUrl><path>` with the three `x-cors-proxy-*` and `Authorization` headers per `../cors-proxy/README.md`.

- [ ] **Step 1: Write the failing test file**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, it, expect } from 'bun:test';
import { buildRequest } from './transport.js';
import type { ProviderConfig } from './types.js';

const directConfig: ProviderConfig = {
  baseUrl: 'https://nano-gpt.com/api/v1',
  routing: { kind: 'direct' },
};

const proxyConfig: ProviderConfig = {
  baseUrl: 'https://ollama.com/v1',
  routing: { kind: 'cors-proxy' },
};

describe('buildRequest', () => {
  it('builds a direct GET request with Bearer auth', () => {
    const req = buildRequest({
      provider: directConfig,
      apiKey: 'sk-abc',
      corsProxyUrl: null,
      corsProxyKey: null,
      path: '/models',
      method: 'GET',
    });
    expect(req.url).toBe('https://nano-gpt.com/api/v1/models');
    expect(req.method).toBe('GET');
    expect(req.headers.get('Authorization')).toBe('Bearer sk-abc');
    expect(req.headers.get('x-cors-proxy-api-key')).toBeNull();
  });

  it('builds a direct POST request with JSON body', async () => {
    const req = buildRequest({
      provider: directConfig,
      apiKey: 'sk-abc',
      corsProxyUrl: null,
      corsProxyKey: null,
      path: '/chat/completions',
      method: 'POST',
      body: { model: 'm', messages: [] },
    });
    expect(req.method).toBe('POST');
    expect(req.headers.get('Content-Type')).toBe('application/json');
    expect(await req.json()).toEqual({ model: 'm', messages: [] });
  });

  it('builds a via-cors-proxy request with rewritten URL and proxy headers', () => {
    const req = buildRequest({
      provider: proxyConfig,
      apiKey: 'sk-xyz',
      corsProxyUrl: 'https://cors-proxy.tidesson.net',
      corsProxyKey: 'proxy-secret',
      path: '/chat/completions',
      method: 'POST',
      body: {},
    });
    expect(req.url).toBe('https://cors-proxy.tidesson.net/chat/completions');
    expect(req.headers.get('x-cors-proxy-api-key')).toBe('proxy-secret');
    expect(req.headers.get('x-cors-proxy-target')).toBe('https://ollama.com/v1');
    expect(req.headers.get('Authorization')).toBe('Bearer sk-xyz');
    expect(req.headers.get('Content-Type')).toBe('application/json');
  });

  it('throws when cors-proxy routing is selected but proxy URL is missing', () => {
    expect(() =>
      buildRequest({
        provider: proxyConfig,
        apiKey: 'sk-xyz',
        corsProxyUrl: null,
        corsProxyKey: 'k',
        path: '/x',
        method: 'GET',
      }),
    ).toThrow(/cors-proxy URL/);
  });

  it('throws when cors-proxy routing is selected but proxy key is missing', () => {
    expect(() =>
      buildRequest({
        provider: proxyConfig,
        apiKey: 'sk-xyz',
        corsProxyUrl: 'https://cors-proxy.tidesson.net',
        corsProxyKey: null,
        path: '/x',
        method: 'GET',
      }),
    ).toThrow(/cors-proxy key/);
  });

  it('joins baseUrl + path correctly when baseUrl has trailing slash', () => {
    const req = buildRequest({
      provider: { baseUrl: 'https://nano-gpt.com/api/v1/', routing: { kind: 'direct' } },
      apiKey: 'k',
      corsProxyUrl: null,
      corsProxyKey: null,
      path: '/models',
      method: 'GET',
    });
    expect(req.url).toBe('https://nano-gpt.com/api/v1/models');
  });

  it('joins baseUrl + path correctly when path has no leading slash', () => {
    const req = buildRequest({
      provider: { baseUrl: 'https://nano-gpt.com/api/v1', routing: { kind: 'direct' } },
      apiKey: 'k',
      corsProxyUrl: null,
      corsProxyKey: null,
      path: 'models',
      method: 'GET',
    });
    expect(req.url).toBe('https://nano-gpt.com/api/v1/models');
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd packages/llm-unified && bun test transport.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `transport.ts`**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
import type { ProviderConfig } from './types.js';

export interface BuildRequestArgs {
  provider: ProviderConfig;
  apiKey: string;
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  path: string;
  method: 'GET' | 'POST';
  body?: unknown;
}

/**
 * Build a fetch-ready Request for the given provider. The Request's URL
 * and headers reflect the routing choice — direct fetch hits the upstream
 * with a Bearer Authorization header; via-cors-proxy routes through
 * Chris's generic CORS forwarder (`../cors-proxy/README.md` § Client
 * usage) with the proxy headers in place.
 */
export function buildRequest(args: BuildRequestArgs): Request {
  const { provider, apiKey, corsProxyUrl, corsProxyKey, path, method, body } = args;
  const headers = new Headers({ Authorization: `Bearer ${apiKey}` });
  if (method === 'POST') headers.set('Content-Type', 'application/json');

  let url: string;
  if (provider.routing.kind === 'direct') {
    url = joinUrl(provider.baseUrl, path);
  } else {
    if (!corsProxyUrl) {
      throw new Error('transport: cors-proxy routing selected but cors-proxy URL is missing');
    }
    if (!corsProxyKey) {
      throw new Error('transport: cors-proxy routing selected but cors-proxy key is missing');
    }
    url = joinUrl(corsProxyUrl, path);
    headers.set('x-cors-proxy-api-key', corsProxyKey);
    headers.set('x-cors-proxy-target', provider.baseUrl);
  }

  return new Request(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function joinUrl(base: string, path: string): string {
  const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const trimmedPath = path.startsWith('/') ? path : `/${path}`;
  return `${trimmedBase}${trimmedPath}`;
}
```

- [ ] **Step 4: Run to verify pass**

```bash
cd packages/llm-unified && bun test transport.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/transport.ts packages/llm-unified/src/transport.test.ts
git commit -m "Add llm-unified transport.buildRequest with direct and cors-proxy modes"
```

---

## Task 8: `streaming.ts` — SSE parser → `StreamChunk` iterable

**Files:**
- Create: `packages/llm-unified/src/streaming.ts`
- Create: `packages/llm-unified/src/streaming.test.ts`

Hand-written SSE parser over a `ReadableStream<Uint8Array>`. Handles `data: ` prefixes, the OpenAI `data: [DONE]` terminator, and parses each JSON payload into the relevant `StreamChunk`. AbortController integration uses `signal.addEventListener('abort')`.

- [ ] **Step 1: Write the failing test file**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, it, expect } from 'bun:test';
import { parseOpenAiSseStream } from './streaming.js';
import type { StreamChunk } from './types.js';

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

async function collect(iter: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of iter) out.push(c);
  return out;
}

describe('parseOpenAiSseStream', () => {
  it('parses three token deltas followed by [DONE]', async () => {
    const stream = streamOf(
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"!"}}]}\n\n',
      'data: [DONE]\n\n',
    );
    const chunks = await collect(parseOpenAiSseStream(stream));
    expect(chunks).toEqual([
      { type: 'token', text: 'Hel' },
      { type: 'token', text: 'lo' },
      { type: 'token', text: '!' },
    ]);
  });

  it('emits a finish chunk when a delta carries a finish_reason', async () => {
    const stream = streamOf(
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    );
    const chunks = await collect(parseOpenAiSseStream(stream));
    expect(chunks).toEqual([
      { type: 'token', text: 'hi' },
      { type: 'finish', reason: 'stop' },
    ]);
  });

  it('handles chunks split across multiple network reads', async () => {
    const stream = streamOf(
      'data: {"choices":[{"delta":{"con',
      'tent":"split"}}]}\n\n',
      'data: [DONE]\n\n',
    );
    const chunks = await collect(parseOpenAiSseStream(stream));
    expect(chunks).toEqual([{ type: 'token', text: 'split' }]);
  });

  it('ignores comment lines and blank lines', async () => {
    const stream = streamOf(
      ': keep-alive comment\n',
      '\n',
      'data: {"choices":[{"delta":{"content":"x"}}]}\n\n',
      'data: [DONE]\n\n',
    );
    const chunks = await collect(parseOpenAiSseStream(stream));
    expect(chunks).toEqual([{ type: 'token', text: 'x' }]);
  });

  it('emits an error chunk on malformed JSON', async () => {
    const stream = streamOf(
      'data: not-json\n\n',
      'data: [DONE]\n\n',
    );
    const chunks = await collect(parseOpenAiSseStream(stream));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.type).toBe('error');
  });

  it('aborts cleanly when the signal is fired mid-stream', async () => {
    const ac = new AbortController();
    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"a"}}]}\n\n'));
        // Never enqueue [DONE]; signal aborts the consumer instead.
      },
    });
    const iter = parseOpenAiSseStream(stream, { signal: ac.signal });
    const out: StreamChunk[] = [];
    const reader = (async () => {
      for await (const c of iter) {
        out.push(c);
        if (out.length === 1) ac.abort();
      }
    })();
    await reader;
    expect(out).toEqual([{ type: 'token', text: 'a' }]);
  });

  it('emits tool-call chunks when delta.tool_calls is present', async () => {
    const stream = streamOf(
      'data: {"choices":[{"delta":{"tool_calls":[{"id":"call_1","type":"function","function":{"name":"web_search","arguments":"{\\"q\\":\\"hi\\"}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    );
    const chunks = await collect(parseOpenAiSseStream(stream));
    expect(chunks).toEqual([
      { type: 'tool-call', toolCallId: 'call_1', name: 'web_search', argumentsJson: '{"q":"hi"}' },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd packages/llm-unified && bun test streaming.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `streaming.ts`**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
import type { StreamChunk } from './types.js';

export interface ParseOpts {
  signal?: AbortSignal;
}

/**
 * Parse an OpenAI-compatible SSE stream into a structured StreamChunk
 * AsyncIterable. Handles split chunks, comments, blank lines, the [DONE]
 * terminator, and abort signals.
 */
export async function* parseOpenAiSseStream(
  stream: ReadableStream<Uint8Array>,
  opts: ParseOpts = {},
): AsyncIterable<StreamChunk> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const onAbort = () => {
    void reader.cancel().catch(() => {});
  };
  opts.signal?.addEventListener('abort', onAbort);

  try {
    while (true) {
      if (opts.signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events end at \n\n. Process every complete event in the buffer.
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const event = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const chunks = parseEvent(event);
        for (const c of chunks) {
          if (c === DONE) return;
          yield c;
        }
      }
    }
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

const DONE = Symbol('done');
type EventOut = StreamChunk | typeof DONE;

function parseEvent(event: string): EventOut[] {
  const out: EventOut[] = [];
  for (const line of event.split('\n')) {
    if (line === '' || line.startsWith(':')) continue;
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trimStart();
    if (data === '[DONE]') {
      out.push(DONE);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch (e) {
      out.push({ type: 'error', message: `malformed SSE payload: ${(e as Error).message}` });
      continue;
    }
    out.push(...openAiPayloadToChunks(parsed));
  }
  return out;
}

interface OpenAiDeltaPayload {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
}

function openAiPayloadToChunks(payload: unknown): StreamChunk[] {
  const p = payload as OpenAiDeltaPayload;
  const choice = p.choices?.[0];
  if (!choice) return [];
  const out: StreamChunk[] = [];
  if (choice.delta?.content) {
    out.push({ type: 'token', text: choice.delta.content });
  }
  if (choice.delta?.tool_calls) {
    for (const tc of choice.delta.tool_calls) {
      if (tc.id && tc.function?.name && typeof tc.function.arguments === 'string') {
        out.push({
          type: 'tool-call',
          toolCallId: tc.id,
          name: tc.function.name,
          argumentsJson: tc.function.arguments,
        });
      }
    }
  }
  if (choice.finish_reason) {
    out.push({ type: 'finish', reason: normaliseFinishReason(choice.finish_reason) });
  }
  return out;
}

function normaliseFinishReason(reason: string): 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'unknown' {
  switch (reason) {
    case 'stop':
    case 'length':
    case 'tool_calls':
    case 'content_filter':
      return reason;
    default:
      return 'unknown';
  }
}
```

- [ ] **Step 4: Run to verify pass**

```bash
cd packages/llm-unified && bun test streaming.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/streaming.ts packages/llm-unified/src/streaming.test.ts
git commit -m "Add llm-unified OpenAI SSE stream parser"
```

---

## Task 9: `adapters/openai-chat-completions.ts` — streamCompletion

**Files:**
- Create: `packages/llm-unified/src/adapters/openai-chat-completions.ts`
- Create: `packages/llm-unified/src/adapters/openai-chat-completions.test.ts`

Glue between transport (request) + streaming (parser). Issues the POST to `/chat/completions`, validates the response, and yields parsed chunks.

- [ ] **Step 1: Write the failing test file**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, it, expect, beforeEach } from 'bun:test';
import { streamCompletion } from './openai-chat-completions.js';
import type { ProviderConfig, StreamChunk, WireMessage } from '../types.js';

const directProvider: ProviderConfig = {
  baseUrl: 'https://nano-gpt.com/api/v1',
  routing: { kind: 'direct' },
};

const messages: WireMessage[] = [
  { role: 'system', content: 'You are Aurum.' },
  { role: 'user', content: 'Hi.' },
];

let fetchCalls: Array<{ url: string; init: RequestInit; bodyText: string }> = [];

beforeEach(() => {
  fetchCalls = [];
});

function mockFetchWithSse(sseBody: string): typeof fetch {
  return async (input, init) => {
    const req = input as Request;
    const bodyText = await req.text();
    fetchCalls.push({ url: req.url, init: init ?? {}, bodyText });
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sseBody));
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
}

async function collect(iter: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of iter) out.push(c);
  return out;
}

describe('streamCompletion (openai-chat-completions)', () => {
  it('POSTs to /chat/completions with the expected body', async () => {
    const fetchFn = mockFetchWithSse(
      'data: {"choices":[{"delta":{"content":"x"}}]}\n\ndata: [DONE]\n\n',
    );
    await collect(
      streamCompletion({
        provider: directProvider,
        apiKey: 'sk-test',
        corsProxyUrl: null,
        corsProxyKey: null,
        messages,
        modelId: 'deepseek-v4-flash',
        fetchFn,
      }),
    );
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.url).toBe('https://nano-gpt.com/api/v1/chat/completions');
    const body = JSON.parse(fetchCalls[0]!.bodyText);
    expect(body.model).toBe('deepseek-v4-flash');
    expect(body.messages).toEqual(messages);
    expect(body.stream).toBe(true);
  });

  it('yields parsed chunks from the SSE body', async () => {
    const fetchFn = mockFetchWithSse(
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' +
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
        'data: [DONE]\n\n',
    );
    const chunks = await collect(
      streamCompletion({
        provider: directProvider,
        apiKey: 'sk-test',
        corsProxyUrl: null,
        corsProxyKey: null,
        messages,
        modelId: 'deepseek-v4-flash',
        fetchFn,
      }),
    );
    expect(chunks).toEqual([
      { type: 'token', text: 'hi' },
      { type: 'finish', reason: 'stop' },
    ]);
  });

  it('emits an error chunk on non-2xx response with the upstream status', async () => {
    const fetchFn: typeof fetch = async () =>
      new Response('rate-limited', { status: 429 });
    const chunks = await collect(
      streamCompletion({
        provider: directProvider,
        apiKey: 'sk-test',
        corsProxyUrl: null,
        corsProxyKey: null,
        messages,
        modelId: 'deepseek-v4-flash',
        fetchFn,
      }),
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.type).toBe('error');
    if (chunks[0]?.type === 'error') {
      expect(chunks[0].message).toMatch(/429/);
    }
  });

  it('emits an error chunk when the response has no body', async () => {
    const fetchFn: typeof fetch = async () => new Response(null, { status: 200 });
    const chunks = await collect(
      streamCompletion({
        provider: directProvider,
        apiKey: 'sk-test',
        corsProxyUrl: null,
        corsProxyKey: null,
        messages,
        modelId: 'deepseek-v4-flash',
        fetchFn,
      }),
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.type).toBe('error');
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd packages/llm-unified && bun test adapters/openai-chat-completions.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `adapters/openai-chat-completions.ts`**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
import { buildRequest } from '../transport.js';
import { parseOpenAiSseStream } from '../streaming.js';
import type { ProviderConfig, StreamChunk, WireMessage } from '../types.js';

export interface StreamCompletionArgs {
  provider: ProviderConfig;
  apiKey: string;
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  messages: WireMessage[];
  modelId: string;
  signal?: AbortSignal;
  /** Override for testing — defaults to globalThis.fetch. */
  fetchFn?: typeof fetch;
}

/**
 * Stream a chat completion through an OpenAI-chat-completions-compatible
 * provider. The provider's transport (direct or cors-proxy) is honoured
 * by `buildRequest`. The SSE stream is parsed by `parseOpenAiSseStream`.
 * Errors at the HTTP layer are surfaced as an `error` StreamChunk so the
 * caller can render them inline on the in-flight message.
 */
export async function* streamCompletion(args: StreamCompletionArgs): AsyncIterable<StreamChunk> {
  const fetchFn = args.fetchFn ?? globalThis.fetch.bind(globalThis);
  const request = buildRequest({
    provider: args.provider,
    apiKey: args.apiKey,
    corsProxyUrl: args.corsProxyUrl,
    corsProxyKey: args.corsProxyKey,
    path: '/chat/completions',
    method: 'POST',
    body: {
      model: args.modelId,
      messages: args.messages,
      stream: true,
    },
  });

  let response: Response;
  try {
    response = await fetchFn(request);
  } catch (e) {
    yield { type: 'error', message: `fetch failed: ${(e as Error).message}` };
    return;
  }

  if (!response.ok) {
    const text = await safeReadText(response);
    yield {
      type: 'error',
      message: `upstream returned ${response.status} ${response.statusText}${text ? ` — ${text.slice(0, 200)}` : ''}`,
    };
    return;
  }

  if (!response.body) {
    yield { type: 'error', message: 'upstream returned no body' };
    return;
  }

  yield* parseOpenAiSseStream(response.body, { signal: args.signal });
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
```

- [ ] **Step 4: Run to verify pass**

```bash
cd packages/llm-unified && bun test adapters/openai-chat-completions.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/adapters/
git commit -m "Add openai-chat-completions adapter wiring transport + streaming"
```

---

## Task 10: `probe.ts` — Test Connection

**Files:**
- Create: `packages/llm-unified/src/probe.ts`
- Create: `packages/llm-unified/src/probe.test.ts`

Single function `probeProvider(...)` that issues the `ProviderDefinition.probe` request and returns a structured `ProbeResult`. Used by My Settings → "Test Connection".

- [ ] **Step 1: Write the failing test file**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, it, expect } from 'bun:test';
import { probeProvider } from './probe.js';
import type { ProviderConfig, ProviderDefinition } from './types.js';

const novitaDef: ProviderDefinition = {
  id: 'novita',
  displayName: 'Novita AI',
  iconKey: 'novita',
  baseUrl: 'https://api.novita.ai/v3/openai',
  shape: 'openai-chat-completions',
  capabilities: ['llm', 'streaming'],
  configFields: [],
  probe: { path: '/models', method: 'GET' },
  secretFields: new Set(['api_key']),
  corsHint: 'direct',
  knownModels: [],
  sortPriority: 20,
};

const novitaCfg: ProviderConfig = {
  baseUrl: novitaDef.baseUrl,
  routing: { kind: 'direct' },
};

describe('probeProvider', () => {
  it('returns ok=true with modelCount when upstream returns a model list', async () => {
    const fetchFn: typeof fetch = async () =>
      new Response(JSON.stringify({ data: [{ id: 'glm-5.1' }, { id: 'extra' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    const result = await probeProvider({
      definition: novitaDef,
      config: novitaCfg,
      apiKey: 'k',
      corsProxyUrl: null,
      corsProxyKey: null,
      fetchFn,
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.modelCount).toBe(2);
  });

  it('returns ok=true with modelCount=undefined for non-model-list 200s', async () => {
    const fetchFn: typeof fetch = async () =>
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    const result = await probeProvider({
      definition: novitaDef,
      config: novitaCfg,
      apiKey: 'k',
      corsProxyUrl: null,
      corsProxyKey: null,
      fetchFn,
    });
    expect(result.ok).toBe(true);
    expect(result.modelCount).toBeUndefined();
  });

  it('returns ok=false with reason on 401', async () => {
    const fetchFn: typeof fetch = async () =>
      new Response('unauthorized', { status: 401 });
    const result = await probeProvider({
      definition: novitaDef,
      config: novitaCfg,
      apiKey: 'wrong',
      corsProxyUrl: null,
      corsProxyKey: null,
      fetchFn,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.reason).toMatch(/unauthor/i);
  });

  it('returns ok=false on network error', async () => {
    const fetchFn: typeof fetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    const result = await probeProvider({
      definition: novitaDef,
      config: novitaCfg,
      apiKey: 'k',
      corsProxyUrl: null,
      corsProxyKey: null,
      fetchFn,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.reason).toMatch(/Failed to fetch/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd packages/llm-unified && bun test probe.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `probe.ts`**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
import { buildRequest } from './transport.js';
import type { ProbeResult, ProviderConfig, ProviderDefinition } from './types.js';

export interface ProbeArgs {
  definition: ProviderDefinition;
  config: ProviderConfig;
  apiKey: string;
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  fetchFn?: typeof fetch;
}

/**
 * Hit the provider's probe endpoint to verify credentials and connectivity.
 * Returns a structured ProbeResult — no throws on upstream errors; only
 * on programmer errors (invalid routing config). Used by My Settings to
 * surface a green/red badge next to the provider.
 */
export async function probeProvider(args: ProbeArgs): Promise<ProbeResult> {
  const fetchFn = args.fetchFn ?? globalThis.fetch.bind(globalThis);
  const request = buildRequest({
    provider: args.config,
    apiKey: args.apiKey,
    corsProxyUrl: args.corsProxyUrl,
    corsProxyKey: args.corsProxyKey,
    path: args.definition.probe.path,
    method: args.definition.probe.method,
  });

  let response: Response;
  try {
    response = await fetchFn(request);
  } catch (e) {
    return { ok: false, status: 0, reason: (e as Error).message };
  }

  if (!response.ok) {
    const text = await safeReadText(response);
    return {
      ok: false,
      status: response.status,
      reason: text ? text.slice(0, 200) : response.statusText,
    };
  }

  let modelCount: number | undefined;
  try {
    const json = (await response.json()) as { data?: Array<{ id?: string }> };
    if (Array.isArray(json.data)) modelCount = json.data.length;
  } catch {
    // Non-JSON 200 is fine; we still report ok.
  }

  return { ok: true, status: response.status, modelCount };
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
```

- [ ] **Step 4: Run to verify pass**

```bash
cd packages/llm-unified && bun test probe.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/probe.ts packages/llm-unified/src/probe.test.ts
git commit -m "Add llm-unified probeProvider for Test Connection"
```

---

## Task 11: `index.ts` — public exports

**Files:**
- Modify: `packages/llm-unified/src/index.ts`

Public API surface. Module-import side effect: `registerBuiltinProviders()` runs at import time so consumers see the three Block-1 providers without explicit registration.

- [ ] **Step 1: Replace the file**

Replace `packages/llm-unified/src/index.ts` entirely:

```typescript
// SPDX-License-Identifier: LGPL-3.0-only

export type {
  Capability,
  ConfigField,
  KnownModel,
  ProviderDefinition,
  ProviderConfig,
  WireMessage,
  StreamChunk,
  ProbeResult,
} from './types.js';

export {
  registerProvider,
  getProvider,
  listProviders,
  _resetRegistryForTests,
} from './registry.js';

export { composeSystemPrompt, type CompositionLayers } from './composition.js';

export { buildRequest, type BuildRequestArgs } from './transport.js';

export { parseOpenAiSseStream, type ParseOpts } from './streaming.js';

export {
  streamCompletion,
  type StreamCompletionArgs,
} from './adapters/openai-chat-completions.js';

export { probeProvider, type ProbeArgs } from './probe.js';

// Register Block-1 built-in providers on first import.
import { registerBuiltinProviders } from './providers/_register-builtins.js';
registerBuiltinProviders();
```

- [ ] **Step 2: Typecheck + test the whole package**

```bash
cd packages/llm-unified && bun test
pnpm --filter @chatsundere/llm-unified typecheck
```

Both must pass (33 test cases across the suite).

- [ ] **Step 3: Commit**

```bash
git add packages/llm-unified/src/index.ts
git commit -m "Wire llm-unified public exports and built-in registration"
```

---

## Task 12: Onboarding intent-matrix gating

**Files:**
- Modify: `apps/user-client/src/routes/onboarding/matrix.tsx`
- Create: `apps/user-client/src/routes/onboarding/matrix.test.tsx`

Disable three of four cells per spec § 4.5. Only `Just this device` remains interactive in Block 1.

- [ ] **Step 1: Write the failing test file**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OnboardingMatrix } from './matrix.js';

function renderMatrix() {
  return render(
    <MemoryRouter>
      <OnboardingMatrix />
    </MemoryRouter>,
  );
}

describe('OnboardingMatrix — Block 1 gating', () => {
  it('renders "Just this device" as an active link', () => {
    renderMatrix();
    const localCell = screen.getByRole('link', { name: /just this device/i });
    expect(localCell).toHaveAttribute('href', '/onboarding/local');
  });

  it('renders the three server-coupled cells as disabled, not as links', () => {
    renderMatrix();
    for (const label of [
      'I have an invitation',
      'Add this device',
      'Use a recovery key',
    ]) {
      expect(screen.queryByRole('link', { name: new RegExp(label, 'i') })).toBeNull();
      const cell = screen.getByText(label).closest('[aria-disabled="true"]');
      expect(cell).not.toBeNull();
    }
  });

  it('surfaces a "Coming with Block 2" tooltip on each disabled cell', () => {
    renderMatrix();
    for (const label of [
      'I have an invitation',
      'Add this device',
      'Use a recovery key',
    ]) {
      const cell = screen.getByText(label).closest('[aria-disabled="true"]');
      expect(cell?.getAttribute('title')).toMatch(/block 2/i);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter @chatsundere/user-client test matrix.test.tsx
```

Expected: FAIL (current matrix renders all cells as `<Link>`).

- [ ] **Step 3: Modify `matrix.tsx`**

Replace the file with:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useOnboardingStore } from '../../state/onboarding.store.js';

interface Cell {
  to: string;
  label: string;
  hint: string;
  disabled: boolean;
  disabledTooltip?: string;
}

const CELLS: readonly Cell[] = [
  {
    to: '/onboarding/invitation',
    label: 'I have an invitation',
    hint: 'From your operator',
    disabled: true,
    disabledTooltip: 'Coming with Block 2 server connection',
  },
  {
    to: '/onboarding/pairing',
    label: 'Add this device',
    hint: "I'm already a user",
    disabled: true,
    disabledTooltip: 'Coming with Block 2 server connection',
  },
  {
    to: '/onboarding/recovery',
    label: 'Use a recovery key',
    hint: 'I lost my devices',
    disabled: true,
    disabledTooltip: 'Coming with Block 2 server connection',
  },
  {
    to: '/onboarding/local',
    label: 'Just this device',
    hint: 'No server, no sync',
    disabled: false,
  },
] as const;

/**
 * 2×2 fullscreen intent matrix. Entry surface when no local session exists.
 * Per spec § 2 Decision 2: sorted by intent. Three cells are disabled in
 * Block 1 per spec § 4.5; only "Just this device" is interactive. Disabled
 * cells use `aria-disabled` + tooltip per UX-CONCEPT "Disabled over
 * Hidden" — they remain visible but cannot be activated.
 */
export function OnboardingMatrix() {
  // Clear any stale store state from a previous interrupted attempt.
  useEffect(() => useOnboardingStore.getState().reset(), []);

  return (
    <main className="grid min-h-dvh grid-cols-2 gap-px bg-aurora-700/20">
      {CELLS.map((cell) => (cell.disabled ? <DisabledCell key={cell.to} cell={cell} /> : <ActiveCell key={cell.to} cell={cell} />))}
    </main>
  );
}

function ActiveCell({ cell }: { cell: Cell }) {
  return (
    <Link
      to={cell.to}
      className="flex flex-col items-center justify-center bg-ink-soft px-4 py-6 text-center"
    >
      <div className="mb-2 h-10 w-10 rounded bg-aurora-700/20" aria-hidden />
      <h2 className="font-display text-lg italic">{cell.label}</h2>
      <p className="mt-1 text-xs text-paper-soft">{cell.hint}</p>
    </Link>
  );
}

function DisabledCell({ cell }: { cell: Cell }) {
  return (
    <div
      aria-disabled="true"
      title={cell.disabledTooltip}
      className="flex flex-col items-center justify-center bg-ink-soft px-4 py-6 text-center opacity-40"
    >
      <div className="mb-2 h-10 w-10 rounded bg-aurora-700/20" aria-hidden />
      <h2 className="font-display text-lg italic">{cell.label}</h2>
      <p className="mt-1 text-xs text-paper-soft">{cell.hint}</p>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass**

```bash
pnpm --filter @chatsundere/user-client test matrix.test.tsx
```

Expected: PASS (3 tests).

- [ ] **Step 5: Run the full user-client suite to catch regressions**

```bash
pnpm --filter @chatsundere/user-client test
```

Expected: all green (no regressions in pre-existing tests).

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/routes/onboarding/matrix.tsx apps/user-client/src/routes/onboarding/matrix.test.tsx
git commit -m "Gate onboarding intent matrix to local-only for Block 1"
```

---

## Task 13: Integration check + typecheck

**Files:** None (verification only).

- [ ] **Step 1: Run typecheck across all affected packages**

```bash
pnpm --filter @chatsundere/user-client typecheck
pnpm --filter @chatsundere/llm-unified typecheck
pnpm --filter @chatsundere/crypto typecheck
```

All must pass.

- [ ] **Step 2: Run all tests across affected packages**

```bash
pnpm --filter @chatsundere/llm-unified test
pnpm --filter @chatsundere/user-client test
```

All must pass.

- [ ] **Step 3: Run the user-client build**

```bash
pnpm --filter @chatsundere/user-client build
```

Expected: clean build, no TypeScript errors, no Vite warnings of substance.

- [ ] **Step 4: Verify in dev server (manual smoke)**

```bash
pnpm --filter @chatsundere/user-client dev
```

Open the dev URL. From a fresh PWA install (or with site-data cleared in DevTools):

- The 2×2 intent matrix renders with three greyed-out cells and one active cell.
- Hovering a disabled cell shows the "Coming with Block 2" tooltip.
- Tapping "Just this device" routes to `/onboarding/local`.

In DevTools → Application → IndexedDB, both `chatsundere` (crypto-owned) and `chatsundere_client_data` (Dexie) appear after the first navigation that boots the DB. The `client_data` DB contains the `settings` row + three `mindspaces` rows.

- [ ] **Step 5: No commit at this step**

This is a verification-only task. The final Phase-1 squash happens manually after Chris reviews.

---

## Self-review

Run this checklist yourself after the plan is written. Fix issues inline.

**Spec coverage check (mapping spec § → tasks that implement it):**

- Spec § 4.1 (Dexie schema, tables, indices, migrations, seeding) → Task 2.
- Spec § 4.2 (llm-unified registry, built-in providers, adapter, transport, streaming, probe) → Tasks 3, 5, 6, 7, 8, 9, 10, 11.
- Spec § 4.3 (crypto integration, sealSecret/openSecret) → Task 1.
- Spec § 4.4 (System-prompt composition, pure module + tests) → Task 4.
- Spec § 4.5 (Onboarding gating) → Task 12.
- Spec § 2 Decision 8 (separate Dexie DB) → Task 2.
- Spec § 2 Decision 11 (composition as pure module with stub slots) → Task 4.
- Spec § 2 Decision 16 (auto-close triggers) → out of Phase 1 (Phase 3 Chat surface).
- Spec § 2 Decision 7 (secrets-only encryption) → Task 1 (helpers); applied at Phase-2 use-time.

**No tasks for Phase 2–4 deliverables.** Settings UI, Circle UI, Chat surfaces, History — all gated on Lyra's wireframes per spec § 12. Plan deliberately stops at Task 13.

**Placeholder scan:** No TBD, no "implement appropriately", no "similar to above". Every step has either a complete code block or a precise command + expected outcome.

**Type consistency:** `EncryptedBlob` (defined in Task 1) is used by `SettingsRow.corsProxy.sharedKey` and `ProviderRow.apiKey` (Task 2). `ProviderConfig` (Task 3) is used by `buildRequest` (Task 7), `streamCompletion` (Task 9), `probeProvider` (Task 10). `StreamChunk` (Task 3) is yielded by `parseOpenAiSseStream` (Task 8) and `streamCompletion` (Task 9). All references match.

**Implementation order:** Task 0 (deps) → Task 1 (secrets, used by Task 2's `EncryptedBlob` field) → Task 2 (Dexie schema) → Tasks 3 (types) → 4 (composition) → 5 (registry) → 6 (providers, depends on registry) → 7 (transport, depends on types) → 8 (streaming, depends on types) → 9 (adapter, depends on transport + streaming) → 10 (probe, depends on transport) → 11 (index, depends on everything) → 12 (onboarding) → 13 (verification). No forward references.
