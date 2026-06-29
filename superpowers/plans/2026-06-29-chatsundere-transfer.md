# Chatsundere Native Transfer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A high-fidelity, create-new-only export/import of a Chatsundere persona (with its chats + memory) and a knowledge library, in Chatsundere's own `.tar.gz` format, separate from the Chatsune bridge.

**Architecture:** A new browser-native **tar writer** (counterpart to the existing `untar`) + a `chatsundere-transfer` lib (manifest/detection, pure id-remap, pure vector-strategy, persona-pack & knowledge-pack codecs) + two data-layer modules (export gathers Dexie rows → archive Blob; import parses → remaps all ids → writes fresh rows). UI is a transient export overlay reached from `⋯`, plus auto-detect folded into the existing import entry points. No Dexie/schema change.

**Tech Stack:** TypeScript (strict), Bun/Vitest (`apps/user-client` uses Vitest), Dexie, React 18, `@chatsundere/embeddings` (codec + vector store), browser `CompressionStream`/`DecompressionStream`.

## Global Constraints

- **British English** in every artefact — code, comments, copy, test names, commit messages (CLAUDE.md §3.7). Spelling: `colour`, `behaviour`, `initialise`, `serialise`.
- **TypeScript** `strict: true`, `noUncheckedIndexedAccess: true`. No `any` without an inline justification comment. No non-null `!` (Biome bans it — the pre-commit gate runs Biome).
- **No Dexie/schema change.** Only existing tables are written. Do **not** bump `client-data-db.ts` version.
- **Secrets never serialised.** No `ProviderRow`, no `apiKey`, no `EncryptedBlob` bytes may appear in any produced archive. This is an invariant with a dedicated test (Task 8).
- **Create-new only.** Every import mints fresh UUIDv7 ids and remaps all internal references. Never merge, never overwrite.
- **Gate before commit:** run `pnpm typecheck --force` (covers tests) and `pnpm biome check` yourself; the pre-commit hook runs Biome only. Co-author tag: `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`.
- **Spec:** `superpowers/specs/2026-06-29-chatsundere-transfer-design.md` — read it before starting. Section references below (e.g. §4.3) point into it.
- **Test conventions (IMPORTANT — the task bodies show nominal `src/…test.ts` paths; these are the real rules):** all tests live under `apps/user-client/tests/<mirror-of-src>/` (e.g. `src/lib/archive/tar-write.ts` → `tests/lib/archive/tar-write.test.ts`), **never** adjacent to source. Test imports are relative into `src` with depth-adjusted `../../src/…` (e.g. from `tests/lib/archive/`: `../../../src/lib/archive/tar-write.js`). Run with `pnpm vitest run tests/<path>` from `apps/user-client`. Any test touching Dexie must `import 'fake-indexeddb/auto'` at the top and use `openClientDataDb()` / `getClientDataDb()` / `_resetClientDataDbForTests` from `boot/client-data-db.js` — mirror `tests/data/bookmarks.test.ts` and `tests/data/chatsune-import.test.ts` (the `db.delete(); db.open()` shown in Task 8/9 bodies is nominal; follow the real `openClientDataDb()` reset idiom).
- UUIDs via `import { uuidv7 } from 'uuidv7'`. Dexie handle via `getClientDataDb()` from `boot/client-data-db.js`. Knowledge vector store via `getKnowledgeVectorStore()` / `KNOWLEDGE_COLLECTION` from `boot/knowledge-vectors-db.js`.
- Codec/engine constants from `@chatsundere/embeddings`: `MODEL_ID` (`'Snowflake/snowflake-arctic-embed-m-v2.0'`), `EMBED_DIM` (768), `CODEC_VERSION` (1), `serialise`, `deserialise`, `encode`, `decode`, `I4L_VECTOR_BYTES`, type `EncodedVector`.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/user-client/src/lib/archive/tar-write.ts` | ustar tar writer + gzip helper (counterpart to `chatsune-import/archive-reader.ts`) |
| `apps/user-client/src/lib/chatsundere-transfer/manifest.ts` | manifest types, format/version constants, `detectArchiveFormat` |
| `apps/user-client/src/lib/chatsundere-transfer/vector-strategy.ts` | pure `resolveVectorStrategy` |
| `apps/user-client/src/lib/chatsundere-transfer/id-remap.ts` | pure old→new id map + reference rewriters |
| `apps/user-client/src/lib/chatsundere-transfer/persona-pack.ts` | typed persona payload ↔ archive (write + read) |
| `apps/user-client/src/lib/chatsundere-transfer/knowledge-pack.ts` | typed library payload ↔ archive incl. vectors (write + read) |
| `apps/user-client/src/data/chatsundere-export.ts` | gather Dexie rows honouring the 3 switches → payload → Blob |
| `apps/user-client/src/data/chatsundere-import.ts` | parse → remap → write fresh rows; vector adopt/re-embed; degradation |
| `apps/user-client/src/components/transfer/ExportOverlay.tsx` | transient export overlay (persona variant with 3 toggles) |
| Modify: `components/persona-editor/ChatsuneImportControl.tsx` (+ `persona-editor.tsx`) | auto-detect Chatsundere; land import in editor; post-import note |
| Modify: `routes/app/knowledge.tsx` (+ library-detail route) | auto-detect Chatsundere library import; library `⋯` Export |

Build order is topological over the import graph: pure/foundation modules first (Tasks 1–4), codecs (5–7), data layer (8–9), UI wiring (10–12).

---

### Task 1: tar writer + gzip helper

**Files:**
- Create: `apps/user-client/src/lib/archive/tar-write.ts`
- Test: `apps/user-client/src/lib/archive/tar-write.test.ts`

**Interfaces:**
- Consumes: the existing `untar(buf): TarEntry[]` and `gunzip(buf)` from `lib/chatsune-import/archive-reader.js` (for the round-trip test only).
- Produces:
  - `interface TarFile { name: string; bytes: Uint8Array }`
  - `tar(files: TarFile[]): Uint8Array` — ustar archive bytes.
  - `gzip(buf: Uint8Array): Promise<Uint8Array>` — counterpart to `gunzip`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { gunzip, untar } from '../chatsune-import/archive-reader.js';
import { gzip, tar } from './tar-write.js';

describe('tar writer', () => {
  it('round-trips files through tar → untar', () => {
    const enc = new TextEncoder();
    const files = [
      { name: 'manifest.json', bytes: enc.encode('{"format":"chatsundere/persona"}') },
      { name: 'blobs/a.bin', bytes: new Uint8Array([1, 2, 3, 0, 255, 7]) },
    ];
    const entries = untar(tar(files));
    expect(entries.map((e) => e.name)).toEqual(['manifest.json', 'blobs/a.bin']);
    expect(entries[1]?.bytes).toEqual(files[1]?.bytes);
  });

  it('round-trips bytes through gzip → gunzip', async () => {
    const data = new Uint8Array([0, 1, 2, 250, 99, 0, 0, 17]);
    expect(await gunzip(await gzip(data))).toEqual(data);
  });

  it('pads each entry to a 512-byte boundary and appends the zero trailer', () => {
    const out = tar([{ name: 'x', bytes: new Uint8Array([9]) }]);
    // 512 header + 512 padded body + 1024 trailer = 2048
    expect(out.length).toBe(2048);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/lib/archive/tar-write.test.ts`
Expected: FAIL — `tar`/`gzip` not exported.

- [ ] **Step 3: Write the implementation**

Mirror `archive-reader.ts`'s header layout (name at 0–100, size octal at 124–136, typeflag at 156, ustar magic, checksum at 148–156). Write ASCII octal fields, compute the header checksum, pad bodies to 512, end with two zero blocks.

