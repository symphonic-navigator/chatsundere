# Chatsune Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Chatsundere user import a chatsune persona export (chats + persona core, Tier A fidelity, avatar) and a chatsune knowledge-library export into the local-first client.

**Architecture:** A new `apps/user-client/src/lib/chatsune-import/` holds pure, fully-tested modules — a `.tar.gz` reader, a crop converter, the NSFW rule, the dropped-content hint builder, the message mapper, and two archive parsers. A new `apps/user-client/src/data/chatsune-import.ts` holds the Dexie writers (session merge with per-persona idempotency, library import). The persona import is wired into the existing persona editor (entry point A — new + merge); the knowledge import into the existing Libraries view. The whole feature is client-only; no chatsune code is reused — only its export *format*.

**Tech Stack:** TypeScript (strict), Dexie/IndexedDB, React 18 + TanStack Query + Zustand, vitest + `fake-indexeddb` + React Testing Library, Biome. `DecompressionStream('gzip')` for gunzip (global in the Node/Bun test+runtime environment).

**Spec:** `superpowers/specs/2026-06-18-chatsune-import-design.md` (read it before starting).

## Global Constraints

- **British English** in all code, comments, identifiers, log/error strings, UI copy, test fixtures. No mixed-language strings.
- **TypeScript strict:** `strict: true`, `noUncheckedIndexedAccess: true`. No `any` without an inline justification comment. Biome bans non-null `!`.
- **Every file starts with** `// SPDX-License-Identifier: AGPL-3.0-only` (matches every existing user-client source file).
- **Tier A fidelity only:** import user text, persona text, and CoT (`reasoning`). Drop tool-calls, images, attachments, artefacts, knowledge injections; summarise per message in a text hint. Never reconstruct pills.
- **NSFW is monotonic:** `adultPersona` only goes `false → true` on import, never `true → false`, independent of the config-overwrite choice.
- **Idempotency is per persona:** dedup imported sessions by chatsune `original_id` against the target persona's existing chats only.
- **No Dexie version bump:** `ChatRow.importedFrom` is a non-indexed schemaless field (precedent: `bookmarkLabel`, `kind`, `triggerOnCompanion`).
- **Gate before any commit you call done:** `pnpm typecheck --force` (covers tests) and Biome both clean; run them yourself — the pre-commit hook runs Biome only.
- **Test commands run from `apps/user-client/`:** `pnpm vitest run <path>` for a file. Full suite baseline is the known **8 Node-localStorage failures** — a 9th is real.
- **Commit message co-author tag:** `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`. Code commits do **not** get `[skip ci]`.

---

### Task 1: Archive reader + chatsune DTO types

**Files:**
- Create: `apps/user-client/src/lib/chatsune-import/types.ts`
- Create: `apps/user-client/src/lib/chatsune-import/archive-reader.ts`
- Test: `apps/user-client/tests/lib/chatsune-import/archive-reader.test.ts`

**Interfaces:**
- Produces:
  - `types.ts` — `ChatsuneManifest`, `ChatsuneProfileCrop`, `ChatsunePersonaJson`, `ChatsuneMessage`, `ChatsuneSessionExport`, `ChatsuneSessionsBundle`, `ChatsuneLibraryJson`, `ChatsuneDocumentJson` (see code below).
  - `archive-reader.ts` — `untar(buf: Uint8Array): TarEntry[]`, `gunzip(buf: Uint8Array): Promise<Uint8Array>`, `readChatsuneArchive(input: Blob | Uint8Array): Promise<ChatsuneArchive>`, types `TarEntry { name: string; bytes: Uint8Array }` and `ChatsuneArchive { manifest: ChatsuneManifest; files: Map<string, Uint8Array> }`.

- [ ] **Step 1: Create the DTO types**

Create `apps/user-client/src/lib/chatsune-import/types.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

/** Wire-format types for chatsune's `.tar.gz` exports (format/version in the manifest). */

export interface ChatsuneManifest {
  format: string;
  version: number;
  exported_at?: string;
  include_content?: boolean;
  source_persona_name?: string;
  source_library_name?: string;
}

export interface ChatsuneProfileCrop {
  /** Pixel offset from the 280px canvas centre. */
  x: number;
  y: number;
  /** Multiplier on the natural image size (1 = unscaled). */
  zoom: number;
  /** Natural dimensions of chatsune's normalised image (<=1024). */
  width: number;
  height: number;
}

export interface ChatsunePersonaJson {
  name: string;
  tagline: string;
  system_prompt: string;
  nsfw: boolean;
  use_memory?: boolean;
  colour_scheme?: string;
  monogram?: string;
  profile_crop?: ChatsuneProfileCrop;
  has_avatar?: boolean;
}

export interface ChatsuneMessage {
  id?: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  thinking?: string | null;
  created_at?: string;
  status?: string;
  refusal_text?: string | null;
  attachments?: unknown[] | null;
  tool_calls?: unknown[] | null;
  image_refs?: unknown[] | null;
  knowledge_context?: unknown[] | null;
  artefact_refs?: unknown[] | null;
}

export interface ChatsuneSessionExport {
  original_id: string;
  session_fields: {
    title?: string | null;
    created_at?: string;
    updated_at?: string;
    deleted_at?: string | null;
    pinned?: boolean;
  };
  messages: ChatsuneMessage[];
}

export interface ChatsuneSessionsBundle {
  sessions: ChatsuneSessionExport[];
}

export interface ChatsuneLibraryJson {
  name: string;
  description?: string | null;
  nsfw?: boolean;
  default_refresh?: string;
}

export interface ChatsuneDocumentJson {
  title: string;
  content: string;
  media_type?: string;
  trigger_phrases?: string[];
  refresh?: string | null;
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/user-client/tests/lib/chatsune-import/archive-reader.test.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { readChatsuneArchive, untar } from '../../../src/lib/chatsune-import/archive-reader.js';

/** Build a single ustar tar entry (one 512-byte header + padded data). */
function tarEntry(name: string, content: Uint8Array): Uint8Array {
  const header = new Uint8Array(512);
  const enc = new TextEncoder();
  header.set(enc.encode(name).slice(0, 100), 0);
  header.set(enc.encode('0000644'), 100); // mode
  header.set(enc.encode('0000000'), 108); // uid
  header.set(enc.encode('0000000'), 116); // gid
  // size as 11-octal-digit + NUL at offset 124
  const sizeOctal = content.length.toString(8).padStart(11, '0');
  header.set(enc.encode(sizeOctal), 124);
  header[135] = 0;
  header.set(enc.encode('00000000000'), 136); // mtime
  header[156] = '0'.charCodeAt(0); // typeflag = regular file
  header.set(enc.encode('ustar\0'), 257);
  header.set(enc.encode('00'), 263);
  // checksum: blanks during compute, then octal
  for (let i = 148; i < 156; i++) header[i] = 0x20;
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i] ?? 0;
  header.set(enc.encode(sum.toString(8).padStart(6, '0')), 148);
  header[154] = 0;
  header[155] = 0x20;
  const padded = new Uint8Array(Math.ceil(content.length / 512) * 512);
  padded.set(content, 0);
  const out = new Uint8Array(header.length + padded.length);
  out.set(header, 0);
  out.set(padded, header.length);
  return out;
}

function makeTar(entries: { name: string; content: string }[]): Uint8Array {
  const enc = new TextEncoder();
  const blocks = entries.map((e) => tarEntry(e.name, enc.encode(e.content)));
  const trailer = new Uint8Array(1024); // two zero blocks
  const total = blocks.reduce((n, b) => n + b.length, 0) + trailer.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of blocks) {
    out.set(b, off);
    off += b.length;
  }
  return out;
}

async function gzip(buf: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  void writer.write(buf);
  void writer.close();
  const ab = await new Response(cs.readable).arrayBuffer();
  return new Uint8Array(ab);
}

describe('untar', () => {
  it('reads file names and contents back', () => {
    const tar = makeTar([
      { name: 'manifest.json', content: '{"format":"x","version":1}' },
      { name: 'persona.json', content: '{"name":"Fable"}' },
    ]);
    const entries = untar(tar);
    expect(entries.map((e) => e.name)).toEqual(['manifest.json', 'persona.json']);
    expect(new TextDecoder().decode(entries[1]?.bytes)).toBe('{"name":"Fable"}');
  });
});

describe('readChatsuneArchive', () => {
  it('gunzips, untars, and parses the manifest', async () => {
    const tar = makeTar([
      { name: 'manifest.json', content: '{"format":"chatsune/persona","version":1}' },
      { name: 'persona.json', content: '{"name":"Fable"}' },
    ]);
    const gz = await gzip(tar);
    const archive = await readChatsuneArchive(gz);
    expect(archive.manifest.format).toBe('chatsune/persona');
    expect(archive.files.has('persona.json')).toBe(true);
  });

  it('throws a clear error when the file is not a gzip archive', async () => {
    await expect(readChatsuneArchive(new Uint8Array([1, 2, 3]))).rejects.toThrow(
      /could not read this file/i,
    );
  });

  it('throws when manifest.json is missing', async () => {
    const gz = await gzip(makeTar([{ name: 'persona.json', content: '{}' }]));
    await expect(readChatsuneArchive(gz)).rejects.toThrow(/not a chatsune export/i);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/lib/chatsune-import/archive-reader.test.ts`
Expected: FAIL — cannot resolve `archive-reader.js`.

- [ ] **Step 4: Implement the archive reader**