```ts
// SPDX-License-Identifier: AGPL-3.0-only

/** One regular file to place in the archive. */
export interface TarFile {
  name: string;
  bytes: Uint8Array;
}

function octal(value: number, length: number): string {
  // length-1 octal digits, space-padded NUL-terminated field (ustar convention)
  return value.toString(8).padStart(length - 1, '0') + '\0';
}

function writeString(block: Uint8Array, offset: number, text: string): void {
  const bytes = new TextEncoder().encode(text);
  block.set(bytes, offset);
}

/** Build a ustar tarball from regular-file entries (no directories). */
export function tar(files: TarFile[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const file of files) {
    const header = new Uint8Array(512);
    writeString(header, 0, file.name); // name (max 100 bytes; our names are short)
    writeString(header, 100, '0000644\0'); // mode
    writeString(header, 108, '0000000\0'); // uid
    writeString(header, 116, '0000000\0'); // gid
    writeString(header, 124, octal(file.bytes.length, 12)); // size
    writeString(header, 136, octal(0, 12)); // mtime (0 — deterministic, no Date)
    header[156] = 0x30; // typeflag '0' = regular file
    writeString(header, 257, 'ustar\0'); // magic
    writeString(header, 263, '00'); // version
    // Checksum: sum of all header bytes with the checksum field taken as spaces.
    for (let i = 148; i < 156; i++) header[i] = 0x20;
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += header[i] ?? 0;
    writeString(header, 148, octal(sum, 7)); // 6 octal digits + NUL
    header[155] = 0x20; // trailing space
    blocks.push(header);

    const padded = new Uint8Array(Math.ceil(file.bytes.length / 512) * 512);
    padded.set(file.bytes);
    blocks.push(padded);
  }
  blocks.push(new Uint8Array(1024)); // two zero blocks = end-of-archive trailer

  const total = blocks.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of blocks) {
    out.set(b, off);
    off += b.length;
  }
  return out;
}

/** Compress a buffer using the platform CompressionStream (counterpart to gunzip). */
export async function gzip(buf: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  const plain: Uint8Array<ArrayBuffer> = new Uint8Array(buf);
  writer.write(plain).catch(() => {});
  writer.close().catch(() => {});
  const ab = await new Response(cs.readable).arrayBuffer();
  return new Uint8Array(ab);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run src/lib/archive/tar-write.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/archive/
git commit -m "Add browser tar writer + gzip helper for native export

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 2: transfer manifest + format detection

**Files:**
- Create: `apps/user-client/src/lib/chatsundere-transfer/manifest.ts`
- Test: `apps/user-client/src/lib/chatsundere-transfer/manifest.test.ts`

**Interfaces:**
- Produces:
  - `const TRANSFER_VERSION = 1`
  - `type TransferFormat = 'chatsundere/persona' | 'chatsundere/knowledge'`
  - `interface PersonaManifest { format: 'chatsundere/persona'; version: number; exportedAt: string; appVersion: string; included: { memory: boolean; artefacts: boolean; images: boolean }; source: { personaName: string } }`
  - `interface KnowledgeManifest { format: 'chatsundere/knowledge'; version: number; exportedAt: string; appVersion: string; embed: { modelId: string; dim: number; codecVersion: number }; source: { libraryName: string } }`
  - `type DetectedFormat = 'chatsune/persona' | 'chatsune/knowledge' | 'chatsundere/persona' | 'chatsundere/knowledge' | 'unknown'`
  - `detectArchiveFormat(manifestJson: unknown): DetectedFormat` — reads a parsed `manifest.json`'s `format` field, returns the recognised family or `'unknown'`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { detectArchiveFormat } from './manifest.js';

describe('detectArchiveFormat', () => {
  it('recognises both Chatsundere formats', () => {
    expect(detectArchiveFormat({ format: 'chatsundere/persona' })).toBe('chatsundere/persona');
    expect(detectArchiveFormat({ format: 'chatsundere/knowledge' })).toBe('chatsundere/knowledge');
  });
  it('recognises the Chatsune bridge formats', () => {
    expect(detectArchiveFormat({ format: 'chatsune/persona' })).toBe('chatsune/persona');
    expect(detectArchiveFormat({ format: 'chatsune/knowledge' })).toBe('chatsune/knowledge');
  });
  it('returns unknown for anything else', () => {
    expect(detectArchiveFormat({ format: 'whatever' })).toBe('unknown');
    expect(detectArchiveFormat({})).toBe('unknown');
    expect(detectArchiveFormat(null)).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/lib/chatsundere-transfer/manifest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// SPDX-License-Identifier: AGPL-3.0-only

export const TRANSFER_VERSION = 1;

export type TransferFormat = 'chatsundere/persona' | 'chatsundere/knowledge';

export interface PersonaManifest {
  format: 'chatsundere/persona';
  version: number;
  exportedAt: string;
  appVersion: string;
  included: { memory: boolean; artefacts: boolean; images: boolean };
  source: { personaName: string };
}

export interface KnowledgeManifest {
  format: 'chatsundere/knowledge';
  version: number;
  exportedAt: string;
  appVersion: string;
  embed: { modelId: string; dim: number; codecVersion: number };
  source: { libraryName: string };
}

export type DetectedFormat =
  | 'chatsune/persona'
  | 'chatsune/knowledge'
  | 'chatsundere/persona'
  | 'chatsundere/knowledge'
  | 'unknown';

const KNOWN: ReadonlySet<string> = new Set([
  'chatsune/persona',
  'chatsune/knowledge',
  'chatsundere/persona',
  'chatsundere/knowledge',
]);

/** Branch import on a parsed manifest's `format` field. */
export function detectArchiveFormat(manifestJson: unknown): DetectedFormat {
  const format =
    typeof manifestJson === 'object' && manifestJson !== null
      ? (manifestJson as { format?: unknown }).format
      : undefined;
  return typeof format === 'string' && KNOWN.has(format) ? (format as DetectedFormat) : 'unknown';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run src/lib/chatsundere-transfer/manifest.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/chatsundere-transfer/manifest.ts apps/user-client/src/lib/chatsundere-transfer/manifest.test.ts
git commit -m "Add Chatsundere transfer manifest types and format detection

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 3: pure vector strategy

**Files:**
- Create: `apps/user-client/src/lib/chatsundere-transfer/vector-strategy.ts`
- Test: `apps/user-client/src/lib/chatsundere-transfer/vector-strategy.test.ts`

**Interfaces:**
- Produces:
  - `interface EmbedFingerprint { modelId: string; dim: number; codecVersion: number }`
  - `resolveVectorStrategy(manifest: EmbedFingerprint, engine: EmbedFingerprint): 'adopt' | 'reembed'`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { resolveVectorStrategy } from './vector-strategy.js';

const ENGINE = { modelId: 'Snowflake/snowflake-arctic-embed-m-v2.0', dim: 768, codecVersion: 1 };

describe('resolveVectorStrategy', () => {
  it('adopts when model, dim, and codec all match', () => {
    expect(resolveVectorStrategy({ ...ENGINE }, ENGINE)).toBe('adopt');
  });
  it('re-embeds on a model mismatch', () => {
    expect(resolveVectorStrategy({ ...ENGINE, modelId: 'other' }, ENGINE)).toBe('reembed');
  });
  it('re-embeds on a dimension mismatch', () => {
    expect(resolveVectorStrategy({ ...ENGINE, dim: 384 }, ENGINE)).toBe('reembed');
  });
  it('re-embeds on a codec-version mismatch', () => {
    expect(resolveVectorStrategy({ ...ENGINE, codecVersion: 2 }, ENGINE)).toBe('reembed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/lib/chatsundere-transfer/vector-strategy.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// SPDX-License-Identifier: AGPL-3.0-only

export interface EmbedFingerprint {
  modelId: string;
  dim: number;
  codecVersion: number;
}

/**
 * Decide whether imported vectors can be adopted as-is or must be re-embedded.
 * Pure: the only side effect (re-embedding) lives at the call site, in the
 * existing device-tested ingestion path.
 */
export function resolveVectorStrategy(
  manifest: EmbedFingerprint,
  engine: EmbedFingerprint,
): 'adopt' | 'reembed' {
  const compatible =
    manifest.modelId === engine.modelId &&
    manifest.dim === engine.dim &&
    manifest.codecVersion === engine.codecVersion;
  return compatible ? 'adopt' : 'reembed';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run src/lib/chatsundere-transfer/vector-strategy.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/chatsundere-transfer/vector-strategy.ts apps/user-client/src/lib/chatsundere-transfer/vector-strategy.test.ts
git commit -m "Add pure vector adopt/re-embed strategy resolver

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 4: pure id-remap

**Files:**
- Create: `apps/user-client/src/lib/chatsundere-transfer/id-remap.ts`
- Test: `apps/user-client/src/lib/chatsundere-transfer/id-remap.test.ts`

**Interfaces:**
- Consumes: `uuidv7` from `uuidv7`.
- Produces:
  - `class IdRemap { fresh(oldId: string): string; map(oldId: string | null | undefined): string | undefined; has(oldId: string): boolean }`
  - `fresh(oldId)` mints a new UUIDv7 the first time it sees `oldId`, caches it, and returns the same new id on later calls with the same `oldId` (idempotent).
  - `map(oldId)` returns the already-minted new id, or `undefined` if `oldId` was never `fresh`-minted (used to rewrite optional references like `prevCheckpointId`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { IdRemap } from './id-remap.js';

describe('IdRemap', () => {
  it('mints a stable new id per old id', () => {
    const r = new IdRemap();
    const a = r.fresh('old-1');
    expect(r.fresh('old-1')).toBe(a); // idempotent
    expect(r.fresh('old-2')).not.toBe(a);
    expect(a).not.toBe('old-1'); // genuinely fresh
  });
  it('maps known references and returns undefined for unknown/empty', () => {
    const r = new IdRemap();
    const a = r.fresh('old-1');
    expect(r.map('old-1')).toBe(a);
    expect(r.map('never-seen')).toBeUndefined();
    expect(r.map(null)).toBeUndefined();
    expect(r.map(undefined)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/lib/chatsundere-transfer/id-remap.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { uuidv7 } from 'uuidv7';

/**
 * A single old→new id map shared across one import. Every entity is `fresh`-
 * minted exactly once; every foreign reference is rewritten via `map`. Because
 * all ids are regenerated, no DB-level collision is possible.
 */
export class IdRemap {
  private readonly table = new Map<string, string>();

  /** Mint (once) and return the new id for `oldId`. Idempotent. */
  fresh(oldId: string): string {
    const existing = this.table.get(oldId);
    if (existing) return existing;
    const next = uuidv7();
    this.table.set(oldId, next);
    return next;
  }

  /** The new id for an already-minted `oldId`, or undefined. */
  map(oldId: string | null | undefined): string | undefined {
    if (!oldId) return undefined;
    return this.table.get(oldId);
  }

  has(oldId: string): boolean {
    return this.table.has(oldId);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run src/lib/chatsundere-transfer/id-remap.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/chatsundere-transfer/id-remap.ts apps/user-client/src/lib/chatsundere-transfer/id-remap.test.ts
git commit -m "Add pure id-remap for create-new import

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 5: persona-pack — typed payload + writer

**Files:**
- Create: `apps/user-client/src/lib/chatsundere-transfer/persona-pack.ts`
- Test: `apps/user-client/src/lib/chatsundere-transfer/persona-pack.test.ts`

**Interfaces:**
- Consumes: `tar`, `gzip` (Task 1); `PersonaManifest`, `TRANSFER_VERSION` (Task 2); Row types from `boot/client-data-db.js` (`PersonaRow`, `ChatRow`, `MessageRow`, `PillRow`, `AttachmentRow`, `ArtefactRow`, `CompactionCheckpointRow`, `MemoryJournalRow`, `MemoryBodyRow`).
- Produces:
  - `interface PersonaPackPayload { persona: ExportedPersona; avatar: { bytes: Uint8Array; mime: string } | null; chats: ChatRow[]; messages: MessageRow[]; pills: PillRow[]; attachments: AttachmentRow[]; artefacts: ArtefactRow[]; checkpoints: CompactionCheckpointRow[]; memory: { journal: MemoryJournalRow[]; bodies: MemoryBodyRow[] } | null; blobs: Map<string, { bytes: Uint8Array; mime: string }>; included: { memory: boolean; artefacts: boolean; images: boolean } }`
  - `type ExportedPersona = Omit<PersonaRow, 'id' | 'providerId' | 'mcpOverrides' | 'libraryIds' | 'lastInteractionAt'> & { modelRef: { providerTemplateId: string; modelId: string } | null }` — original ids kept on chats/messages for internal reference (stripped/degraded only on the persona per §4.3).
  - `async function writePersonaPack(payload: PersonaPackPayload): Promise<Blob>` — JSON files + avatar + image blobs → `tar` → `gzip` → `Blob`.

Note: the payload carries the *original* ids on chats/messages/pills/etc. so the archive is internally consistent; the export data layer (Task 8) builds this payload, the import (Task 9) remaps. `ExportedPersona` is where the persona-level degradation (§4.3) is encoded.

- [ ] **Step 1: Write the failing test** (writer-only round-trip via the existing reader primitives)

```ts
import { describe, expect, it } from 'vitest';
import { gunzip, untar } from '../chatsune-import/archive-reader.js';
import { type PersonaPackPayload, writePersonaPack } from './persona-pack.js';