Create `apps/user-client/src/lib/chatsune-import/archive-reader.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import type { ChatsuneManifest } from './types.js';

export interface TarEntry {
  name: string;
  bytes: Uint8Array;
}

export interface ChatsuneArchive {
  manifest: ChatsuneManifest;
  files: Map<string, Uint8Array>;
}

/** Parse a (decompressed) ustar tarball into its regular-file entries. */
export function untar(buf: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  const dec = new TextDecoder();
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    // A zero name field marks the end-of-archive trailer.
    if (header[0] === 0) break;
    const rawName = dec.decode(header.subarray(0, 100)).replace(/\0.*$/, '');
    const sizeStr = dec.decode(header.subarray(124, 136)).replace(/[\0 ]/g, '');
    const size = Number.parseInt(sizeStr, 8) || 0;
    const typeFlag = header[156];
    offset += 512;
    // typeFlag '0' (0x30) or '\0' (0x00) is a regular file; skip directories etc.
    if ((typeFlag === 0x30 || typeFlag === 0x00) && rawName) {
      entries.push({ name: rawName, bytes: buf.subarray(offset, offset + size) });
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return entries;
}

/** Decompress a gzip buffer using the platform DecompressionStream. */
export async function gunzip(buf: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  void writer.write(buf);
  void writer.close();
  const ab = await new Response(ds.readable).arrayBuffer();
  return new Uint8Array(ab);
}

async function toBytes(input: Blob | Uint8Array): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return input;
  return new Uint8Array(await input.arrayBuffer());
}

/**
 * Read a chatsune `.tar.gz` export: gunzip, untar, index files by name, and
 * parse the required `manifest.json`. Throws user-facing errors on a
 * non-archive file or a missing manifest.
 */
export async function readChatsuneArchive(input: Blob | Uint8Array): Promise<ChatsuneArchive> {
  const raw = await toBytes(input);
  let tarBytes: Uint8Array;
  try {
    tarBytes = await gunzip(raw);
  } catch {
    throw new Error('Could not read this file — is it a Chatsune export?');
  }
  const files = new Map<string, Uint8Array>();
  for (const e of untar(tarBytes)) files.set(e.name, e.bytes);
  const manifestBytes = files.get('manifest.json');
  if (!manifestBytes) {
    throw new Error('This file is not a Chatsune export (no manifest).');
  }
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as ChatsuneManifest;
  return { manifest, files };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run tests/lib/chatsune-import/archive-reader.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Typecheck, lint, commit**

Run: `pnpm typecheck --force` (from repo root) and `cd apps/user-client && pnpm biome check src/lib/chatsune-import tests/lib/chatsune-import`
Expected: both clean.

```bash
git add apps/user-client/src/lib/chatsune-import/types.ts apps/user-client/src/lib/chatsune-import/archive-reader.ts apps/user-client/tests/lib/chatsune-import/archive-reader.test.ts
git commit -m "Add chatsune-import archive reader and DTO types

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 2: Avatar crop conversion

**Files:**
- Create: `apps/user-client/src/lib/chatsune-import/crop-convert.ts`
- Test: `apps/user-client/tests/lib/chatsune-import/crop-convert.test.ts`

**Interfaces:**
- Consumes: `ChatsuneProfileCrop` (Task 1), `AvatarCrop` from `boot/client-data-db.js`.
- Produces: `convertChatsuneCrop(c: ChatsuneProfileCrop): AvatarCrop`, `CHATSUNE_CROP_DIAMETER` constant.

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/lib/chatsune-import/crop-convert.test.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { convertChatsuneCrop } from '../../../src/lib/chatsune-import/crop-convert.js';

describe('convertChatsuneCrop', () => {
  it('maps chatsune default framing (zoom = diameter/shortSide) to chatsundere zoom 1', () => {
    // shortSide 1000, default chatsune zoom = 220/1000 = 0.22 → expect zoom 1.
    const out = convertChatsuneCrop({ x: 0, y: 0, zoom: 220 / 1000, width: 1000, height: 1000 });
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
    expect(out.zoom).toBeCloseTo(1, 5);
  });

  it('converts pixel offsets to fractions of 220', () => {
    const out = convertChatsuneCrop({ x: 44, y: -22, zoom: 220 / 1000, width: 1000, height: 1000 });
    expect(out.x).toBeCloseTo(0.2, 5);
    expect(out.y).toBeCloseTo(-0.1, 5);
  });

  it('clamps a below-cover zoom up to 1', () => {
    // chatsune zoom below the cover threshold → chatsundere cannot represent → clamp to 1.
    const out = convertChatsuneCrop({ x: 0, y: 0, zoom: 0.05, width: 1000, height: 1000 });
    expect(out.zoom).toBe(1);
  });

  it('clamps a very large zoom down to 3', () => {
    const out = convertChatsuneCrop({ x: 0, y: 0, zoom: 5, width: 1000, height: 1000 });
    expect(out.zoom).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/lib/chatsune-import/crop-convert.test.ts`
Expected: FAIL — cannot resolve `crop-convert.js`.

- [ ] **Step 3: Implement the converter**

Create `apps/user-client/src/lib/chatsune-import/crop-convert.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import type { AvatarCrop } from '../../boot/client-data-db.js';
import type { ChatsuneProfileCrop } from './types.js';

/** Diameter of chatsune's circular crop region on its 280px editor canvas. */
export const CHATSUNE_CROP_DIAMETER = 220;

/**
 * Convert a chatsune `profile_crop` into Chatsundere's `AvatarCrop`.
 *
 * chatsune: x/y are pixel offsets from the canvas centre; zoom multiplies the
 * natural size (1 = unscaled), the crop region being a 220px circle.
 * Chatsundere: x/y are fractions of the display box; zoom multiplies the
 * cover-scale (1 = covers the box). The default chatsune framing
 * (zoom = 220 / shortSide) maps exactly to zoom 1; a below-cover zoom cannot be
 * represented and clamps to 1.
 */
export function convertChatsuneCrop(c: ChatsuneProfileCrop): AvatarCrop {
  const shortSide = Math.max(1, Math.min(c.width, c.height));
  const rawZoom = (c.zoom * shortSide) / CHATSUNE_CROP_DIAMETER;
  const zoom = Math.min(3, Math.max(1, rawZoom));
  return {
    x: c.x / CHATSUNE_CROP_DIAMETER,
    y: c.y / CHATSUNE_CROP_DIAMETER,
    zoom,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run tests/lib/chatsune-import/crop-convert.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck, lint, commit**

Run: `pnpm typecheck --force` and `cd apps/user-client && pnpm biome check src/lib/chatsune-import tests/lib/chatsune-import`

```bash
git add apps/user-client/src/lib/chatsune-import/crop-convert.ts apps/user-client/tests/lib/chatsune-import/crop-convert.test.ts
git commit -m "Add chatsune avatar crop conversion

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 3: NSFW rule + dropped-content hint builder

**Files:**
- Create: `apps/user-client/src/lib/chatsune-import/nsfw.ts`
- Create: `apps/user-client/src/lib/chatsune-import/dropped-hint.ts`
- Test: `apps/user-client/tests/lib/chatsune-import/nsfw.test.ts`
- Test: `apps/user-client/tests/lib/chatsune-import/dropped-hint.test.ts`

**Interfaces:**
- Consumes: `ChatsuneMessage` (Task 1).
- Produces:
  - `nsfw.ts` — `resolveImportedNsfw(existing: boolean, imported: boolean): boolean`.
  - `dropped-hint.ts` — `DroppedCounts { images; toolCalls; attachments; artefacts; knowledgeLookups }`, `countDropped(m: ChatsuneMessage): DroppedCounts`, `buildDroppedHint(counts: DroppedCounts): string | null`.

- [ ] **Step 1: Write the failing NSFW test**

Create `apps/user-client/tests/lib/chatsune-import/nsfw.test.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { resolveImportedNsfw } from '../../../src/lib/chatsune-import/nsfw.js';

describe('resolveImportedNsfw (monotonic upgrade)', () => {
  it('false + true => true', () => expect(resolveImportedNsfw(false, true)).toBe(true));
  it('true + false => true (never downgraded)', () =>
    expect(resolveImportedNsfw(true, false)).toBe(true));
  it('false + false => false', () => expect(resolveImportedNsfw(false, false)).toBe(false));
  it('true + true => true', () => expect(resolveImportedNsfw(true, true)).toBe(true));
});
```

- [ ] **Step 2: Write the failing hint test**

Create `apps/user-client/tests/lib/chatsune-import/dropped-hint.test.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { buildDroppedHint, countDropped } from '../../../src/lib/chatsune-import/dropped-hint.js';

describe('countDropped', () => {
  it('counts the rich arrays on a message', () => {
    const counts = countDropped({
      role: 'assistant',
      content: 'hi',
      image_refs: [{}, {}],
      tool_calls: [{}],
      attachments: null,
      artefacts: undefined as never,
      knowledge_context: [{}],
    });
    expect(counts).toEqual({
      images: 2,
      toolCalls: 1,
      attachments: 0,
      artefacts: 0,
      knowledgeLookups: 1,
    });
  });
});

describe('buildDroppedHint', () => {
  it('returns null when nothing was dropped', () => {
    expect(
      buildDroppedHint({ images: 0, toolCalls: 0, attachments: 0, artefacts: 0, knowledgeLookups: 0 }),
    ).toBeNull();
  });

  it('summarises a single category in the singular', () => {
    expect(
      buildDroppedHint({ images: 0, toolCalls: 1, attachments: 0, artefacts: 0, knowledgeLookups: 0 }),
    ).toBe('[1 tool call from the original message was not imported.]');
  });

  it('joins multiple categories with commas and "and", and pluralises', () => {
    expect(
      buildDroppedHint({ images: 2, toolCalls: 1, attachments: 0, artefacts: 0, knowledgeLookups: 0 }),
    ).toBe('[2 images and 1 tool call from the original message were not imported.]');
  });
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `cd apps/user-client && pnpm vitest run tests/lib/chatsune-import/nsfw.test.ts tests/lib/chatsune-import/dropped-hint.test.ts`
Expected: FAIL — modules unresolved.

- [ ] **Step 4: Implement the NSFW rule**

Create `apps/user-client/src/lib/chatsune-import/nsfw.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The NSFW import rule: `adultPersona` can only gain capability, never lose it.
 * Applied independently of the config-overwrite choice (spec §5.3).
 */
export function resolveImportedNsfw(existing: boolean, imported: boolean): boolean {
  return existing || imported;
}
```

- [ ] **Step 5: Implement the hint builder**

Create `apps/user-client/src/lib/chatsune-import/dropped-hint.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import type { ChatsuneMessage } from './types.js';

export interface DroppedCounts {
  images: number;
  toolCalls: number;
  attachments: number;
  artefacts: number;
  knowledgeLookups: number;
}

function len(arr: unknown[] | null | undefined): number {
  return Array.isArray(arr) ? arr.length : 0;
}

/** Count the Tier-A-dropped content on a chatsune message. */
export function countDropped(m: ChatsuneMessage): DroppedCounts {
  return {
    images: len(m.image_refs),
    toolCalls: len(m.tool_calls),
    attachments: len(m.attachments),
    artefacts: len(m.artefact_refs),
    knowledgeLookups: len(m.knowledge_context),
  };
}

/** British-English singular/plural noun for a dropped category. */
function noun(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * A short, recognisable per-message note for dropped content, or null when the
 * message lost nothing. Example:
 * "[2 images and 1 tool call from the original message were not imported.]"
 */
export function buildDroppedHint(counts: DroppedCounts): string | null {
  const parts: string[] = [];
  if (counts.images) parts.push(noun(counts.images, 'image', 'images'));
  if (counts.toolCalls) parts.push(noun(counts.toolCalls, 'tool call', 'tool calls'));
  if (counts.attachments) parts.push(noun(counts.attachments, 'attachment', 'attachments'));
  if (counts.artefacts) parts.push(noun(counts.artefacts, 'artefact', 'artefacts'));
  if (counts.knowledgeLookups)
    parts.push(noun(counts.knowledgeLookups, 'knowledge lookup', 'knowledge lookups'));
  if (parts.length === 0) return null;
  const total =
    counts.images +
    counts.toolCalls +
    counts.attachments +
    counts.artefacts +
    counts.knowledgeLookups;
  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  const verb = total === 1 ? 'was' : 'were';
  return `[${list} from the original message ${verb} not imported.]`;
}
```

- [ ] **Step 6: Run both tests to verify they pass**

Run: `cd apps/user-client && pnpm vitest run tests/lib/chatsune-import/nsfw.test.ts tests/lib/chatsune-import/dropped-hint.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck, lint, commit**

Run: `pnpm typecheck --force` and `cd apps/user-client && pnpm biome check src/lib/chatsune-import tests/lib/chatsune-import`

```bash
git add apps/user-client/src/lib/chatsune-import/nsfw.ts apps/user-client/src/lib/chatsune-import/dropped-hint.ts apps/user-client/tests/lib/chatsune-import/nsfw.test.ts apps/user-client/tests/lib/chatsune-import/dropped-hint.test.ts
git commit -m "Add chatsune-import NSFW rule and dropped-content hint builder

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 4: Message mapper (Tier A)

**Files:**
- Create: `apps/user-client/src/lib/chatsune-import/message-map.ts`
- Test: `apps/user-client/tests/lib/chatsune-import/message-map.test.ts`

**Interfaces:**
- Consumes: `ChatsuneMessage` (Task 1), `countDropped`/`buildDroppedHint` (Task 3), `ContentBlock` from `boot/client-data-db.js`.
- Produces: `MappedMessage { role: 'user' | 'persona'; contentBlocks: ContentBlock[]; createdAt: number }`, `mapChatsuneMessage(m: ChatsuneMessage, fallbackCreatedAt: number): MappedMessage | null` (null = skip, e.g. tool-role messages).

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/lib/chatsune-import/message-map.test.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { mapChatsuneMessage } from '../../../src/lib/chatsune-import/message-map.js';

const BASE = 1_700_000_000_000;

describe('mapChatsuneMessage', () => {
  it('maps a user text message', () => {
    const out = mapChatsuneMessage(
      { role: 'user', content: 'hello', created_at: '2026-01-01T00:00:00Z' },
      BASE,
    );
    expect(out).not.toBeNull();
    expect(out?.role).toBe('user');
    expect(out?.contentBlocks).toEqual([{ type: 'text', text: 'hello' }]);
    expect(out?.createdAt).toBe(Date.parse('2026-01-01T00:00:00Z'));
  });

  it('maps assistant role to persona and includes a reasoning block', () => {
    const out = mapChatsuneMessage(
      { role: 'assistant', content: 'answer', thinking: 'pondering' },
      BASE,
    );
    expect(out?.role).toBe('persona');
    expect(out?.contentBlocks).toEqual([
      { type: 'text', text: 'answer' },
      { type: 'reasoning', text: 'pondering' },
    ]);
  });

  it('appends a dropped-content hint as a final text block', () => {
    const out = mapChatsuneMessage(
      { role: 'assistant', content: 'see image', image_refs: [{}, {}], tool_calls: [{}] },
      BASE,
    );
    expect(out?.contentBlocks).toEqual([
      { type: 'text', text: 'see image' },
      { type: 'text', text: '[2 images and 1 tool call from the original message were not imported.]' },
    ]);
  });

  it('uses refusal_text when content is empty and the message was refused', () => {
    const out = mapChatsuneMessage(
      { role: 'assistant', content: '', status: 'refused', refusal_text: 'I cannot help with that.' },
      BASE,
    );
    expect(out?.contentBlocks).toEqual([{ type: 'text', text: 'I cannot help with that.' }]);
  });

  it('skips tool-role messages', () => {
    expect(mapChatsuneMessage({ role: 'tool', content: 'result' }, BASE)).toBeNull();
  });

  it('falls back to the provided timestamp when created_at is missing or invalid', () => {
    expect(mapChatsuneMessage({ role: 'user', content: 'x' }, BASE)?.createdAt).toBe(BASE);
    expect(
      mapChatsuneMessage({ role: 'user', content: 'x', created_at: 'not-a-date' }, BASE)?.createdAt,
    ).toBe(BASE);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/lib/chatsune-import/message-map.test.ts`
Expected: FAIL — module unresolved.

- [ ] **Step 3: Implement the mapper**

Create `apps/user-client/src/lib/chatsune-import/message-map.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import type { ContentBlock } from '../../boot/client-data-db.js';
import { buildDroppedHint, countDropped } from './dropped-hint.js';
import type { ChatsuneMessage } from './types.js';

export interface MappedMessage {
  role: 'user' | 'persona';
  contentBlocks: ContentBlock[];
  createdAt: number;
}

/**
 * Map a chatsune message to a Chatsundere message (Tier A): user/persona text +
 * CoT reasoning + a per-message hint for dropped content. Returns null for
 * tool-role messages, which have no Chatsundere equivalent and are skipped.
 */
export function mapChatsuneMessage(
  m: ChatsuneMessage,
  fallbackCreatedAt: number,
): MappedMessage | null {
  if (m.role === 'tool') return null;

  const blocks: ContentBlock[] = [];
  const primary = m.content?.trim()
    ? m.content
    : m.status === 'refused' && m.refusal_text
      ? m.refusal_text
      : '';
  if (primary) blocks.push({ type: 'text', text: primary });
  if (m.thinking?.trim()) blocks.push({ type: 'reasoning', text: m.thinking });

  const hint = buildDroppedHint(countDropped(m));
  if (hint) blocks.push({ type: 'text', text: hint });

  const parsed = m.created_at ? Date.parse(m.created_at) : Number.NaN;
  const createdAt = Number.isFinite(parsed) ? parsed : fallbackCreatedAt;

  return { role: m.role === 'assistant' ? 'persona' : 'user', contentBlocks: blocks, createdAt };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run tests/lib/chatsune-import/message-map.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck, lint, commit**

Run: `pnpm typecheck --force` and `cd apps/user-client && pnpm biome check src/lib/chatsune-import tests/lib/chatsune-import`

```bash
git add apps/user-client/src/lib/chatsune-import/message-map.ts apps/user-client/tests/lib/chatsune-import/message-map.test.ts
git commit -m "Add chatsune-import Tier A message mapper

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 5: Persona export parser (+ memory tripwire)

**Files:**
- Create: `apps/user-client/src/lib/chatsune-import/persona-parse.ts`
- Test: `apps/user-client/tests/lib/chatsune-import/persona-parse.test.ts`

**Interfaces:**
- Consumes: `ChatsuneArchive` (Task 1), `convertChatsuneCrop` (Task 2), `AvatarCrop` from `boot/client-data-db.js`.
- Produces:
  - `ParsedPersonaExport { persona: { name; tagline; instructions; nsfw }; avatar: ParsedAvatar | null; sessions: ChatsuneSessionExport[]; memoryCount: number }`
  - `ParsedAvatar { bytes: Uint8Array; mime: string; crop: AvatarCrop }`
  - `parsePersonaExport(archive: ChatsuneArchive): ParsedPersonaExport` (throws on wrong format / unsupported version / missing persona.json).
  - `IMPORT_FORMAT_PERSONA = 'chatsune/persona'`, `SUPPORTED_VERSION = 1`.

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/lib/chatsune-import/persona-parse.test.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { ChatsuneArchive } from '../../../src/lib/chatsune-import/archive-reader.js';
import { parsePersonaExport } from '../../../src/lib/chatsune-import/persona-parse.js';

function file(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj));
}

function archive(
  manifest: Record<string, unknown>,
  files: Record<string, Uint8Array>,
): ChatsuneArchive {
  return { manifest: manifest as ChatsuneArchive['manifest'], files: new Map(Object.entries(files)) };
}

describe('parsePersonaExport', () => {
  it('extracts persona core fields, sessions, and avatar crop', () => {
    const arc = archive(
      { format: 'chatsune/persona', version: 1 },
      {
        'persona.json': file({
          name: 'Fable',
          tagline: 'Your companion',
          system_prompt: 'You are Fable.',
          nsfw: true,
          profile_crop: { x: 0, y: 0, zoom: 220 / 800, width: 800, height: 800 },
          has_avatar: true,
        }),
        'profile_image.png': new Uint8Array([1, 2, 3]),
        'sessions.json': file({ sessions: [{ original_id: 's1', session_fields: {}, messages: [] }] }),
      },
    );
    const out = parsePersonaExport(arc);
    expect(out.persona).toEqual({
      name: 'Fable',
      tagline: 'Your companion',
      instructions: 'You are Fable.',
      nsfw: true,
    });
    expect(out.sessions).toHaveLength(1);
    expect(out.avatar?.mime).toBe('image/png');
    expect(out.avatar?.crop.zoom).toBeCloseTo(1, 5);
    expect(out.memoryCount).toBe(0);
  });

  it('counts memories from memory.json (the future-import tripwire)', () => {
    const arc = archive(
      { format: 'chatsune/persona', version: 1 },
      {
        'persona.json': file({ name: 'A', tagline: '', system_prompt: '', nsfw: false }),
        'sessions.json': file({ sessions: [] }),
        'memory.json': file({ journal_entries: [{}, {}, {}], memory_bodies: [{}] }),
      },
    );
    expect(parsePersonaExport(arc).memoryCount).toBe(4);
  });

  it('returns avatar null when has_avatar is false', () => {
    const arc = archive(
      { format: 'chatsune/persona', version: 1 },
      {
        'persona.json': file({ name: 'A', tagline: '', system_prompt: '', nsfw: false, has_avatar: false }),
        'sessions.json': file({ sessions: [] }),
      },
    );
    expect(parsePersonaExport(arc).avatar).toBeNull();
  });

  it('rejects a knowledge archive', () => {
    const arc = archive({ format: 'chatsune/knowledge', version: 1 }, {});
    expect(() => parsePersonaExport(arc)).toThrow(/not a persona export/i);
  });

  it('rejects an unsupported newer version', () => {
    const arc = archive(
      { format: 'chatsune/persona', version: 2 },
      { 'persona.json': file({ name: 'A', tagline: '', system_prompt: '', nsfw: false }) },
    );
    expect(() => parsePersonaExport(arc)).toThrow(/newer version/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/lib/chatsune-import/persona-parse.test.ts`
Expected: FAIL — module unresolved.

- [ ] **Step 3: Implement the parser**

Create `apps/user-client/src/lib/chatsune-import/persona-parse.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import type { AvatarCrop } from '../../boot/client-data-db.js';
import type { ChatsuneArchive } from './archive-reader.js';
import { convertChatsuneCrop } from './crop-convert.js';
import type { ChatsunePersonaJson, ChatsuneSessionExport, ChatsuneSessionsBundle } from './types.js';

export const IMPORT_FORMAT_PERSONA = 'chatsune/persona';
export const SUPPORTED_VERSION = 1;

export interface ParsedAvatar {
  bytes: Uint8Array;
  mime: string;
  crop: AvatarCrop;
}

export interface ParsedPersonaExport {
  persona: { name: string; tagline: string; instructions: string; nsfw: boolean };
  avatar: ParsedAvatar | null;
  sessions: ChatsuneSessionExport[];
  /** Count of chatsune memories present in the export. FUTURE: when Chatsundere
   *  gains a memory system, import these (memory.json: journal_entries +
   *  memory_bodies). See obsidian/insights/future-feature-couplings.md. */
  memoryCount: number;
}

const AVATAR_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

function decodeJson<T>(files: Map<string, Uint8Array>, name: string): T | undefined {
  const bytes = files.get(name);
  if (!bytes) return undefined;
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

function findAvatar(files: Map<string, Uint8Array>): { bytes: Uint8Array; mime: string } | null {
  for (const [name, bytes] of files) {
    const m = /^profile_image\.([a-z0-9]+)$/i.exec(name);
    const ext = m?.[1]?.toLowerCase();
    if (ext && AVATAR_MIME[ext]) return { bytes, mime: AVATAR_MIME[ext] };
  }
  return null;
}

/** Parse a chatsune persona export into Chatsundere-shaped pieces (spec §5). */
export function parsePersonaExport(archive: ChatsuneArchive): ParsedPersonaExport {
  if (archive.manifest.format !== IMPORT_FORMAT_PERSONA) {
    throw new Error('This is not a persona export — pick a Chatsune persona file.');
  }
  if (archive.manifest.version > SUPPORTED_VERSION) {
    throw new Error('This export is from a newer version of Chatsune than this importer understands.');
  }
  const personaJson = decodeJson<ChatsunePersonaJson>(archive.files, 'persona.json');
  if (!personaJson) throw new Error('This persona export is incomplete (no persona data).');

  const sessionsBundle = decodeJson<ChatsuneSessionsBundle>(archive.files, 'sessions.json');
  const sessions = sessionsBundle?.sessions ?? [];

  const memory = decodeJson<{ journal_entries?: unknown[]; memory_bodies?: unknown[] }>(
    archive.files,
    'memory.json',
  );
  const memoryCount =
    (memory?.journal_entries?.length ?? 0) + (memory?.memory_bodies?.length ?? 0);

  let avatar: ParsedAvatar | null = null;
  if (personaJson.has_avatar !== false) {
    const found = findAvatar(archive.files);
    if (found) {
      const crop = personaJson.profile_crop
        ? convertChatsuneCrop(personaJson.profile_crop)
        : { x: 0, y: 0, zoom: 1 };
      avatar = { bytes: found.bytes, mime: found.mime, crop };
    }
  }

  return {
    persona: {
      name: personaJson.name,
      tagline: personaJson.tagline ?? '',
      instructions: personaJson.system_prompt ?? '',
      nsfw: !!personaJson.nsfw,
    },
    avatar,
    sessions,
    memoryCount,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run tests/lib/chatsune-import/persona-parse.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck, lint, commit**

Run: `pnpm typecheck --force` and `cd apps/user-client && pnpm biome check src/lib/chatsune-import tests/lib/chatsune-import`

```bash
git add apps/user-client/src/lib/chatsune-import/persona-parse.ts apps/user-client/tests/lib/chatsune-import/persona-parse.test.ts
git commit -m "Add chatsune persona export parser with memory tripwire

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 6: Knowledge export parser

**Files:**
- Create: `apps/user-client/src/lib/chatsune-import/knowledge-parse.ts`
- Test: `apps/user-client/tests/lib/chatsune-import/knowledge-parse.test.ts`

**Interfaces:**
- Consumes: `ChatsuneArchive` (Task 1), `ChatsuneLibraryJson`/`ChatsuneDocumentJson` (Task 1).
- Produces: `ParsedKnowledgeExport { name: string; description: string; nsfw: boolean; documents: { title: string; content: string; triggerPhrases: string[] }[] }`, `parseKnowledgeExport(archive: ChatsuneArchive): ParsedKnowledgeExport`, `IMPORT_FORMAT_KNOWLEDGE = 'chatsune/knowledge'`.

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/lib/chatsune-import/knowledge-parse.test.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { ChatsuneArchive } from '../../../src/lib/chatsune-import/archive-reader.js';
import { parseKnowledgeExport } from '../../../src/lib/chatsune-import/knowledge-parse.js';

function file(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj));
}
function archive(manifest: Record<string, unknown>, files: Record<string, Uint8Array>): ChatsuneArchive {
  return { manifest: manifest as ChatsuneArchive['manifest'], files: new Map(Object.entries(files)) };
}

describe('parseKnowledgeExport', () => {
  it('maps library and documents, preserving trigger phrases', () => {
    const arc = archive(
      { format: 'chatsune/knowledge', version: 1 },
      {
        'library.json': file({ name: 'Biology', description: 'core', nsfw: false, default_refresh: 'standard' }),
        'documents.json': file([
          { title: 'Photosynthesis', content: '# P', media_type: 'text/markdown', trigger_phrases: ['calvin'], refresh: 'often' },
        ]),
      },
    );
    const out = parseKnowledgeExport(arc);
    expect(out).toEqual({
      name: 'Biology',
      description: 'core',
      nsfw: false,
      documents: [{ title: 'Photosynthesis', content: '# P', triggerPhrases: ['calvin'] }],
    });
  });

  it('rejects a persona archive', () => {
    expect(() => parseKnowledgeExport(archive({ format: 'chatsune/persona', version: 1 }, {}))).toThrow(
      /not a knowledge export/i,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/lib/chatsune-import/knowledge-parse.test.ts`
Expected: FAIL — module unresolved.

- [ ] **Step 3: Implement the parser**

Create `apps/user-client/src/lib/chatsune-import/knowledge-parse.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import type { ChatsuneArchive } from './archive-reader.js';
import { SUPPORTED_VERSION } from './persona-parse.js';
import type { ChatsuneDocumentJson, ChatsuneLibraryJson } from './types.js';

export const IMPORT_FORMAT_KNOWLEDGE = 'chatsune/knowledge';

export interface ParsedKnowledgeExport {
  name: string;
  description: string;
  nsfw: boolean;
  documents: { title: string; content: string; triggerPhrases: string[] }[];
}

function decodeJson<T>(files: Map<string, Uint8Array>, name: string): T | undefined {
  const bytes = files.get(name);
  if (!bytes) return undefined;
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

/** Parse a chatsune knowledge export into a Chatsundere library + documents (spec §7). */
export function parseKnowledgeExport(archive: ChatsuneArchive): ParsedKnowledgeExport {
  if (archive.manifest.format !== IMPORT_FORMAT_KNOWLEDGE) {
    throw new Error('This is not a knowledge export — pick a Chatsune library file.');
  }
  if (archive.manifest.version > SUPPORTED_VERSION) {
    throw new Error('This export is from a newer version of Chatsune than this importer understands.');
  }
  const lib = decodeJson<ChatsuneLibraryJson>(archive.files, 'library.json');
  if (!lib) throw new Error('This knowledge export is incomplete (no library data).');
  const docs = decodeJson<ChatsuneDocumentJson[]>(archive.files, 'documents.json') ?? [];

  return {
    name: lib.name,
    description: lib.description ?? '',
    nsfw: !!lib.nsfw,
    documents: docs.map((d) => ({
      title: d.title,
      content: d.content,
      triggerPhrases: Array.isArray(d.trigger_phrases) ? d.trigger_phrases : [],
    })),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run tests/lib/chatsune-import/knowledge-parse.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck, lint, commit**

Run: `pnpm typecheck --force` and `cd apps/user-client && pnpm biome check src/lib/chatsune-import tests/lib/chatsune-import`

```bash
git add apps/user-client/src/lib/chatsune-import/knowledge-parse.ts apps/user-client/tests/lib/chatsune-import/knowledge-parse.test.ts
git commit -m "Add chatsune knowledge export parser

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 7: Schema — add `importedFrom` to `ChatRow` (no version bump)

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts` (the `ChatRow` interface, lines 180-196)
- Test: `apps/user-client/tests/boot/chat-imported-from.test.ts`

**Interfaces:**
- Produces: `ChatRow.importedFrom?: string | null`.

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/boot/chat-imported-from.test.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

describe('ChatRow.importedFrom', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('round-trips a chat with importedFrom and queries by personaId', async () => {
    const db = getClientDataDb();
    await db.chats.add({
      id: 'c1',
      personaId: 'p1',
      title: null,
      resolvedMindspaceId: 'm1',
      createdAt: 1,
      lastMessageAt: 1,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
      importedFrom: 'chatsune-session-42',
    });
    const rows = await db.chats.where('personaId').equals('p1').toArray();
    expect(rows[0]?.importedFrom).toBe('chatsune-session-42');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/boot/chat-imported-from.test.ts`
Expected: FAIL — TypeScript error: `importedFrom` not in `ChatRow`.

- [ ] **Step 3: Add the field**

In `apps/user-client/src/boot/client-data-db.ts`, modify the `ChatRow` interface. After the `openerPending?: boolean;` line (line 195), add:

```typescript
  /** chatsune session `original_id` when this chat was imported from a Chatsune
   *  persona export; absent for natively-created chats. Non-indexed (schemaless,
   *  like `bookmarkLabel`/`kind`) — dedup loads a persona's chats via the
   *  `personaId` index and builds the seen-set in memory, so no Dexie version
   *  bump is needed. */
  importedFrom?: string | null;
```

(No `.version(27)` block — this is a non-indexed schemaless field.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run tests/boot/chat-imported-from.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `pnpm typecheck --force` and `cd apps/user-client && pnpm biome check src/boot/client-data-db.ts tests/boot/chat-imported-from.test.ts`

```bash
git add apps/user-client/src/boot/client-data-db.ts apps/user-client/tests/boot/chat-imported-from.test.ts
git commit -m "Add non-indexed ChatRow.importedFrom for chatsune-import dedup

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 8: Data writers — session merge + library import

**Files:**
- Create: `apps/user-client/src/data/chatsune-import.ts`
- Test: `apps/user-client/tests/data/chatsune-import.test.ts`

**Interfaces:**
- Consumes: `getClientDataDb` (`boot/client-data-db.js`), `mapChatsuneMessage` (Task 4), `ChatsuneSessionExport` (Task 1), `ParsedKnowledgeExport` (Task 6), `createLibrary` (`data/knowledge.js`), `enqueueDocument` (`knowledge/start-ingestion.js`), `normalisePhrases` (`lib/treasury-filter.js`), `uuidv7`.
- Produces:
  - `previewChatsuneSessions(personaId: string | null, sessions: ChatsuneSessionExport[]): Promise<{ newCount: number; skippedCount: number }>`
  - `importChatsuneSessions(personaId: string, sessions: ChatsuneSessionExport[]): Promise<{ imported: number; skipped: number }>`
  - `importChatsuneLibrary(parsed: ParsedKnowledgeExport): Promise<string>`

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/data/chatsune-import.test.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const enqueueSpy = vi.fn();
vi.mock('../../src/knowledge/start-ingestion.js', () => ({
  enqueueDocument: (id: string) => enqueueSpy(id),
}));

import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import {
  importChatsuneLibrary,
  importChatsuneSessions,
  previewChatsuneSessions,
} from '../../src/data/chatsune-import.js';

const SESSIONS = [
  {
    original_id: 's1',
    session_fields: { title: 'First', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' },
    messages: [
      { role: 'user' as const, content: 'hi', created_at: '2026-01-01T00:00:00Z' },
      { role: 'assistant' as const, content: 'hello', thinking: 'think', created_at: '2026-01-01T00:01:00Z' },
      { role: 'tool' as const, content: 'tool-result' },
    ],
  },
  {
    original_id: 's2',
    session_fields: { title: 'Second', deleted_at: '2026-01-03T00:00:00Z' },
    messages: [{ role: 'user' as const, content: 'gone' }],
  },
];

async function seedPersona(): Promise<void> {
  const db = getClientDataDb();
  const settings = await db.settings.get(1);
  await db.personas.add({
    id: 'p1',
    name: 'Fable',
    tagline: '',
    colour: '#fff',
    font: 'serif',
    instructions: '',
    canonicalId: 'c',
    providerId: 'pr',
    modelId: 'm',
    mindspaceId: settings?.defaultMindspaceId ?? null,
    aboutMeOverride: null,
    textureOverride: null,
    temperature: 0.85,
    adultPersona: false,
    chatsundereTonality: true,
    contextWindow: null,
    libraryIds: [],
    askExpertDefault: false,
    mcpOverrides: {},
    roleplay: false,
    narration: 'first',
    greetingEnabled: false,
    greetingInstructions: '',
    voice: null,
    narratorVoice: null,
    createdAt: 1,
    updatedAt: 1,
  });
}

describe('importChatsuneSessions', () => {
  beforeEach(async () => {
    enqueueSpy.mockClear();
    await _resetClientDataDbForTests();
    await openClientDataDb();
    await seedPersona();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('imports non-deleted sessions, maps Tier A messages, and skips tool messages', async () => {
    const res = await importChatsuneSessions('p1', SESSIONS);
    expect(res).toEqual({ imported: 1, skipped: 0 }); // s2 is deleted → not imported

    const db = getClientDataDb();
    const chats = await db.chats.where('personaId').equals('p1').toArray();
    expect(chats).toHaveLength(1);
    expect(chats[0]?.importedFrom).toBe('s1');
    expect(chats[0]?.title).toBe('First');
    expect(chats[0]?.createdAt).toBe(Date.parse('2026-01-01T00:00:00Z'));

    const msgs = await db.messages.where('chatId').equals(chats[0]!.id).sortBy('createdAt');
    expect(msgs).toHaveLength(2); // tool message skipped
    expect(msgs[0]?.role).toBe('user');
    expect(msgs[1]?.role).toBe('persona');
    expect(msgs[1]?.contentBlocks).toContainEqual({ type: 'reasoning', text: 'think' });
  });

  it('is idempotent: a second import of the same sessions skips them', async () => {
    await importChatsuneSessions('p1', SESSIONS);
    const res = await importChatsuneSessions('p1', SESSIONS);
    expect(res).toEqual({ imported: 0, skipped: 1 });
    const chats = await getClientDataDb().chats.where('personaId').equals('p1').toArray();
    expect(chats).toHaveLength(1);
  });
});

describe('previewChatsuneSessions', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
    await seedPersona();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('returns all sessions as new for a null persona (create mode)', async () => {
    expect(await previewChatsuneSessions(null, SESSIONS)).toEqual({ newCount: 1, skippedCount: 0 });
  });

  it('reports already-imported sessions after one import', async () => {
    await importChatsuneSessions('p1', SESSIONS);
    expect(await previewChatsuneSessions('p1', SESSIONS)).toEqual({ newCount: 0, skippedCount: 1 });
  });
});

describe('importChatsuneLibrary', () => {
  beforeEach(async () => {
    enqueueSpy.mockClear();
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('creates a library and pending documents, enqueueing each for embedding', async () => {
    const libId = await importChatsuneLibrary({
      name: 'Biology',
      description: 'core',
      nsfw: false,
      documents: [
        { title: 'Photosynthesis', content: '# P', triggerPhrases: ['calvin'] },
        { title: 'Empty', content: '   ', triggerPhrases: [] },
      ],
    });
    const db = getClientDataDb();
    const lib = await db.libraries.get(libId);
    expect(lib?.name).toBe('Biology');
    const docs = await db.documents.where('libraryId').equals(libId).toArray();
    expect(docs).toHaveLength(1); // empty-content doc skipped
    expect(docs[0]?.embeddingStatus).toBe('pending');
    expect(docs[0]?.triggerPhrases).toEqual(['calvin']);
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
  });

  it('always creates a new library on re-import (no dedup)', async () => {
    const parsed = { name: 'Dup', description: '', nsfw: false, documents: [] };
    const a = await importChatsuneLibrary(parsed);
    const b = await importChatsuneLibrary(parsed);
    expect(a).not.toBe(b);
    expect(await getClientDataDb().libraries.where('name').equals('Dup').count()).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/data/chatsune-import.test.ts`
Expected: FAIL — module unresolved.

- [ ] **Step 3: Implement the writers**

Create `apps/user-client/src/data/chatsune-import.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { uuidv7 } from 'uuidv7';
import { type DocumentRow, getClientDataDb } from '../boot/client-data-db.js';
import type { ChatsuneSessionExport } from '../lib/chatsune-import/types.js';
import { mapChatsuneMessage } from '../lib/chatsune-import/message-map.js';
import type { ParsedKnowledgeExport } from '../lib/chatsune-import/knowledge-parse.js';
import { enqueueDocument } from '../knowledge/start-ingestion.js';
import { normalisePhrases } from '../lib/treasury-filter.js';
import { createLibrary } from './knowledge.js';

function isoToMs(s: string | undefined, fallback: number): number {
  const v = s ? Date.parse(s) : Number.NaN;
  return Number.isFinite(v) ? v : fallback;
}

/** Sessions that will actually import (non-deleted). */
function importableSessions(sessions: ChatsuneSessionExport[]): ChatsuneSessionExport[] {
  return sessions.filter((s) => !s.session_fields.deleted_at);
}

/**
 * Preview how many sessions would import vs. be skipped as already-imported.
 * `personaId` null = create mode (nothing exists yet → all new).
 */
export async function previewChatsuneSessions(
  personaId: string | null,
  sessions: ChatsuneSessionExport[],
): Promise<{ newCount: number; skippedCount: number }> {
  const importable = importableSessions(sessions);
  if (!personaId) return { newCount: importable.length, skippedCount: 0 };
  const existing = await getClientDataDb().chats.where('personaId').equals(personaId).toArray();
  const seen = new Set(existing.map((c) => c.importedFrom).filter((v): v is string => !!v));
  let newCount = 0;
  let skippedCount = 0;
  for (const s of importable) (seen.has(s.original_id) ? skippedCount++ : newCount++);
  return { newCount, skippedCount };
}

/**
 * Merge chatsune sessions into a persona's chats (spec §6). Additive, idempotent
 * per persona (dedup by `original_id`), Tier A messages, tool messages skipped,
 * deleted sessions skipped. One Dexie transaction.
 */
export async function importChatsuneSessions(
  personaId: string,
  sessions: ChatsuneSessionExport[],
): Promise<{ imported: number; skipped: number }> {
  const db = getClientDataDb();
  const persona = await db.personas.get(personaId);
  if (!persona) throw new Error(`importChatsuneSessions: persona ${personaId} not found`);
  const settings = await db.settings.get(1);
  const resolvedMindspaceId = persona.mindspaceId ?? settings?.defaultMindspaceId;
  if (!resolvedMindspaceId) throw new Error('importChatsuneSessions: no mindspace to snapshot');

  const now = Date.now();
  let imported = 0;
  let skipped = 0;

  await db.transaction('rw', db.chats, db.messages, async () => {
    const existing = await db.chats.where('personaId').equals(personaId).toArray();
    const seen = new Set(existing.map((c) => c.importedFrom).filter((v): v is string => !!v));

    for (const session of importableSessions(sessions)) {
      if (seen.has(session.original_id)) {
        skipped++;
        continue;
      }
      seen.add(session.original_id);
      const chatId = uuidv7();
      const createdAt = isoToMs(session.session_fields.created_at, now);
      await db.chats.add({
        id: chatId,
        personaId,
        title: session.session_fields.title ?? null,
        resolvedMindspaceId,
        createdAt,
        lastMessageAt: isoToMs(session.session_fields.updated_at, createdAt),
        bookmarkedMessageCount: 0,
        draftInput: '',
        libraryIds: [],
        importedFrom: session.original_id,
      });

      let index = 0;
      for (const m of session.messages) {
        const mapped = mapChatsuneMessage(m, createdAt + index);
        index++;
        if (!mapped) continue;
        await db.messages.add({
          id: uuidv7(),
          chatId,
          role: mapped.role,
          contentBlocks: mapped.contentBlocks,
          createdAt: mapped.createdAt,
          bookmarked: false,
          streamingState: 'complete',
        });
      }
      imported++;
    }
  });

  return { imported, skipped };
}

/**
 * Import a parsed chatsune knowledge export as a NEW library (spec §7 — no dedup,
 * the export carries no stable ids). Non-empty documents land `pending` and are
 * enqueued for local re-embedding.
 */
export async function importChatsuneLibrary(parsed: ParsedKnowledgeExport): Promise<string> {
  const library = await createLibrary({
    name: parsed.name,
    description: parsed.description,
    nsfw: parsed.nsfw,
  });
  const now = Date.now();
  const rows: DocumentRow[] = [];
  for (const d of parsed.documents) {
    if (d.content.trim().length === 0) continue;
    rows.push({
      id: uuidv7(),
      libraryId: library.id,
      title: d.title.trim() || 'Untitled',
      content: d.content,
      embeddingStatus: 'pending',
      embeddingError: null,
      chunkCount: 0,
      triggerPhrases: normalisePhrases(d.triggerPhrases),
      createdAt: now,
      updatedAt: now,
    });
  }
  if (rows.length > 0) {
    await getClientDataDb().documents.bulkAdd(rows);
    for (const row of rows) enqueueDocument(row.id);
  }
  return library.id;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run tests/data/chatsune-import.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Typecheck, lint, commit**

Run: `pnpm typecheck --force` and `cd apps/user-client && pnpm biome check src/data/chatsune-import.ts tests/data/chatsune-import.test.ts`

```bash
git add apps/user-client/src/data/chatsune-import.ts apps/user-client/tests/data/chatsune-import.test.ts
git commit -m "Add chatsune-import data writers (session merge + library import)

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 9: Persona import control component

**Files:**
- Create: `apps/user-client/src/components/persona-editor/ChatsuneImportControl.tsx`
- Test: `apps/user-client/tests/component/chatsune-import-control.test.tsx`

**Interfaces:**
- Consumes: `readChatsuneArchive` (Task 1), `parsePersonaExport` + `ParsedPersonaExport` (Task 5), `previewChatsuneSessions` (Task 8).
- Produces:
  - `AppliedPersonaImport { persona: ParsedPersonaExport['persona']; avatar: ParsedPersonaExport['avatar']; sessions: ParsedPersonaExport['sessions']; overwriteConfig: boolean }`
  - `ChatsuneImportControl({ mode, personaId, onApply }: { mode: 'create' | 'edit'; personaId: string | null; onApply: (a: AppliedPersonaImport) => void }): JSX.Element`

The component renders a button, picks a `.tar.gz`, parses + previews, shows a panel (chat counts, NSFW, memory note, edit-mode overwrite checkbox), and calls `onApply` on confirm. The editor (Task 10) owns avatar normalisation and the post-save session write.

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/component/chatsune-import-control.test.tsx`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const parseMock = vi.fn();
const readMock = vi.fn();
const previewMock = vi.fn();

vi.mock('../../src/lib/chatsune-import/archive-reader.js', () => ({
  readChatsuneArchive: (...a: unknown[]) => readMock(...a),
}));
vi.mock('../../src/lib/chatsune-import/persona-parse.js', () => ({
  parsePersonaExport: (...a: unknown[]) => parseMock(...a),
}));
vi.mock('../../src/data/chatsune-import.js', () => ({
  previewChatsuneSessions: (...a: unknown[]) => previewMock(...a),
}));

import { ChatsuneImportControl } from '../../src/components/persona-editor/ChatsuneImportControl.js';

function pickFile() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([new Uint8Array([1])], 'export.tar.gz', { type: 'application/gzip' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

describe('ChatsuneImportControl', () => {
  afterEach(() => {
    parseMock.mockReset();
    readMock.mockReset();
    previewMock.mockReset();
  });

  it('parses a picked file, previews counts, and applies on confirm', async () => {
    readMock.mockResolvedValue({ manifest: {}, files: new Map() });
    parseMock.mockReturnValue({
      persona: { name: 'Fable', tagline: 't', instructions: 'i', nsfw: true },
      avatar: null,
      sessions: [{ original_id: 's1', session_fields: {}, messages: [] }],
      memoryCount: 3,
    });
    previewMock.mockResolvedValue({ newCount: 1, skippedCount: 0 });
    const onApply = vi.fn();

    render(<ChatsuneImportControl mode="create" personaId={null} onApply={onApply} />);
    pickFile();

    await waitFor(() => expect(screen.getByText(/Fable/)).toBeInTheDocument());
    expect(screen.getByText(/1 new/)).toBeInTheDocument();
    expect(screen.getByText(/3 memories/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /apply import/i }));
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        persona: expect.objectContaining({ name: 'Fable' }),
        overwriteConfig: true, // create mode → always apply fields
      }),
    );
  });

  it('surfaces a parse error', async () => {
    readMock.mockRejectedValue(new Error('Could not read this file — is it a Chatsune export?'));
    render(<ChatsuneImportControl mode="create" personaId={null} onApply={vi.fn()} />);
    pickFile();
    await waitFor(() =>
      expect(screen.getByText(/could not read this file/i)).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/component/chatsune-import-control.test.tsx`
Expected: FAIL — component unresolved.

- [ ] **Step 3: Implement the control**

Create `apps/user-client/src/components/persona-editor/ChatsuneImportControl.tsx`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { useRef, useState } from 'react';
import { previewChatsuneSessions } from '../../data/chatsune-import.js';
import { readChatsuneArchive } from '../../lib/chatsune-import/archive-reader.js';
import { type ParsedPersonaExport, parsePersonaExport } from '../../lib/chatsune-import/persona-parse.js';

export interface AppliedPersonaImport {
  persona: ParsedPersonaExport['persona'];
  avatar: ParsedPersonaExport['avatar'];
  sessions: ParsedPersonaExport['sessions'];
  /** Whether to overwrite name/tagline/instructions. Always true in create mode. */
  overwriteConfig: boolean;
}

interface Preview {
  parsed: ParsedPersonaExport;
  newCount: number;
  skippedCount: number;
}

/**
 * "Import from Chatsune" control for the persona editor. Parses a persona
 * export, previews the chat counts + memory note, and hands the result to the
 * editor via `onApply`. The editor owns avatar normalisation and the post-save
 * chat write (spec §5.1).
 */
export function ChatsuneImportControl({
  mode,
  personaId,
  onApply,
}: {
  mode: 'create' | 'edit';
  personaId: string | null;
  onApply: (a: AppliedPersonaImport) => void;
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState(false);

  async function onPick(file: File): Promise<void> {
    setError(null);
    setPreview(null);
    try {
      const archive = await readChatsuneArchive(file);
      const parsed = parsePersonaExport(archive);
      const counts = await previewChatsuneSessions(personaId, parsed.sessions);
      setPreview({ parsed, newCount: counts.newCount, skippedCount: counts.skippedCount });
      setOverwrite(mode === 'create');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function apply(): void {
    if (!preview) return;
    onApply({
      persona: preview.parsed.persona,
      avatar: preview.parsed.avatar,
      sessions: preview.parsed.sessions,
      overwriteConfig: mode === 'create' ? true : overwrite,
    });
    setPreview(null);
  }

  return (
    <div className="mb-3">
      <input
        ref={inputRef}
        type="file"
        accept=".gz,.tgz,application/gzip"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onPick(f);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="rounded-md border border-paper-soft/30 px-3 py-1 text-xs uppercase tracking-wider text-paper-soft hover:text-paper"
      >
        Import from Chatsune
      </button>

      {error ? <p className="mt-2 text-[11px] text-amber-300/80">{error}</p> : null}

      {preview ? (
        <div className="mt-2 rounded-md border border-paper-soft/20 bg-white/[0.02] p-3 text-[11px] text-paper-soft">
          <div className="text-sm text-paper">{preview.parsed.persona.name}</div>
          <p className="mt-1">
            {preview.newCount} new
            {preview.skippedCount > 0 ? `, ${preview.skippedCount} already imported (skipped)` : ''}
            {preview.newCount === 1 ? ' chat' : ' chats'}
            {preview.parsed.persona.nsfw ? ' · NSFW' : ''}
          </p>
          {preview.parsed.memoryCount > 0 ? (
            <p className="mt-1">
              This export contains {preview.parsed.memoryCount}{' '}
              {preview.parsed.memoryCount === 1 ? 'memory' : 'memories'}. Memory import arrives in a
              future update — re-import this file then to bring them across.
            </p>
          ) : null}
          {mode === 'edit' ? (
            <label className="mt-2 flex items-center gap-2 text-paper">
              <input
                type="checkbox"
                checked={overwrite}
                onChange={(e) => setOverwrite(e.target.checked)}
              />
              Overwrite persona configuration (name, tagline, instructions) with imported values
            </label>
          ) : null}
          <button
            type="button"
            onClick={apply}
            className="mt-2 rounded-md border border-paper px-3 py-1 text-xs uppercase tracking-wider text-paper hover:bg-paper/10"
          >
            Apply import
          </button>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run tests/component/chatsune-import-control.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck, lint, commit**

Run: `pnpm typecheck --force` and `cd apps/user-client && pnpm biome check src/components/persona-editor/ChatsuneImportControl.tsx tests/component/chatsune-import-control.test.tsx`

```bash
git add apps/user-client/src/components/persona-editor/ChatsuneImportControl.tsx apps/user-client/tests/component/chatsune-import-control.test.tsx
git commit -m "Add ChatsuneImportControl for the persona editor

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 10: Wire the import control into the persona editor

**Files:**
- Modify: `apps/user-client/src/routes/app/persona-editor.tsx`

**Interfaces:**
- Consumes: `ChatsuneImportControl` + `AppliedPersonaImport` (Task 9), `importChatsuneSessions` (Task 8), `resolveImportedNsfw` (Task 3), `normaliseAvatar` (existing), `toastStore` (existing).

This task has no isolated unit test (the editor is an integration surface; its logic is covered by the Task 9 control test, the Task 8 writer test, and the Task 3 NSFW test). Verify by typecheck + the manual steps in Task 13. Keep the diff minimal and surgical.

- [ ] **Step 1: Add imports**

In `apps/user-client/src/routes/app/persona-editor.tsx`, add to the import block (after line 39, the `normaliseAvatar` import):

```typescript
import { importChatsuneSessions } from '../../data/chatsune-import.js';
import {
  type AppliedPersonaImport,
  ChatsuneImportControl,
} from '../../components/persona-editor/ChatsuneImportControl.js';
import { resolveImportedNsfw } from '../../lib/chatsune-import/nsfw.js';
```

- [ ] **Step 2: Add import state + apply handler**

Inside `PersonaEditor`, after the `pendingAvatar` state declaration (line 272), add:

```typescript
  // Sessions parsed from a Chatsune import, written after the persona (and its
  // id) exist — on Save. Cleared once written.
  const [importedSessions, setImportedSessions] = useState<AppliedPersonaImport['sessions']>([]);

  async function applyImportedAvatar(avatar: NonNullable<AppliedPersonaImport['avatar']>) {
    // Re-normalise the chatsune avatar bytes through our pipeline (→ WebP <=512);
    // the crop is already converted to our fractional model.
    const file = new File([avatar.bytes as BlobPart], 'avatar', { type: avatar.mime });
    const n = await normaliseAvatar(file);
    setPendingAvatar({ blob: n.blob, mime: n.mime, width: n.width, height: n.height, crop: avatar.crop });
  }

  function onApplyImport(a: AppliedPersonaImport) {
    setIsDirty(true);
    // NSFW only ever upgrades, independent of the overwrite choice (spec §5.3).
    patch({ adultPersona: resolveImportedNsfw(draft.adultPersona, a.persona.nsfw) });
    if (a.overwriteConfig) {
      patch({
        name: a.persona.name,
        tagline: a.persona.tagline,
        instructions: a.persona.instructions,
      });
    }
    if (a.avatar) void applyImportedAvatar(a.avatar);
    setImportedSessions(a.sessions);
  }
```

- [ ] **Step 3: Write imported sessions on save**

In `persistDraft` (lines 330-347), after the avatar block and before `setIsDirty(false)`, add:

```typescript
    if (pid && importedSessions.length > 0) {
      const res = await importChatsuneSessions(pid, importedSessions);
      setImportedSessions([]);
      toastStore.show({
        message:
          res.imported > 0
            ? `Imported ${res.imported} ${res.imported === 1 ? 'chat' : 'chats'}${
                res.skipped > 0 ? ` (${res.skipped} already imported)` : ''
              }.`
            : 'No new chats to import.',
        tone: 'info',
        durationMs: 3500,
      });
    }
```

- [ ] **Step 4: Render the control in the Identity section**

In the Identity `<section>`, immediately after the `Avatar` label `<div>` (line 465) and before `<AvatarField ...>`, add:

```typescript
        <ChatsuneImportControl
          mode={isCreate ? 'create' : 'edit'}
          personaId={isCreate ? null : (id ?? null)}
          onApply={onApplyImport}
        />
```

- [ ] **Step 5: Verify the toast tone exists**

Run: `cd apps/user-client && rg "tone: 'info'" src/state/toast.store.ts src/components` — confirm `'info'` is a valid `tone`. If the store only accepts `'warn' | 'success' | 'error'`, use the nearest existing tone (e.g. `'success'`) instead. Adjust the `tone` in Step 3 accordingly.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `pnpm typecheck --force` and `cd apps/user-client && pnpm biome check src/routes/app/persona-editor.tsx`
Expected: clean. Also run `cd apps/user-client && pnpm vitest run tests/component` to confirm no editor-adjacent regressions.

```bash
git add apps/user-client/src/routes/app/persona-editor.tsx
git commit -m "Wire Chatsune import into the persona editor

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 11: Knowledge import in the Libraries view

**Files:**
- Modify: `apps/user-client/src/routes/app/knowledge.tsx`
- Create: `apps/user-client/src/components/knowledge/ChatsuneLibraryImport.tsx`
- Test: `apps/user-client/tests/component/chatsune-library-import.test.tsx`

**Interfaces:**
- Consumes: `readChatsuneArchive` (Task 1), `parseKnowledgeExport` (Task 6), `importChatsuneLibrary` (Task 8), `QK` (`data/queryKeys.js`), `useQueryClient`, `toastStore`.
- Produces: `ChatsuneLibraryImport(): JSX.Element` (self-contained button + file pick + import + invalidation).

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/component/chatsune-library-import.test.tsx`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const readMock = vi.fn();
const parseMock = vi.fn();
const importMock = vi.fn();

vi.mock('../../src/lib/chatsune-import/archive-reader.js', () => ({
  readChatsuneArchive: (...a: unknown[]) => readMock(...a),
}));
vi.mock('../../src/lib/chatsune-import/knowledge-parse.js', () => ({
  parseKnowledgeExport: (...a: unknown[]) => parseMock(...a),
}));
vi.mock('../../src/data/chatsune-import.js', () => ({
  importChatsuneLibrary: (...a: unknown[]) => importMock(...a),
}));

import { ChatsuneLibraryImport } from '../../src/components/knowledge/ChatsuneLibraryImport.js';

function pickFile() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([new Uint8Array([1])], 'lib.tar.gz', { type: 'application/gzip' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

function wrap(node: React.ReactElement) {
  return <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>;
}

describe('ChatsuneLibraryImport', () => {
  afterEach(() => {
    readMock.mockReset();
    parseMock.mockReset();
    importMock.mockReset();
  });

  it('parses and imports a picked library file', async () => {
    readMock.mockResolvedValue({ manifest: {}, files: new Map() });
    parseMock.mockReturnValue({ name: 'Biology', description: '', nsfw: false, documents: [] });
    importMock.mockResolvedValue('lib-1');

    render(wrap(<ChatsuneLibraryImport />));
    pickFile();

    await waitFor(() => expect(importMock).toHaveBeenCalledTimes(1));
    expect(parseMock).toHaveBeenCalled();
  });

  it('surfaces a wrong-format error', async () => {
    readMock.mockResolvedValue({ manifest: {}, files: new Map() });
    parseMock.mockImplementation(() => {
      throw new Error('This is not a knowledge export — pick a Chatsune library file.');
    });
    render(wrap(<ChatsuneLibraryImport />));
    pickFile();
    await waitFor(() =>
      expect(screen.getByText(/not a knowledge export/i)).toBeInTheDocument(),
    );
    expect(importMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/component/chatsune-library-import.test.tsx`
Expected: FAIL — component unresolved.

- [ ] **Step 3: Implement the component**

Create `apps/user-client/src/components/knowledge/ChatsuneLibraryImport.tsx`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { importChatsuneLibrary } from '../../data/chatsune-import.js';
import { QK } from '../../data/queryKeys.js';
import { readChatsuneArchive } from '../../lib/chatsune-import/archive-reader.js';
import { parseKnowledgeExport } from '../../lib/chatsune-import/knowledge-parse.js';
import { toastStore } from '../../state/toast.store.js';

/** "Import from Chatsune" action for the Libraries view — always creates a new
 *  library (spec §7), then re-embeds its documents locally. */
export function ChatsuneLibraryImport(): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  async function onPick(file: File): Promise<void> {
    setError(null);
    try {
      const archive = await readChatsuneArchive(file);
      const parsed = parseKnowledgeExport(archive);
      await importChatsuneLibrary(parsed);
      await qc.invalidateQueries({ queryKey: QK.libraries });
      await qc.invalidateQueries({ queryKey: QK.documentCounts });
      toastStore.show({
        message: `Imported the “${parsed.name}” library — its documents are re-embedding now.`,
        tone: 'success',
        durationMs: 3500,
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept=".gz,.tgz,application/gzip"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onPick(f);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="rounded-md border border-paper-soft/30 px-3 py-1 text-xs uppercase tracking-wider text-paper-soft hover:text-paper"
      >
        Import from Chatsune
      </button>
      {error ? <p className="mt-2 text-[11px] text-amber-300/80">{error}</p> : null}
    </div>
  );
}
```

- [ ] **Step 4: Verify the toast tone**

Run: `cd apps/user-client && rg "tone:" src/components | head` — confirm `'success'` is a valid tone (used elsewhere). If not, swap for the nearest existing tone.

- [ ] **Step 5: Mount the component in the Libraries view**

In `apps/user-client/src/routes/app/knowledge.tsx`, add the import at the top:

```typescript
import { ChatsuneLibraryImport } from '../../components/knowledge/ChatsuneLibraryImport.js';
```

Then render `<ChatsuneLibraryImport />` near the existing "create library" affordance. Run `cd apps/user-client && rg -n "useCreateLibrary|New library|Add library|create" src/routes/app/knowledge.tsx` to find the header/action area, and place the control beside that button (read the surrounding JSX first; match its container styling).

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run tests/component/chatsune-library-import.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Typecheck, lint, commit**

Run: `pnpm typecheck --force` and `cd apps/user-client && pnpm biome check src/components/knowledge/ChatsuneLibraryImport.tsx src/routes/app/knowledge.tsx tests/component/chatsune-library-import.test.tsx`

```bash
git add apps/user-client/src/components/knowledge/ChatsuneLibraryImport.tsx apps/user-client/src/routes/app/knowledge.tsx apps/user-client/tests/component/chatsune-library-import.test.tsx
git commit -m "Add Chatsune knowledge-library import to the Libraries view

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 12: Future-feature-couplings register + STATUS cross-link

**Files:**
- Create: `obsidian/insights/future-feature-couplings.md`
- Modify: `obsidian/STATUS-CLIENT-ONLY.md` (the memory-gap line, line 3)

This task is documentation only — no test. It establishes the conspicuous reminder so the deferred memory import is not forgotten (spec §8.2, §8.3).

- [ ] **Step 1: Create the register**

Create `obsidian/insights/future-feature-couplings.md`:

```markdown
# Future-Feature Couplings

> "When you build **X**, you must also do **Y**." A deliberate register for
> cross-feature obligations that a future feature must honour — distinct from
> [[follow-ups-index]] (tech debt) and the STATUS files (current state).
> Add an entry whenever shipping feature A leaves a standing duty on
> not-yet-built feature B.

## Open couplings

### Memory system ⇒ extend the Chatsune importer with memory import

The Chatsune persona importer (`apps/user-client/src/lib/chatsune-import/`) lands
chats + persona core but **defers memories** — Chatsundere has no memory system
yet. The persona parser counts `memory.json` entries (`memoryCount`) and the
import control shows the user a "memories arrive in a future update — re-import
then" note (see the `FUTURE:` comment in `persona-parse.ts`).

**When the memory system is built, you must:** import `memory.json`
(`journal_entries[]` + `memory_bodies[]`) in the persona importer. The chat-merge
idempotency (`importedFrom` dedup) already makes re-import lossless — chats are
skipped, only memories flow in. Spec: `superpowers/specs/2026-06-18-chatsune-import-design.md` §8.
```

- [ ] **Step 2: Add the STATUS cross-link**

In `obsidian/STATUS-CLIENT-ONLY.md`, on the line that reads (line 3):

```
> Client-only work is **Blocks 1–5 → v0.1.0/v0.2.0**. Block 1 (chat core) ~80% shipped; **memory** (chatsune port) is the notable gap.
```

append a sentence pointing at the register:

```
> Client-only work is **Blocks 1–5 → v0.1.0/v0.2.0**. Block 1 (chat core) ~80% shipped; **memory** (chatsune port) is the notable gap. When memory lands, it must also extend the Chatsune importer to bring memories across — see [[insights/future-feature-couplings]].
```

- [ ] **Step 3: Commit (doc-only → `[skip ci]`)**

```bash
git add obsidian/insights/future-feature-couplings.md obsidian/STATUS-CLIENT-ONLY.md
git commit -m "Register the memory-import coupling for the Chatsune importer [skip ci]

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 13: Whole-feature verification

**Files:** none (verification only).

- [ ] **Step 1: Full typecheck**

Run: `pnpm typecheck --force` (repo root). Expected: 14/14 packages clean.

- [ ] **Step 2: Full user-client test suite**

Run: `cd apps/user-client && pnpm vitest run`
Expected: green except the known **8 Node-localStorage baseline** failures. A 9th failure is real — investigate before proceeding.

- [ ] **Step 3: Biome over the whole feature surface**

Run: `cd apps/user-client && pnpm biome check src/lib/chatsune-import src/data/chatsune-import.ts src/components/persona-editor/ChatsuneImportControl.tsx src/components/knowledge/ChatsuneLibraryImport.tsx src/routes/app/persona-editor.tsx src/routes/app/knowledge.tsx`
Expected: clean.

- [ ] **Step 4: Manual verification (Chris, on device — per spec §13)**

1. Export a real persona from chatsune → import into a **new** Chatsundere persona → pick a model → confirm name/tagline/instructions/NSFW, avatar framing, all chats present and continuable.
2. Create a persona, chat a little, import the same export → chats merge; the overwrite checkbox behaves; NSFW only upgrades.
3. Re-import the same file → preview reports "already imported"; nothing duplicates.
4. Import a chat that had images/tool-calls → per-message hint on the right messages; plain messages have none.
5. Import a CoT-bearing chat → reasoning blocks render.
6. Import a knowledge library → new library appears; documents re-embed and become searchable.
7. Import a persona export with memories → the "memories coming soon" note shows the right count.
8. Feed a corrupt / wrong-format / newer-version file → graceful rejection; DB untouched.

- [ ] **Step 5: Pre-squash UX audit (Laura)**

This feature adds user-reachable flows (two import entry points, a preview panel, the overwrite choice). Summon **Laura** for a pre-squash pass against the spec + built flow (CLAUDE.md §9.2). Fold soft findings as agreed with Chris; a hard defect blocks the squash.

(No Larissa pass: this is client-only and touches none of `apps/auth-service`, `apps/sync-service`, `apps/proxy-service`, `packages/crypto`.)

---

## Self-Review Notes

- **Spec coverage:** §3 source format → Task 1/5/6; §5 persona import (entry, mapping, NSFW, avatar, merge/overwrite, idempotency) → Tasks 2/3/5/8/9/10; §6 chat Tier A + hint + dedup → Tasks 3/4/8; §7 knowledge → Tasks 6/8/11; §8 memory deferral (tripwire + register + STATUS) → Tasks 5/9/12; §9 schema → Task 7; §11 error handling → Task 1/5/6 (+ surfaced in 9/11); §12 testing → every task; §13 manual verification → Task 13.
- **Type consistency:** `AppliedPersonaImport`, `ParsedPersonaExport`, `ParsedKnowledgeExport`, `MappedMessage`, `DroppedCounts`, `ChatsuneArchive` are defined once and consumed by name throughout.
- **Refinement vs spec:** §9 originally said "indexed + version bump"; Task 7 implements the planning refinement (non-indexed, no bump) and the spec §9 has been updated to match.