function minimalPayload(): PersonaPackPayload {
  return {
    persona: {
      name: 'Fable',
      tagline: 't',
      instructions: 'i',
      canonicalId: null,
      colour: '#fff',
      font: 'serif',
      temperature: 0.7,
      adultPersona: false,
      chatsundereTonality: 'warm',
      roleplay: false,
      narration: false,
      greetingEnabled: false,
      greetingInstructions: '',
      voice: null,
      narratorVoice: null,
      askExpertDefault: false,
      useMemory: true,
      memoryInstructions: '',
      modelRef: { providerTemplateId: 'tmpl', modelId: 'claude-opus-4-8' },
    } as PersonaPackPayload['persona'],
    avatar: null,
    chats: [],
    messages: [],
    pills: [],
    attachments: [],
    artefacts: [],
    checkpoints: [],
    memory: null,
    blobs: new Map(),
    included: { memory: false, artefacts: true, images: false },
  };
}

describe('writePersonaPack', () => {
  it('produces a gzipped tar whose manifest declares the persona format', async () => {
    const blob = await writePersonaPack(minimalPayload());
    const files = untar(await gunzip(new Uint8Array(await blob.arrayBuffer())));
    const names = files.map((f) => f.name);
    expect(names).toContain('manifest.json');
    expect(names).toContain('persona.json');
    const manifest = JSON.parse(
      new TextDecoder().decode(files.find((f) => f.name === 'manifest.json')?.bytes),
    );
    expect(manifest.format).toBe('chatsundere/persona');
    expect(manifest.included).toEqual({ memory: false, artefacts: true, images: false });
  });

  it('never writes a provider key field into persona.json', async () => {
    const blob = await writePersonaPack(minimalPayload());
    const text = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
    // The compressed bytes won't contain plain "apiKey", but persona.json is small;
    // assert the structured payload has only modelRef, never providerId/apiKey.
    const files = untar(await gunzip(new Uint8Array(await blob.arrayBuffer())));
    const persona = JSON.parse(
      new TextDecoder().decode(files.find((f) => f.name === 'persona.json')?.bytes),
    );
    expect(persona.providerId).toBeUndefined();
    expect(persona.apiKey).toBeUndefined();
    expect(persona.modelRef).toEqual({ providerTemplateId: 'tmpl', modelId: 'claude-opus-4-8' });
    expect(text.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/lib/chatsundere-transfer/persona-pack.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the writer** (`writePersonaPack` + payload types)

Build the file list: `manifest.json`, `persona.json`, optionally `avatar.<ext>`, `chats.json`, `messages.json`, `pills.json`, `attachments.json`, `artefacts.json`, `compactions.json`, optionally `memory.json`, and `blobs/<id>.<ext>` for each entry of `payload.blobs` (only present when images on / the exporter populated them). Use `exportedAt: ''` and `appVersion` from a passed/imported constant — **do not** call `new Date()` (banned in some contexts; keep deterministic by accepting `exportedAt`/`appVersion` as fields already on the payload's manifest-bound values; here, set `exportedAt` from a module that reads it at the data layer). For this codec task, accept them as optional params with safe defaults:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type {
  ArtefactRow, AttachmentRow, ChatRow, CompactionCheckpointRow,
  MemoryBodyRow, MemoryJournalRow, MessageRow, PersonaRow, PillRow,
} from '../../boot/client-data-db.js';
import { type PersonaManifest, TRANSFER_VERSION } from './manifest.js';
import { type TarFile, gzip, tar } from '../archive/tar-write.js';

export type ExportedPersona = Omit<
  PersonaRow,
  'id' | 'providerId' | 'mcpOverrides' | 'libraryIds' | 'lastInteractionAt'
> & { modelRef: { providerTemplateId: string; modelId: string } | null };

export interface PersonaPackPayload {
  persona: ExportedPersona;
  avatar: { bytes: Uint8Array; mime: string } | null;
  chats: ChatRow[];
  messages: MessageRow[];
  pills: PillRow[];
  attachments: AttachmentRow[];
  artefacts: ArtefactRow[];
  checkpoints: CompactionCheckpointRow[];
  memory: { journal: MemoryJournalRow[]; bodies: MemoryBodyRow[] } | null;
  blobs: Map<string, { bytes: Uint8Array; mime: string }>;
  included: { memory: boolean; artefacts: boolean; images: boolean };
}

const enc = new TextEncoder();
function json(value: unknown): Uint8Array {
  return enc.encode(JSON.stringify(value));
}
function extFor(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  return 'jpg';
}

export interface WritePersonaPackOptions {
  exportedAt?: string;
  appVersion?: string;
}

export async function writePersonaPack(
  payload: PersonaPackPayload,
  opts: WritePersonaPackOptions = {},
): Promise<Blob> {
  const manifest: PersonaManifest = {
    format: 'chatsundere/persona',
    version: TRANSFER_VERSION,
    exportedAt: opts.exportedAt ?? '',
    appVersion: opts.appVersion ?? '',
    included: payload.included,
    source: { personaName: payload.persona.name },
  };

  const files: TarFile[] = [
    { name: 'manifest.json', bytes: json(manifest) },
    { name: 'persona.json', bytes: json(payload.persona) },
    { name: 'chats.json', bytes: json(payload.chats) },
    { name: 'messages.json', bytes: json(payload.messages) },
    { name: 'pills.json', bytes: json(payload.pills) },
    { name: 'attachments.json', bytes: json(payload.attachments) },
    { name: 'artefacts.json', bytes: json(payload.artefacts) },
    { name: 'compactions.json', bytes: json(payload.checkpoints) },
  ];
  if (payload.avatar) {
    files.push({ name: `avatar.${extFor(payload.avatar.mime)}`, bytes: payload.avatar.bytes });
  }
  if (payload.memory) files.push({ name: 'memory.json', bytes: json(payload.memory) });
  for (const [id, blob] of payload.blobs) {
    files.push({ name: `blobs/${id}.${extFor(blob.mime)}`, bytes: blob.bytes });
  }

  const gz = await gzip(tar(files));
  return new Blob([gz], { type: 'application/gzip' });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run src/lib/chatsundere-transfer/persona-pack.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/chatsundere-transfer/persona-pack.ts apps/user-client/src/lib/chatsundere-transfer/persona-pack.test.ts
git commit -m "Add persona-pack payload types and archive writer

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 6: persona-pack — reader (+ write↔read round-trip)

**Files:**
- Modify: `apps/user-client/src/lib/chatsundere-transfer/persona-pack.ts`
- Modify: `apps/user-client/src/lib/chatsundere-transfer/persona-pack.test.ts`

**Interfaces:**
- Produces:
  - `interface ParsedPersonaPack { manifest: PersonaManifest; payload: PersonaPackPayload }`
  - `async function readPersonaPack(input: Blob | Uint8Array): Promise<ParsedPersonaPack>` — gunzip + untar (reuse `archive-reader`'s `gunzip`/`untar`), parse the JSON files, rebuild `blobs` and `avatar` from the binary entries. Throws a user-facing error if `manifest.format !== 'chatsundere/persona'`.

- [ ] **Step 1: Add the failing round-trip test**

```ts
import { readPersonaPack } from './persona-pack.js';
// ...append to the existing describe block:

it('round-trips a payload through write → read (modulo binary maps)', async () => {
  const payload = minimalPayload();
  const blob = await writePersonaPack(payload);
  const { manifest, payload: out } = await readPersonaPack(blob);
  expect(manifest.format).toBe('chatsundere/persona');
  expect(out.persona).toEqual(payload.persona);
  expect(out.chats).toEqual(payload.chats);
  expect(out.included).toEqual(payload.included);
  expect(out.memory).toBeNull();
});

it('rejects a non-persona archive', async () => {
  await expect(readPersonaPack(new Uint8Array([0, 1, 2]))).rejects.toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/lib/chatsundere-transfer/persona-pack.test.ts`
Expected: FAIL — `readPersonaPack` not exported.

- [ ] **Step 3: Add the reader to `persona-pack.ts`**

```ts
import { gunzip, untar } from '../chatsune-import/archive-reader.js';

const dec = new TextDecoder();
function parseJson<T>(files: Map<string, Uint8Array>, name: string, fallback: T): T {
  const bytes = files.get(name);
  return bytes ? (JSON.parse(dec.decode(bytes)) as T) : fallback;
}
function mimeFromExt(name: string): string {
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

export interface ParsedPersonaPack {
  manifest: PersonaManifest;
  payload: PersonaPackPayload;
}

export async function readPersonaPack(input: Blob | Uint8Array): Promise<ParsedPersonaPack> {
  const raw = input instanceof Uint8Array ? input : new Uint8Array(await input.arrayBuffer());
  let tarBytes: Uint8Array;
  try {
    tarBytes = await gunzip(raw);
  } catch {
    throw new Error('Could not read this file — is it a Chatsundere export?');
  }
  const files = new Map<string, Uint8Array>();
  for (const e of untar(tarBytes)) files.set(e.name, e.bytes);
  const manifest = parseJson<PersonaManifest | null>(files, 'manifest.json', null);
  if (!manifest || manifest.format !== 'chatsundere/persona') {
    throw new Error('This file is not a Chatsundere persona export.');
  }

  let avatar: PersonaPackPayload['avatar'] = null;
  const blobs = new Map<string, { bytes: Uint8Array; mime: string }>();
  for (const [name, bytes] of files) {
    if (name.startsWith('avatar.')) avatar = { bytes, mime: mimeFromExt(name) };
    else if (name.startsWith('blobs/')) {
      const id = name.slice('blobs/'.length).replace(/\.[^.]+$/, '');
      blobs.set(id, { bytes, mime: mimeFromExt(name) });
    }
  }

  const payload: PersonaPackPayload = {
    persona: parseJson(files, 'persona.json', null as unknown as ExportedPersona),
    avatar,
    chats: parseJson(files, 'chats.json', []),
    messages: parseJson(files, 'messages.json', []),
    pills: parseJson(files, 'pills.json', []),
    attachments: parseJson(files, 'attachments.json', []),
    artefacts: parseJson(files, 'artefacts.json', []),
    checkpoints: parseJson(files, 'compactions.json', []),
    memory: parseJson(files, 'memory.json', null),
    blobs,
    included: manifest.included,
  };
  return { manifest, payload };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run src/lib/chatsundere-transfer/persona-pack.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/chatsundere-transfer/persona-pack.ts apps/user-client/src/lib/chatsundere-transfer/persona-pack.test.ts
git commit -m "Add persona-pack reader with write↔read round-trip

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 7: knowledge-pack — writer + reader incl. vectors

**Files:**
- Create: `apps/user-client/src/lib/chatsundere-transfer/knowledge-pack.ts`
- Test: `apps/user-client/src/lib/chatsundere-transfer/knowledge-pack.test.ts`

**Interfaces:**
- Consumes: `tar`/`gzip` (Task 1), `gunzip`/`untar` (archive-reader), `KnowledgeManifest`/`TRANSFER_VERSION` (Task 2), `serialise`/`deserialise`/`encode`/`type EncodedVector`/`MODEL_ID`/`EMBED_DIM`/`CODEC_VERSION` from `@chatsundere/embeddings`, `LibraryRow`/`DocumentRow` from `boot/client-data-db.js`.
- Produces:
  - `interface ExportedVector { documentId: string; chunkIndex: number; headingPath: string[]; text: string; encoded: EncodedVector }`
  - `interface KnowledgePackPayload { library: Omit<LibraryRow, 'id'>; documents: DocumentRow[]; vectors: ExportedVector[] }`
  - `async function writeKnowledgePack(payload: KnowledgePackPayload, opts?: { exportedAt?: string; appVersion?: string }): Promise<Blob>`
  - `async function readKnowledgePack(input: Blob | Uint8Array): Promise<{ manifest: KnowledgeManifest; payload: KnowledgePackPayload }>`

The archive stores `vectors.bin` (each vector serialised via `serialise(encoded)`, fixed `I4L_VECTOR_BYTES` per record, concatenated) + `vectors.json` (the sidecar: `{ documentId, chunkIndex, headingPath, text, byteOffset, byteLength }[]`).

- [ ] **Step 1: Write the failing round-trip test**

```ts
import { encode } from '@chatsundere/embeddings';
import { describe, expect, it } from 'vitest';
import { type KnowledgePackPayload, readKnowledgePack, writeKnowledgePack } from './knowledge-pack.js';

function vec(seed: number) {
  const v = new Float32Array(768);
  for (let i = 0; i < v.length; i++) v[i] = Math.sin(seed + i);
  return v;
}

function payload(): KnowledgePackPayload {
  return {
    library: { name: 'Lore', description: 'd', nsfw: false, createdAt: 1, updatedAt: 2 },
    documents: [
      { id: 'doc-1', libraryId: 'lib-1', title: 'T', content: 'body', embeddingStatus: 'ready',
        embeddingError: null, chunkCount: 1, triggerPhrases: ['x'], triggerOnCompanion: false,
        createdAt: 1, updatedAt: 2 } as KnowledgePackPayload['documents'][number],
    ],
    vectors: [
      { documentId: 'doc-1', chunkIndex: 0, headingPath: ['T'], text: 'body', encoded: encode(vec(1)) },
    ],
  };
}

describe('knowledge-pack', () => {
  it('round-trips library + documents + vectors', async () => {
    const p = payload();
    const blob = await writeKnowledgePack(p);
    const { manifest, payload: out } = await readKnowledgePack(blob);
    expect(manifest.format).toBe('chatsundere/knowledge');
    expect(manifest.embed).toEqual({
      modelId: 'Snowflake/snowflake-arctic-embed-m-v2.0', dim: 768, codecVersion: 1,
    });
    expect(out.library).toEqual(p.library);
    expect(out.documents).toEqual(p.documents);
    expect(out.vectors[0]?.documentId).toBe('doc-1');
    expect(out.vectors[0]?.text).toBe('body');
    expect(out.vectors[0]?.encoded.codes).toEqual(p.vectors[0]?.encoded.codes);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/lib/chatsundere-transfer/knowledge-pack.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `knowledge-pack.ts`**

Use `serialise`/`deserialise` for each vector; concatenate into `vectors.bin`; record offsets in the sidecar.

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import {
  CODEC_VERSION, EMBED_DIM, type EncodedVector, MODEL_ID, deserialise, serialise,
} from '@chatsundere/embeddings';
import type { DocumentRow, LibraryRow } from '../../boot/client-data-db.js';
import { type KnowledgeManifest, TRANSFER_VERSION } from './manifest.js';
import { gunzip, untar } from '../chatsune-import/archive-reader.js';
import { type TarFile, gzip, tar } from '../archive/tar-write.js';

export interface ExportedVector {
  documentId: string;
  chunkIndex: number;
  headingPath: string[];
  text: string;
  encoded: EncodedVector;
}
export interface KnowledgePackPayload {
  library: Omit<LibraryRow, 'id'>;
  documents: DocumentRow[];
  vectors: ExportedVector[];
}
interface VectorSidecarEntry {
  documentId: string; chunkIndex: number; headingPath: string[]; text: string;
  byteOffset: number; byteLength: number;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const j = (v: unknown) => enc.encode(JSON.stringify(v));
const p = <T>(files: Map<string, Uint8Array>, name: string, fb: T): T => {
  const b = files.get(name);
  return b ? (JSON.parse(dec.decode(b)) as T) : fb;
};

export async function writeKnowledgePack(
  payload: KnowledgePackPayload,
  opts: { exportedAt?: string; appVersion?: string } = {},
): Promise<Blob> {
  const sidecar: VectorSidecarEntry[] = [];
  const chunks: Uint8Array[] = [];
  let offset = 0;
  for (const v of payload.vectors) {
    const bytes = serialise(v.encoded);
    sidecar.push({
      documentId: v.documentId, chunkIndex: v.chunkIndex, headingPath: v.headingPath,
      text: v.text, byteOffset: offset, byteLength: bytes.length,
    });
    chunks.push(bytes);
    offset += bytes.length;
  }
  const bin = new Uint8Array(offset);
  let o = 0;
  for (const c of chunks) { bin.set(c, o); o += c.length; }

  const manifest: KnowledgeManifest = {
    format: 'chatsundere/knowledge', version: TRANSFER_VERSION,
    exportedAt: opts.exportedAt ?? '', appVersion: opts.appVersion ?? '',
    embed: { modelId: MODEL_ID, dim: EMBED_DIM, codecVersion: CODEC_VERSION },
    source: { libraryName: payload.library.name },
  };
  const files: TarFile[] = [
    { name: 'manifest.json', bytes: j(manifest) },
    { name: 'library.json', bytes: j(payload.library) },
    { name: 'documents.json', bytes: j(payload.documents) },
    { name: 'vectors.json', bytes: j(sidecar) },
    { name: 'vectors.bin', bytes: bin },
  ];
  return new Blob([await gzip(tar(files))], { type: 'application/gzip' });
}

export async function readKnowledgePack(
  input: Blob | Uint8Array,
): Promise<{ manifest: KnowledgeManifest; payload: KnowledgePackPayload }> {
  const raw = input instanceof Uint8Array ? input : new Uint8Array(await input.arrayBuffer());
  let tarBytes: Uint8Array;
  try { tarBytes = await gunzip(raw); }
  catch { throw new Error('Could not read this file — is it a Chatsundere export?'); }
  const files = new Map<string, Uint8Array>();
  for (const e of untar(tarBytes)) files.set(e.name, e.bytes);
  const manifest = p<KnowledgeManifest | null>(files, 'manifest.json', null);
  if (!manifest || manifest.format !== 'chatsundere/knowledge') {
    throw new Error('This file is not a Chatsundere library export.');
  }
  const sidecar = p<VectorSidecarEntry[]>(files, 'vectors.json', []);
  const bin = files.get('vectors.bin') ?? new Uint8Array(0);
  const vectors: ExportedVector[] = sidecar.map((s) => ({
    documentId: s.documentId, chunkIndex: s.chunkIndex, headingPath: s.headingPath, text: s.text,
    encoded: deserialise(bin.subarray(s.byteOffset, s.byteOffset + s.byteLength)),
  }));
  return {
    manifest,
    payload: {
      library: p(files, 'library.json', null as unknown as KnowledgePackPayload['library']),
      documents: p(files, 'documents.json', []),
      vectors,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run src/lib/chatsundere-transfer/knowledge-pack.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/chatsundere-transfer/knowledge-pack.ts apps/user-client/src/lib/chatsundere-transfer/knowledge-pack.test.ts
git commit -m "Add knowledge-pack codec with vector serialisation

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 8: export data layer (3 switches, image placeholder, security invariant)

**Files:**
- Create: `apps/user-client/src/data/chatsundere-export.ts`
- Test: `apps/user-client/src/data/chatsundere-export.test.ts`

**Interfaces:**
- Consumes: `writePersonaPack`/`PersonaPackPayload` (Tasks 5/6), `writeKnowledgePack`/`ExportedVector` (Task 7), `getClientDataDb()`, `getKnowledgeVectorStore()`/`KNOWLEDGE_COLLECTION`, the providers data layer (to resolve a persona's `providerId` → `templateId`), `getPersonaAvatar`.
- Produces:
  - `interface PersonaExportOptions { memory: boolean; artefacts: boolean; images: boolean }`
  - `async function exportPersona(personaId: string, opts: PersonaExportOptions): Promise<Blob>`
  - `async function exportLibrary(libraryId: string): Promise<Blob>`
  - `const IMAGE_PLACEHOLDER_TEXT = 'Image not carried over in this transfer.'`

Behaviour:
- `exportPersona` reads the persona, its chats (`db.chats.where('personaId').equals(id)`), their messages/pills/attachments/artefacts/checkpoints. Resolve `modelRef` by looking up the persona's `providerId` in `db.providers` and taking `{ providerTemplateId: provider.templateId, modelId: persona.modelId }` (or `null` if no provider/model). **Strip** `providerId`, `mcpOverrides`, `libraryIds`, `lastInteractionAt` from the exported persona (§4.3). Honour the switches:
  - `memory: false` → `payload.memory = null`.
  - `artefacts: false` → drop text-kind artefacts (`kind === 'text'`).
  - `images: false` → drop image-kind artefacts (`kind === 'image'`) and image attachments (`kind === 'image'`); for each dropped image attachment, replace it in `attachments` with a text attachment carrying `IMAGE_PLACEHOLDER_TEXT` (preserves message readability, §4.2). Image blobs go into `payload.blobs` only when `images: true`.
  - Avatar always included (read via the avatar data layer, downscaled blob → bytes).
- `exportLibrary` reads the library + its documents + scans the vector store (`store.scan({ collection: KNOWLEDGE_COLLECTION, filter: { tags: { libraryId } } })`) and maps each `VectorRow` → `ExportedVector` (`documentId` from `row.tags.documentId`, `chunkIndex` from `row.numeric.chunkIndex`, `text`/`headingPath` from `row.metadata`, `encoded` = the row's EncodedVector fields). Strip the library `id`.

- [ ] **Step 1: Write the failing tests** (seed Dexie via the test DB; assert switch behaviour + the security invariant)

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { gunzip, untar } from '../lib/chatsune-import/archive-reader.js';
import { getClientDataDb } from '../boot/client-data-db.js';
import { exportPersona, IMAGE_PLACEHOLDER_TEXT } from './chatsundere-export.js';

async function readArchiveFile(blob: Blob, name: string): Promise<unknown> {
  const files = untar(await gunzip(new Uint8Array(await blob.arrayBuffer())));
  const f = files.find((e) => e.name === name);
  return f ? JSON.parse(new TextDecoder().decode(f.bytes)) : undefined;
}

describe('exportPersona', () => {
  beforeEach(async () => {
    const db = getClientDataDb();
    await db.delete();
    await db.open();
    // seed: a provider with a key, a persona bound to it, one chat + one image attachment
    await db.providers.add({ id: 'prov-1', templateId: 'anthropic', displayName: 'A',
      baseUrl: '', apiKey: { ciphertext: new Uint8Array([9, 9, 9]), nonce: new Uint8Array([1]), version: 1 },
      routing: 'proxy', enabled: true, createdAt: 1, updatedAt: 1 } as never);
    await db.personas.add({ id: 'p1', name: 'Fable', providerId: 'prov-1', modelId: 'claude-opus-4-8',
      mcpOverrides: { 'srv-1': true }, libraryIds: ['lib-x'] } as never);
    await db.chats.add({ id: 'c1', personaId: 'p1', title: 't', createdAt: 1, lastMessageAt: 2 } as never);
    await db.messages.add({ id: 'm1', chatId: 'c1', role: 'user', contentBlocks: [{ type: 'text', text: 'hi' }], createdAt: 1 } as never);
    await db.attachments.add({ id: 'a1', chatId: 'c1', messageId: 'm1', origin: 'upload',
      kind: 'image', fileName: 'x.png', mime: 'image/png', order: 0, state: 'active',
      blob: new Blob([new Uint8Array([1, 2])]) } as never);
  });

  it('exports modelRef and never the provider key (security invariant)', async () => {
    const blob = await exportPersona('p1', { memory: true, artefacts: true, images: false });
    const persona = (await readArchiveFile(blob, 'persona.json')) as Record<string, unknown>;
    expect(persona.modelRef).toEqual({ providerTemplateId: 'anthropic', modelId: 'claude-opus-4-8' });
    expect(persona.providerId).toBeUndefined();
    expect(persona.mcpOverrides).toBeUndefined();
    expect(persona.libraryIds).toBeUndefined();
    // No archive file may carry the key bytes (9,9,9) — assert no apiKey anywhere.
    expect(JSON.stringify(persona)).not.toContain('apiKey');
  });

  it('replaces a dropped image attachment with a placeholder when images off', async () => {
    const blob = await exportPersona('p1', { memory: true, artefacts: true, images: false });
    const attachments = (await readArchiveFile(blob, 'attachments.json')) as Array<Record<string, unknown>>;
    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.kind).toBe('text');
    expect(attachments[0]?.text).toBe(IMAGE_PLACEHOLDER_TEXT);
    const names = untar(await gunzip(new Uint8Array(await blob.arrayBuffer()))).map((f) => f.name);
    expect(names.some((n) => n.startsWith('blobs/'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/data/chatsundere-export.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `chatsundere-export.ts`**

Read the rows, apply the switches, build the `PersonaPackPayload`/`KnowledgePackPayload`, call the writers. Key points: resolve the provider template via `db.providers.get(persona.providerId)`; never copy `apiKey`. For the image placeholder, synthesise a text attachment with a fresh-ish id reusing the original id (kept for internal consistency) but `kind: 'text'`, `text: IMAGE_PLACEHOLDER_TEXT`, `blob` omitted. Read `appVersion` from the existing version source used elsewhere (search for how the About page reads the app version, e.g. a `__APP_VERSION__` or settings field) and pass it to the writer; pass `exportedAt` from the same source the codebase already uses for timestamps in the data layer (`Date.now()` is permitted in app runtime code — only the workflow-script sandbox forbids it; confirm by checking neighbouring data-layer files). Follow `chatsune-import.ts` for the Dexie access idiom.

(Implementer: write the full module per the Interfaces + Behaviour above; mirror `data/chatsune-import.ts` style. Provide JSDoc on each exported function.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/user-client && pnpm vitest run src/data/chatsundere-export.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/data/chatsundere-export.ts apps/user-client/src/data/chatsundere-export.test.ts
git commit -m "Add persona/library export data layer with switch honouring + key-safety invariant

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 9: import data layer (remap, vector adopt/re-embed, degradation) + round-trip

**Files:**
- Create: `apps/user-client/src/data/chatsundere-import.ts`
- Test: `apps/user-client/src/data/chatsundere-import.test.ts`

**Interfaces:**
- Consumes: `readPersonaPack`/`readKnowledgePack` (Tasks 6/7), `IdRemap` (Task 4), `resolveVectorStrategy` (Task 3), `decode` from `@chatsundere/embeddings`, `getClientDataDb()`, `getKnowledgeVectorStore()`/`KNOWLEDGE_COLLECTION`, `enqueueDocument` from `knowledge/start-ingestion.js`, the providers data layer, the avatar setter.
- Produces:
  - `interface ImportedPersonaResult { personaId: string; modelBound: boolean; droppedBindings: boolean }`
  - `async function importPersonaPack(input: Blob, targetName: string): Promise<ImportedPersonaResult>`
  - `async function importKnowledgePack(input: Blob, targetName: string): Promise<{ libraryId: string }>`

Behaviour:
- `importPersonaPack`: parse → build one `IdRemap` → mint `personaId = remap.fresh(<archive persona had no id; use a sentinel like 'persona'>)`. Resolve `modelRef`: find a local provider with `templateId === modelRef.providerTemplateId` (`db.providers`); if found → set `providerId` + `modelId` (`modelBound = true`); else leave both unset (`modelBound = false`). Write the persona row (degraded fields already absent; `mcpOverrides = {}`, `libraryIds = []`, `lastInteractionAt = undefined`). Write avatar if present. Remap chats (`personaId`), messages (`chatId`), pills (`messageId`), attachments (`chatId`/`messageId`), artefacts (`chatId`/`personaId`/`messageId` if present), checkpoints (`chatId` + message-id refs + `prevCheckpointId` via `remap.map`). `resolvedMindspaceId`: keep if `db.mindspaces.get(id)` resolves, else set to the default mindspace id. Write image blobs from `payload.blobs` back into the matching attachment/artefact rows when present. Write memory journal/body rows if present. Set `droppedBindings = (sourceHadMcpOverrides || sourceHadLibraryIds)` — surfaced by the UI note (Task 12).
- `importKnowledgePack`: parse → fresh `libraryId` → write library (name = `targetName`). For each document: fresh `documentId`, remap `libraryId`. Decide vector strategy via `resolveVectorStrategy(manifest.embed, { modelId: MODEL_ID, dim: EMBED_DIM, codecVersion: CODEC_VERSION })`:
  - `adopt`: for each `ExportedVector`, `decode(v.encoded)` → `Float32Array`, `store.upsert([{ id: `${newDocId}#${v.chunkIndex}`, collection: KNOWLEDGE_COLLECTION, vector, tags: { libraryId: newLibId, documentId: newDocId }, numeric: { chunkIndex: v.chunkIndex }, metadata: { text: v.text, headingPath: v.headingPath }, updatedAt: Date.now() }])`; set `embeddingStatus = 'ready'`. **No engine call.**
  - `reembed`: set `embeddingStatus = 'pending'`, `enqueueDocument(newDocId)`.

- [ ] **Step 1: Write the failing tests** — the headline round-trip + degradation + adopt-without-engine

```ts
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { getClientDataDb } from '../boot/client-data-db.js';
import { exportPersona } from './chatsundere-export.js';
import { importPersonaPack } from './chatsundere-import.js';

describe('persona export → import round-trip', () => {
  beforeEach(async () => {
    const db = getClientDataDb();
    await db.delete(); await db.open();
    await db.personas.add({ id: 'p1', name: 'Fable', providerId: undefined, modelId: undefined,
      mcpOverrides: { 'srv-1': true }, libraryIds: ['lib-x'], useMemory: true } as never);
    await db.chats.add({ id: 'c1', personaId: 'p1', title: 't', createdAt: 1, lastMessageAt: 2 } as never);
    await db.messages.add({ id: 'm1', chatId: 'c1', role: 'persona',
      contentBlocks: [{ type: 'text', text: 'hi' }, { type: 'reasoning', text: 'why' }], createdAt: 1 } as never);
  });

  it('creates a new persona with fresh ids and preserved content', async () => {
    const blob = await exportPersona('p1', { memory: true, artefacts: true, images: false });
    const res = await importPersonaPack(blob, 'Fable (copy)');
    const db = getClientDataDb();
    expect(res.personaId).not.toBe('p1');
    const persona = await db.personas.get(res.personaId);
    expect(persona?.name).toBe('Fable (copy)');
    const chats = await db.chats.where('personaId').equals(res.personaId).toArray();
    expect(chats).toHaveLength(1);
    expect(chats[0]?.id).not.toBe('c1');
    const msgs = await db.messages.where('chatId').equals(chats[0]?.id ?? '').toArray();
    expect(msgs[0]?.contentBlocks).toEqual([
      { type: 'text', text: 'hi' }, { type: 'reasoning', text: 'why' },
    ]);
  });

  it('degrades live bindings and reports it', async () => {
    const blob = await exportPersona('p1', { memory: true, artefacts: true, images: false });
    const res = await importPersonaPack(blob, 'Fable (copy)');
    const persona = await getClientDataDb().personas.get(res.personaId);
    expect(persona?.mcpOverrides).toEqual({});
    expect(persona?.libraryIds).toEqual([]);
    expect(res.modelBound).toBe(false);
    expect(res.droppedBindings).toBe(true);
  });
});
```

Add a knowledge adopt test that mocks the engine to throw if called:

```ts
// chatsundere-import.knowledge.test.ts — assert adopt path never touches the engine
import { describe, expect, it, beforeEach, vi } from 'vitest';
vi.mock('../boot/knowledge-vectors-db.js', async (orig) => {
  const actual = await orig<typeof import('../boot/knowledge-vectors-db.js')>();
  return { ...actual, getEmbeddingEngine: () => { throw new Error('engine must not be called on adopt'); } };
});
// ... build a library export, import it, assert documents are 'ready' and no throw.
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/user-client && pnpm vitest run src/data/chatsundere-import.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `chatsundere-import.ts`** per the Behaviour spec above. Mirror `chatsune-import.ts` for Dexie bulk writes and the `enqueueDocument` call. JSDoc each export.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/user-client && pnpm vitest run src/data/chatsundere-import.test.ts src/data/chatsundere-import.knowledge.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full transfer suite + typecheck**

Run: `cd apps/user-client && pnpm vitest run src/lib/chatsundere-transfer src/lib/archive src/data/chatsundere-export.test.ts src/data/chatsundere-import.test.ts && cd ../.. && pnpm typecheck --force`
Expected: all green; typecheck 14/14.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/data/chatsundere-import.ts apps/user-client/src/data/chatsundere-import*.test.ts
git commit -m "Add import data layer: id-remap, vector adopt/re-embed, binding degradation

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 10: import auto-detect wiring + persona lands in editor (Laura HARD-1)

**Files:**
- Modify: `apps/user-client/src/components/persona-editor/ChatsuneImportControl.tsx` (generalise to auto-detect; or add a sibling that branches)
- Modify: `apps/user-client/src/routes/app/persona-editor.tsx` (landing on the new persona after a Chatsundere import)
- Modify: `apps/user-client/src/routes/app/knowledge.tsx` (auto-detect library import)
- Test: `apps/user-client/src/components/persona-editor/import-detect.test.ts` (a small unit over the branch helper)

**Interfaces:**
- Consumes: `detectArchiveFormat` (Task 2), `importPersonaPack`/`importKnowledgePack` (Task 9), existing Chatsune import functions.
- Produces: a shared helper `async function readManifestFormat(file: Blob): Promise<DetectedFormat>` (gunzip+untar just the manifest, reuse `archive-reader`) so both entry points branch identically.

Behaviour: on file pick, read the manifest format. `chatsune/*` → existing flow. `chatsundere/persona` → call `importPersonaPack(file, name)` then **navigate to the new persona's editor** (`/app/persona/:id/edit` — confirm the actual route from `persona-editor.tsx`); `chatsundere/knowledge` → `importKnowledgePack(file, name)` + toast. `unknown` → the existing user-facing "not a valid export" error.

- [ ] **Step 1: Write the failing test** for `readManifestFormat`

```ts
import { describe, expect, it } from 'vitest';
import { writePersonaPack } from '../../lib/chatsundere-transfer/persona-pack.js';
import { readManifestFormat } from './import-detect.js';
// minimalPayload(): copy the helper verbatim from persona-pack.test.ts (Task 5).

it('detects a chatsundere persona archive from its manifest', async () => {
  const blob = await writePersonaPack(minimalPayload());
  expect(await readManifestFormat(blob)).toBe('chatsundere/persona');
});

it('returns unknown for a non-archive file', async () => {
  expect(await readManifestFormat(new Blob([new Uint8Array([0, 1, 2])]))).toBe('unknown');
});
```

Note: `readManifestFormat` must swallow the gunzip/parse errors of a non-archive file and return `'unknown'` (do not throw) so the entry points can show the existing user-facing "not a valid export" message.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/components/persona-editor/import-detect.test.ts`
Expected: FAIL — `readManifestFormat` not found.

- [ ] **Step 3: Implement `import-detect.ts`** (the shared `readManifestFormat`) and wire both entry points. For the persona landing, after `importPersonaPack` resolves, `navigate` to the new persona editor route (match the route used elsewhere, e.g. the Chatsune path's post-apply navigation). Keep the Chatsune path byte-unchanged.

- [ ] **Step 4: Run test + the editor/knowledge component tests**

Run: `cd apps/user-client && pnpm vitest run src/components/persona-editor src/routes/app/knowledge`
Expected: PASS (existing tests stay green; new detect test passes).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/persona-editor/ apps/user-client/src/routes/app/persona-editor.tsx apps/user-client/src/routes/app/knowledge.tsx
git commit -m "Auto-detect Chatsundere imports; land persona import in the editor

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 11: export overlay UI + ⋯ wiring + completion toasts

**Files:**
- Create: `apps/user-client/src/components/transfer/ExportOverlay.tsx`
- Test: `apps/user-client/src/components/transfer/ExportOverlay.test.tsx`
- Modify: the persona `⋯` menu (My Circle row and/or persona-editor header) + the library-detail `⋯` menu to add an "Export" item.

**Interfaces:**
- Consumes: `exportPersona`/`exportLibrary` (Task 8), the makeover primitives (`OverflowMenu`, `Button`, a `ConfirmDialog`/overlay shell), the existing toast mechanism, a file-download helper (`triggerDownload(blob, filename)` — create one in `lib/download.ts` if none exists).
- Produces: `<ExportOverlay personaId={...} personaName={...} onClose={...} />` — the three toggles (Memory default ON, Artefacts default ON, Images default OFF) with honest subtitles (§4.2), an "Export" button → `exportPersona` → `triggerDownload` → toast "Persona exported" → close.

Behaviour:
- Persona export = the overlay above.
- Library export = **no overlay**: the `⋯` "Export" item directly calls `exportLibrary` → `triggerDownload` → toast "Library exported" (Laura SOFT-5).
- Toggle subtitles: Memory → "Your private memories from chats with this persona."; Images → "Off: in-chat images become placeholders in the copy." (§4.2).

- [ ] **Step 1: Write the failing test** (RTL — toggles render with defaults, export calls through)

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExportOverlay } from './ExportOverlay.js';

vi.mock('../../data/chatsundere-export.js', () => ({
  exportPersona: vi.fn(async () => new Blob(['x'])),
  exportLibrary: vi.fn(),
}));

it('defaults Memory/Artefacts on and Images off, and exports on confirm', async () => {
  const { exportPersona } = await import('../../data/chatsundere-export.js');
  render(<ExportOverlay personaId="p1" personaName="Fable" onClose={() => {}} />);
  expect((screen.getByLabelText(/memory/i) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText(/images/i) as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: /export/i }));
  expect(exportPersona).toHaveBeenCalledWith('p1', { memory: true, artefacts: true, images: false });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/components/transfer/ExportOverlay.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ExportOverlay.tsx`** + `lib/download.ts` (`triggerDownload`) + wire the `⋯` items. Match the makeover overlay aesthetic (transient zoom shell, `Button` tones). Filenames: `slug(name)-chatsundere.tar.gz`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run src/components/transfer/ExportOverlay.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/transfer/ apps/user-client/src/lib/download.ts
git commit -m "Add transient export overlay + library direct-export with completion toasts

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 12: post-import note + collision warning + final integration

**Files:**
- Modify: the import entry points (Task 10 files) to surface the **post-import note** (Laura HARD-1/SOFT-1) and the **explanatory name-collision warning** (SOFT-2).
- Test: `apps/user-client/src/components/persona-editor/post-import-note.test.tsx`

**Interfaces:**
- Consumes: `ImportedPersonaResult` (`modelBound`, `droppedBindings`) from Task 9; the existing persona-name lookup to detect a collision before import.

Behaviour:
- Before import, if a persona/library with `targetName` exists, show the explanatory warning (non-blocking): *"You already have a 'Fable'. Importing creates a second, separate one — nothing is merged or overwritten."* (§4.6).
- After a persona import lands in the editor, render one calm non-modal note built from the result: model clause only if `!modelBound`, bindings clause only if `droppedBindings`. Wording per §4.6a.

- [ ] **Step 1: Write the failing test** (the note composes the right clauses)

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PostImportNote } from './PostImportNote.js';

it('shows the model clause only when unbound and the bindings clause only when dropped', () => {
  const { rerender } = render(<PostImportNote modelBound={false} droppedBindings={true} />);
  expect(screen.getByText(/pick a model/i)).toBeInTheDocument();
  expect(screen.getByText(/library links and mcp/i)).toBeInTheDocument();

  rerender(<PostImportNote modelBound={true} droppedBindings={false} />);
  expect(screen.queryByText(/pick a model/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/library links and mcp/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/components/persona-editor/post-import-note.test.tsx`
Expected: FAIL — `PostImportNote` not found.

- [ ] **Step 3: Implement `PostImportNote.tsx`** + wire it into the editor landing + add the collision warning to both import entry points.

- [ ] **Step 4: Run the full user-client suite + typecheck**

Run: `cd apps/user-client && pnpm vitest run && cd ../.. && pnpm typecheck --force && pnpm biome check apps/user-client/src`
Expected: full suite at the **8 Node-localStorage baseline** (no new failures beyond the known baseline); typecheck 14/14; Biome clean.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/persona-editor/
git commit -m "Add post-import note + explanatory name-collision warning

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Manual verification (device, Chris)

1. Export "Fable" with **Images off** → a `.tar.gz` lands in Downloads + a "Persona exported" toast.
2. On a fresh-state client, import that file → lands in the persona editor of a new "Fable"; chat history, **reasoning**, and **memory** are present; the avatar shows; the model picker is unset and the post-import note says to pick one + that library/MCP links don't transfer.
3. Import again → the explanatory name-collision warning appears; confirming creates a second, separate "Fable" (nothing merged).
4. Export a **library** (with documents already embedded) → immediate download + "Library exported" toast. Import it → documents go **ready instantly** (adopt path, no embedding spinner).
5. A message that had an in-chat image shows the neutral "Image not carried over in this transfer." placeholder, and the chat stays readable.

## Out of scope (do not build)

Merge into an existing persona/library; sync; provider/key transfer; exporting the embedding model; a live export-size estimate. (Spec §10.)
