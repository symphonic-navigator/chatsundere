# Unified Lightbox & User Attachments — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single unified lightbox plus the first user-attachment use case (uploading text and images), with client-side image normalisation, multimodal wire injection, and a global substitute-vision model.

**Architecture:** Attachments are first-class IndexedDB rows (a new `attachments` table) joined to a user message by `messageId` (null while pending, set on send). Pure logic modules (classify, normalise, vision-gate, wire-injection, substitute-vision) sit under `src/attachments/`; TanStack-Query hooks under `src/data/attachments.ts`; the presentation-only lightbox under `src/components/lightbox/`. The lightbox is fed a `ViewableItem[]` + index + per-item capability descriptor and knows nothing about storage, so the future artefact feature reuses it unchanged.

**Tech Stack:** TypeScript (strict), React 18, Dexie (IndexedDB), TanStack Query + Zustand, `@chatsundere/llm-unified` wire types, Vitest + `fake-indexeddb` + Testing Library, Tailwind v4 / `index.css`.

**Spec:** `superpowers/specs/2026-06-05-unified-lightbox-and-attachments-design.md`

**Larissa:** not required (client-only; no `auth-/sync-/proxy-service` or `crypto`). Log the new outbound surface in `obsidian/insights/security-deferrals.md` (Task 18).

**Conventions:** every new file under `apps/user-client/` starts with `// SPDX-License-Identifier: AGPL-3.0-only`. All UI strings and comments are **British English**. Tests: `import 'fake-indexeddb/auto'` at top, `_resetClientDataDbForTests({ keepData: false })` in `beforeEach`. Run a single test file with `pnpm --filter @chatsundere/user-client test -- <path>` (or the repo's `pnpm test` from the package). Commit after every green step.

---

## File Structure

**Create**
- `apps/user-client/src/attachments/file-classify.ts` — accept/reject + image|text classification.
- `apps/user-client/src/attachments/image-normalise.ts` — browser-canvas image normalisation.
- `apps/user-client/src/attachments/vision-gate.ts` — `canSendImages` precedence.
- `apps/user-client/src/attachments/wire-injection.ts` — pure: image disposition + build user `content`.
- `apps/user-client/src/attachments/substitute-vision.ts` — `ensureImageDescription` via one-shot, cached.
- `apps/user-client/src/data/attachments.ts` — Dexie-backed query/mutation hooks + low-level ops.
- `apps/user-client/src/components/lightbox/viewable-item.ts` — `ViewableItem`, `Caps`, `attachmentToViewable`.
- `apps/user-client/src/components/lightbox/Lightbox.tsx` — the unified lightbox.
- `apps/user-client/src/components/lightbox/LightboxTextBody.tsx` — Preview/Source toggle.
- `apps/user-client/src/components/chat/AttachmentThumb.tsx` — one thumbnail tile.
- `apps/user-client/src/components/chat/AttachmentStrip.tsx` — the thumbnail strip (cockpit + bubble).

**Modify**
- `apps/user-client/src/boot/client-data-db.ts` — `AttachmentRow`, table, v12, `SettingsRow.substituteVisionModel`.
- `apps/user-client/src/data/queryKeys.ts` — attachment query keys.
- `apps/user-client/src/lib/stream-engine.ts` — multimodal user `content` + per-message attachment map.
- `apps/user-client/src/state/stream-manager.store.ts` — set `messageId` on send; resolve + thread attachment content.
- `apps/user-client/src/components/chat/Cockpit.tsx` — `(+)` picker, paste, OS drop, strip, open lightbox.
- `apps/user-client/src/components/chat/MessageBlock.tsx` — attachment strip under a user message.
- `apps/user-client/src/routes/app/settings.tsx` — real substitute-vision picker.
- `apps/user-client/src/index.css` — lightbox, thumbnail, strip styles + zoom animation.

---

## Task 1: Data model — `AttachmentRow`, table, Dexie v12, settings field

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts`
- Test: `apps/user-client/tests/unit/attachments-schema.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/user-client/tests/unit/attachments-schema.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AttachmentRow,
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

beforeEach(async () => {
  await _resetClientDataDbForTests();
});

describe('attachments schema (Dexie v12)', () => {
  it('opens at verno 12 with an attachments table', async () => {
    const db = await openClientDataDb();
    expect(db.verno).toBe(12);
    expect(db.tables.map((t) => t.name)).toContain('attachments');
  });

  it('seeds substituteVisionModel = null on the settings row', async () => {
    const db = await openClientDataDb();
    const row = await db.settings.get(1);
    expect(row?.substituteVisionModel).toBeNull();
  });

  it('round-trips a pending image attachment and finds it by [chatId+messageId]', async () => {
    const db = await openClientDataDb();
    const att: AttachmentRow = {
      id: 'a1',
      chatId: 'c1',
      messageId: null,
      origin: 'upload',
      kind: 'image',
      fileName: 'screen.png',
      mime: 'image/jpeg',
      order: 0,
      state: 'active',
      createdAt: 1,
      blob: new Blob(['x'], { type: 'image/jpeg' }),
      width: 100,
      height: 80,
      visionDescription: null,
    };
    await db.attachments.add(att);
    const pending = await db.attachments.where('[chatId+messageId]').equals(['c1', null as never]).toArray();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.fileName).toBe('screen.png');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/attachments-schema.test.ts`
Expected: FAIL — verno is 11, no `attachments` table, `substituteVisionModel` undefined.

- [ ] **Step 3: Add the types** (after the `PillRow` interface block in `client-data-db.ts`):

```typescript
export type AttachmentKind = 'image' | 'text';
export type AttachmentOrigin = 'upload' | 'generated';
export type AttachmentState = 'active' | 'deleted';

export interface AttachmentRow {
  id: string;
  chatId: string;
  /** null while pending (local to the chat's compose state); set to the user message id on send. */
  messageId: string | null;
  origin: AttachmentOrigin;
  kind: AttachmentKind;
  /** User-editable; ALWAYS sent on the wire. */
  fileName: string;
  mime: string;
  order: number;
  state: AttachmentState;
  createdAt: number;
  /** kind === 'image' — the NORMALISED JPEG (see image-normalise.ts), the only stored copy. */
  blob?: Blob;
  /** kind === 'text' — editable via the lightbox Source view while pending. */
  text?: string;
  /** kind === 'image' — post-normalisation dimensions. */
  width?: number;
  height?: number;
  /** kind === 'image' — substitute-vision cache, keyed by the model that produced it. */
  visionDescription?: { model: string; text: string } | null;
}
```

- [ ] **Step 4: Add the table to `SettingsRow` and the class**

In `SettingsRow` (after `webInterfacing`):
```typescript
  /** Global substitute vision model — an offering ref "providerId:upstreamSlug"; null = none. */
  substituteVisionModel: string | null;
```

In `ClientDataDb` (after `personaAvatars!`):
```typescript
  attachments!: Table<AttachmentRow, string>;
```

- [ ] **Step 5: Add the v12 migration** (after the v11 `.version(11)...` block):

```typescript
db.version(12)
  .stores({
    attachments: 'id, chatId, messageId, [chatId+messageId]',
  })
  .upgrade(async (tx) => {
    await tx.table('settings').toCollection().modify((row: SettingsRow) => {
      if (row.substituteVisionModel === undefined) row.substituteVisionModel = null;
    });
  });
```

Also extend the **seed** (`seedBuiltinsIfNeeded` / wherever the settings singleton is first created) so a freshly-seeded settings row includes `substituteVisionModel: null`.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/attachments-schema.test.ts`
Expected: PASS (verno 12, table present, field null, round-trip works).

- [ ] **Step 7: Update the existing verno assertion**

In `apps/user-client/tests/unit/client-data-db.test.ts`, bump `expect(db.verno).toBe(11)` → `12`. Run that file; expect PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/user-client/src/boot/client-data-db.ts apps/user-client/tests/unit/attachments-schema.test.ts apps/user-client/tests/unit/client-data-db.test.ts
git commit -m "Add attachments table + substitute-vision setting (Dexie v12)"
```

---

## Task 2: Attachment data hooks + low-level ops

**Files:**
- Modify: `apps/user-client/src/data/queryKeys.ts`
- Create: `apps/user-client/src/data/attachments.ts`
- Test: `apps/user-client/tests/unit/attachments-data.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/user-client/tests/unit/attachments-data.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import {
  addAttachment,
  attachPendingToMessage,
  listMessageAttachments,
  listPendingAttachments,
  removeAttachment,
  renameAttachment,
  updateAttachmentText,
} from '../../src/data/attachments.js';

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
});

function imageInput(name: string) {
  return { chatId: 'c1', kind: 'image' as const, fileName: name, mime: 'image/jpeg', blob: new Blob(['x'], { type: 'image/jpeg' }), width: 10, height: 10 };
}

describe('attachment data ops', () => {
  it('adds pending attachments with incrementing order and lists them', async () => {
    await addAttachment(imageInput('a.png'));
    await addAttachment(imageInput('b.png'));
    const pending = await listPendingAttachments('c1');
    expect(pending.map((a) => a.fileName)).toEqual(['a.png', 'b.png']);
    expect(pending.map((a) => a.order)).toEqual([0, 1]);
    expect(pending.every((a) => a.messageId === null && a.state === 'active')).toBe(true);
  });

  it('removes a pending attachment', async () => {
    const id = await addAttachment(imageInput('a.png'));
    await removeAttachment(id);
    expect(await listPendingAttachments('c1')).toHaveLength(0);
  });

  it('renames and updates text', async () => {
    const id = await addAttachment({ chatId: 'c1', kind: 'text', fileName: 'n.md', mime: 'text/markdown', text: 'hello' });
    await renameAttachment(id, 'notes.md');
    await updateAttachmentText(id, 'world');
    const [row] = await listPendingAttachments('c1');
    expect(row?.fileName).toBe('notes.md');
    expect(row?.text).toBe('world');
  });

  it('attaches all pending to a message id and they leave the pending set', async () => {
    await addAttachment(imageInput('a.png'));
    await addAttachment(imageInput('b.png'));
    await attachPendingToMessage('c1', 'm1');
    expect(await listPendingAttachments('c1')).toHaveLength(0);
    expect((await listMessageAttachments('m1')).map((a) => a.fileName)).toEqual(['a.png', 'b.png']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/attachments-data.test.ts`
Expected: FAIL — module `data/attachments.js` not found.

- [ ] **Step 3: Add query keys**

In `apps/user-client/src/data/queryKeys.ts`, add to the `QK` object:
```typescript
  attachmentsPending: (chatId: string) => ['attachments', 'pending', chatId] as const,
  attachmentsForMessage: (messageId: string) => ['attachments', 'message', messageId] as const,
```

- [ ] **Step 4: Implement `data/attachments.ts`**

```typescript
// apps/user-client/src/data/attachments.ts
// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { uuidv7 } from 'uuidv7';
import { type AttachmentKind, type AttachmentRow, getClientDataDb } from '../boot/client-data-db.js';
import { QK } from './queryKeys.js';

export interface AddAttachmentInput {
  chatId: string;
  kind: AttachmentKind;
  fileName: string;
  mime: string;
  blob?: Blob;
  text?: string;
  width?: number;
  height?: number;
}

/** Lowest-level ops (no React) — used by hooks and by the send path. */
export async function addAttachment(input: AddAttachmentInput): Promise<string> {
  const db = getClientDataDb();
  const id = uuidv7();
  return db.transaction('rw', db.attachments, async () => {
    const order = await db.attachments.where('[chatId+messageId]').equals([input.chatId, null as never]).count();
    const row: AttachmentRow = {
      id,
      chatId: input.chatId,
      messageId: null,
      origin: 'upload',
      kind: input.kind,
      fileName: input.fileName,
      mime: input.mime,
      order,
      state: 'active',
      createdAt: Date.now(),
      blob: input.blob,
      text: input.text,
      width: input.width,
      height: input.height,
      visionDescription: null,
    };
    await db.attachments.add(row);
    return id;
  });
}

export async function removeAttachment(id: string): Promise<void> {
  await getClientDataDb().attachments.delete(id);
}

export async function renameAttachment(id: string, fileName: string): Promise<void> {
  await getClientDataDb().attachments.update(id, { fileName });
}

export async function updateAttachmentText(id: string, text: string): Promise<void> {
  await getClientDataDb().attachments.update(id, { text });
}

export async function listPendingAttachments(chatId: string): Promise<AttachmentRow[]> {
  const rows = await getClientDataDb().attachments.where('[chatId+messageId]').equals([chatId, null as never]).toArray();
  return rows.sort((a, b) => a.order - b.order);
}

export async function listMessageAttachments(messageId: string): Promise<AttachmentRow[]> {
  const rows = await getClientDataDb().attachments.where('messageId').equals(messageId).toArray();
  return rows.sort((a, b) => a.order - b.order);
}

export async function attachPendingToMessage(chatId: string, messageId: string): Promise<void> {
  const db = getClientDataDb();
  await db.transaction('rw', db.attachments, async () => {
    const pending = await db.attachments.where('[chatId+messageId]').equals([chatId, null as never]).toArray();
    await Promise.all(pending.map((a) => db.attachments.update(a.id, { messageId })));
  });
}

// ---- React hooks ----

export function usePendingAttachments(chatId: string) {
  return useQuery({ queryKey: QK.attachmentsPending(chatId), queryFn: () => listPendingAttachments(chatId) });
}

export function useMessageAttachments(messageId: string) {
  return useQuery({ queryKey: QK.attachmentsForMessage(messageId), queryFn: () => listMessageAttachments(messageId) });
}

export function useAddAttachment(chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddAttachmentInput) => addAttachment(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.attachmentsPending(chatId) }),
  });
}

export function useRemoveAttachment(chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => removeAttachment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.attachmentsPending(chatId) }),
  });
}

export function useRenameAttachment(chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, fileName }: { id: string; fileName: string }) => renameAttachment(id, fileName),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.attachmentsPending(chatId) }),
  });
}

export function useUpdateAttachmentText(chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => updateAttachmentText(id, text),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.attachmentsPending(chatId) }),
  });
}
```

> Note: `addAttachment` uses `Date.now()`. If the codebase forbids `Date.now()` in app code (it does not — only workflow scripts do), keep it; this runs in the browser.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/attachments-data.test.ts`
Expected: PASS (4 tests green).

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/data/attachments.ts apps/user-client/src/data/queryKeys.ts apps/user-client/tests/unit/attachments-data.test.ts
git commit -m "Add attachment data ops + query hooks"
```

---

## Task 3: File classification (accept/reject + kind)

**Files:**
- Create: `apps/user-client/src/attachments/file-classify.ts`
- Test: `apps/user-client/tests/unit/file-classify.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/user-client/tests/unit/file-classify.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { classifyFile } from '../../src/attachments/file-classify.js';

function file(name: string, type: string, size = 100): File {
  const blob = new Blob([new Uint8Array(size)], { type });
  return new File([blob], name, { type });
}

describe('classifyFile', () => {
  it('accepts supported images as kind image', () => {
    expect(classifyFile(file('a.png', 'image/png'))).toEqual({ ok: true, kind: 'image' });
    expect(classifyFile(file('a.webp', 'image/webp'))).toEqual({ ok: true, kind: 'image' });
  });

  it('accepts text/markdown/code as kind text (by mime or extension)', () => {
    expect(classifyFile(file('n.md', 'text/markdown'))).toEqual({ ok: true, kind: 'text' });
    expect(classifyFile(file('s.ts', ''))).toEqual({ ok: true, kind: 'text' });
    expect(classifyFile(file('p.txt', 'text/plain'))).toEqual({ ok: true, kind: 'text' });
  });

  it('rejects unsupported types with a reason', () => {
    const r = classifyFile(file('d.pdf', 'application/pdf'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/PDF|not supported|images and text/i);
  });

  it('rejects oversize files', () => {
    expect(classifyFile(file('big.png', 'image/png', 11 * 1024 * 1024)).ok).toBe(false);
    expect(classifyFile(file('big.txt', 'text/plain', 2 * 1024 * 1024)).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/file-classify.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// apps/user-client/src/attachments/file-classify.ts
// SPDX-License-Identifier: AGPL-3.0-only

/** Raw-input caps, validated at the boundary (the stored/sent image is far smaller — see image-normalise.ts). */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_BYTES = 1 * 1024 * 1024;

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const TEXT_MIME_PREFIX = 'text/';
const EXTRA_TEXT_MIMES = new Set(['application/json', 'application/javascript', 'application/xml']);
const TEXT_EXTENSIONS = new Set([
  'md', 'txt', 'json', 'csv', 'ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'h',
  'cpp', 'cs', 'rb', 'php', 'sh', 'yaml', 'yml', 'toml', 'ini', 'html', 'css', 'xml', 'sql', 'log',
]);

export type Classification =
  | { ok: true; kind: 'image' | 'text' }
  | { ok: false; reason: string };

function extension(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** Decide whether a picked/pasted/dropped file is an acceptable attachment, and its kind. */
export function classifyFile(file: File): Classification {
  if (IMAGE_MIMES.has(file.type)) {
    if (file.size > MAX_IMAGE_BYTES) return { ok: false, reason: `${file.name} is too large (images up to 10 MB).` };
    return { ok: true, kind: 'image' };
  }
  const isText =
    file.type.startsWith(TEXT_MIME_PREFIX) ||
    EXTRA_TEXT_MIMES.has(file.type) ||
    (file.type === '' && TEXT_EXTENSIONS.has(extension(file.name))) ||
    TEXT_EXTENSIONS.has(extension(file.name));
  if (isText) {
    if (file.size > MAX_TEXT_BYTES) return { ok: false, reason: `${file.name} is too large (text files up to 1 MB).` };
    return { ok: true, kind: 'text' };
  }
  return { ok: false, reason: `${file.name} is not supported yet — only images and text files for now.` };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/file-classify.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/attachments/file-classify.ts apps/user-client/tests/unit/file-classify.test.ts
git commit -m "Add attachment file classification + size caps"
```

---

## Task 4: Client-side image normalisation

**Files:**
- Create: `apps/user-client/src/attachments/image-normalise.ts`
- Test: `apps/user-client/tests/unit/image-normalise.test.ts`

> `jsdom` lacks a real canvas. We make the canvas/bitmap dependencies **injectable** so the pure resize maths is unit-tested deterministically, and the real browser path is exercised in manual verification (spec §15 step 10).

- [ ] **Step 1: Write the failing test**

```typescript
// apps/user-client/tests/unit/image-normalise.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { MAX_EDGE, targetSize } from '../../src/attachments/image-normalise.js';

describe('targetSize', () => {
  it('does not upscale a small image', () => {
    expect(targetSize(600, 400)).toEqual({ width: 600, height: 400, resized: false });
  });

  it('scales the longest edge to MAX_EDGE preserving aspect (landscape)', () => {
    const r = targetSize(3000, 2000);
    expect(r.resized).toBe(true);
    expect(Math.max(r.width, r.height)).toBe(MAX_EDGE);
    expect(r.width).toBe(1024);
    expect(r.height).toBe(683);
  });

  it('scales the longest edge to MAX_EDGE preserving aspect (portrait)', () => {
    const r = targetSize(1000, 4000);
    expect(r.height).toBe(MAX_EDGE);
    expect(r.width).toBe(256);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/image-normalise.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// apps/user-client/src/attachments/image-normalise.ts
// SPDX-License-Identifier: AGPL-3.0-only

export const MAX_EDGE = 1024;
export const JPEG_QUALITY = 0.85;

export interface NormalisedImage {
  blob: Blob;
  width: number;
  height: number;
}

/** Pure resize maths — longest edge clamped to MAX_EDGE, aspect preserved, never upscaled. */
export function targetSize(w: number, h: number): { width: number; height: number; resized: boolean } {
  const longest = Math.max(w, h);
  if (longest <= MAX_EDGE) return { width: w, height: h, resized: false };
  const scale = MAX_EDGE / longest;
  return { width: Math.round(w * scale), height: Math.round(h * scale), resized: true };
}

/**
 * Normalise an uploaded image in the browser: EXIF orientation applied, longest edge
 * <= 1024 px, alpha flattened onto white, re-encoded as JPEG q0.85, metadata stripped,
 * animated GIF reduced to its first frame (canvas draws one frame inherently).
 * Ported from chatsune's server-side _image_normaliser.py rules (client-side here — no backend).
 */
export async function normaliseImageForLlm(file: File): Promise<NormalisedImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const { width, height } = targetSize(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  // Flatten any alpha onto white — JPEG carries no transparency.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
  );
  if (!blob) throw new Error('image normalisation failed (toBlob returned null)');
  return { blob, width, height };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/image-normalise.test.ts`
Expected: PASS (3 tests). The `normaliseImageForLlm` canvas path is covered by manual verification.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/attachments/image-normalise.ts apps/user-client/tests/unit/image-normalise.test.ts
git commit -m "Add client-side image normalisation (1024px JPEG, ported chatsune rules)"
```

---

## Task 5: Vision gate (`canSendImages` precedence)

**Files:**
- Create: `apps/user-client/src/attachments/vision-gate.ts`
- Test: `apps/user-client/tests/unit/vision-gate.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/user-client/tests/unit/vision-gate.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { canSendImages, imageDisposition } from '../../src/attachments/vision-gate.js';

const visionLookup = (ref: string) => (ref === 'p:v' ? { profile: { vision: true } } : ref === 'p:nov' ? { profile: { vision: false } } : undefined);

describe('canSendImages', () => {
  it('active model with vision wins', () => {
    expect(canSendImages('p:v', null, visionLookup as never)).toBe(true);
  });
  it('non-vision active + vision substitute → true', () => {
    expect(canSendImages('p:nov', 'p:v', visionLookup as never)).toBe(true);
  });
  it('non-vision active + no substitute → false', () => {
    expect(canSendImages('p:nov', null, visionLookup as never)).toBe(false);
  });
  it('non-vision active + non-vision substitute → false', () => {
    expect(canSendImages('p:nov', 'p:nov', visionLookup as never)).toBe(false);
  });
});

describe('imageDisposition', () => {
  it('direct when active model sees', () => {
    expect(imageDisposition('p:v', 'p:v', visionLookup as never)).toBe('direct');
  });
  it('substitute when active blind but substitute sees', () => {
    expect(imageDisposition('p:nov', 'p:v', visionLookup as never)).toBe('substitute');
  });
  it('placeholder when neither sees', () => {
    expect(imageDisposition('p:nov', null, visionLookup as never)).toBe('placeholder');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/vision-gate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// apps/user-client/src/attachments/vision-gate.ts
// SPDX-License-Identifier: AGPL-3.0-only

/** Minimal shape we need from an Offering — keeps this module decoupled from the catalogue type. */
export interface VisionCapable {
  profile: { vision: boolean };
}
export type OfferingLookup = (ref: string) => VisionCapable | undefined;

function sees(ref: string | null, lookup: OfferingLookup): boolean {
  if (!ref) return false;
  return lookup(ref)?.profile.vision === true;
}

/**
 * Precedence (Chris's rule): the active model's own vision always wins; otherwise a
 * configured vision-capable substitute enables images; otherwise images cannot be seen.
 */
export function canSendImages(activeRef: string, substituteRef: string | null, lookup: OfferingLookup): boolean {
  return sees(activeRef, lookup) || sees(substituteRef, lookup);
}

export type Disposition = 'direct' | 'substitute' | 'placeholder';

/** How a single image should reach the model on this send. */
export function imageDisposition(activeRef: string, substituteRef: string | null, lookup: OfferingLookup): Disposition {
  if (sees(activeRef, lookup)) return 'direct';
  if (sees(substituteRef, lookup)) return 'substitute';
  return 'placeholder';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/vision-gate.test.ts`
Expected: PASS (7 assertions).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/attachments/vision-gate.ts apps/user-client/tests/unit/vision-gate.test.ts
git commit -m "Add vision-gate precedence (active wins → substitute → none)"
```

---

## Task 6: Wire injection (pure builder)

**Files:**
- Create: `apps/user-client/src/attachments/wire-injection.ts`
- Test: `apps/user-client/tests/unit/wire-injection.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/user-client/tests/unit/wire-injection.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { buildUserWireContent, type ResolvedPart } from '../../src/attachments/wire-injection.js';

describe('buildUserWireContent', () => {
  it('returns a plain string when there are no attachments', () => {
    expect(buildUserWireContent('hi', [])).toBe('hi');
  });

  it('emits an image_url part with a naming text part for a direct image', () => {
    const parts: ResolvedPart[] = [{ kind: 'image-direct', fileName: 'a.png', dataUrl: 'data:image/jpeg;base64,xxx' }];
    expect(buildUserWireContent('look', parts)).toEqual([
      { type: 'text', text: 'look' },
      { type: 'text', text: '[Image: a.png]' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,xxx' } },
    ]);
  });

  it('emits a description text part for a substituted image', () => {
    const parts: ResolvedPart[] = [{ kind: 'image-description', fileName: 'a.png', model: 'p:v', description: 'a cat' }];
    expect(buildUserWireContent('', parts)).toEqual([
      { type: 'text', text: '[Image description for a.png (via p:v):\na cat\n]' },
    ]);
  });

  it('emits a placeholder for a blind image', () => {
    const parts: ResolvedPart[] = [{ kind: 'image-placeholder', fileName: 'a.png' }];
    expect(buildUserWireContent('', parts)).toEqual([
      { type: 'text', text: '[Image: a.png — current model cannot see images, image omitted]' },
    ]);
  });

  it('emits a filename-headed fenced block for a text attachment', () => {
    const parts: ResolvedPart[] = [{ kind: 'text', fileName: 'n.md', text: '# Title' }];
    expect(buildUserWireContent('read this', parts)).toEqual([
      { type: 'text', text: 'read this' },
      { type: 'text', text: 'Attachment: n.md\n```\n# Title\n```' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/wire-injection.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// apps/user-client/src/attachments/wire-injection.ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { WireContentPart } from '@chatsundere/llm-unified';

export type ResolvedPart =
  | { kind: 'image-direct'; fileName: string; dataUrl: string }
  | { kind: 'image-description'; fileName: string; model: string; description: string }
  | { kind: 'image-placeholder'; fileName: string }
  | { kind: 'text'; fileName: string; text: string };

/**
 * Build the wire `content` for a user turn from its text plus already-resolved attachment
 * parts. Returns a plain string when there are no attachments (unchanged behaviour), else the
 * multimodal array. The filename always travels.
 */
export function buildUserWireContent(text: string, parts: ResolvedPart[]): string | WireContentPart[] {
  if (parts.length === 0) return text;
  const out: WireContentPart[] = [];
  if (text.length > 0) out.push({ type: 'text', text });
  for (const p of parts) {
    switch (p.kind) {
      case 'image-direct':
        out.push({ type: 'text', text: `[Image: ${p.fileName}]` });
        out.push({ type: 'image_url', image_url: { url: p.dataUrl } });
        break;
      case 'image-description':
        out.push({ type: 'text', text: `[Image description for ${p.fileName} (via ${p.model}):\n${p.description}\n]` });
        break;
      case 'image-placeholder':
        out.push({ type: 'text', text: `[Image: ${p.fileName} — current model cannot see images, image omitted]` });
        break;
      case 'text':
        out.push({ type: 'text', text: `Attachment: ${p.fileName}\n\`\`\`\n${p.text}\n\`\`\`` });
        break;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/wire-injection.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/attachments/wire-injection.ts apps/user-client/tests/unit/wire-injection.test.ts
git commit -m "Add pure wire-injection builder for attachment content parts"
```

---

## Task 7: Substitute-vision describe (one-shot, cached, retry)

**Files:**
- Create: `apps/user-client/src/attachments/substitute-vision.ts`
- Test: `apps/user-client/tests/unit/substitute-vision.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/user-client/tests/unit/substitute-vision.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { VISION_DESCRIBE_INSTRUCTION, describeImage } from '../../src/attachments/substitute-vision.js';

describe('describeImage', () => {
  it('sends the fixed instruction + image as a one-shot and returns the text', async () => {
    const runOneShot = vi.fn().mockResolvedValue('a red bicycle');
    const text = await describeImage({
      dataUrl: 'data:image/jpeg;base64,xxx',
      model: 'p:v',
      runOneShot,
      oneShotBase: { target: { slug: 'm' } } as never,
    });
    expect(text).toBe('a red bicycle');
    const call = runOneShot.mock.calls[0]?.[0];
    expect(call.messages[0].content).toEqual([
      { type: 'text', text: VISION_DESCRIBE_INSTRUCTION },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,xxx' } },
    ]);
    // Conservative shape: reasoning off, low temperature.
    expect(call.bodyExtras.reasoning).toEqual({ enabled: false });
    expect(call.bodyExtras.temperature).toBe(0.2);
  });

  it('retries once on a first failure (cold start) then succeeds', async () => {
    const runOneShot = vi.fn().mockRejectedValueOnce(new Error('cold')).mockResolvedValue('ok');
    const text = await describeImage({ dataUrl: 'd', model: 'm', runOneShot, oneShotBase: { target: {} } as never });
    expect(text).toBe('ok');
    expect(runOneShot).toHaveBeenCalledTimes(2);
  });

  it('throws after a second failure', async () => {
    const runOneShot = vi.fn().mockRejectedValue(new Error('down'));
    await expect(describeImage({ dataUrl: 'd', model: 'm', runOneShot, oneShotBase: { target: {} } as never })).rejects.toThrow();
    expect(runOneShot).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/substitute-vision.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// apps/user-client/src/attachments/substitute-vision.ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { OneShotArgs, WireMessage } from '@chatsundere/llm-unified';

export const VISION_DESCRIBE_INSTRUCTION =
  'Please describe this image in detail: subjects, objects, layout, any visible text, ' +
  'colours, and the overall mood. Be specific and concrete. Do not add interpretation or ' +
  'advice — only what is in the image.';

export interface DescribeImageArgs {
  dataUrl: string;
  /** Substitute model ref "providerId:slug" — recorded in the cache + the injected note. */
  model: string;
  runOneShot: (args: OneShotArgs) => Promise<string>;
  /** Everything in OneShotArgs except messages + bodyExtras (provider/key/proxy/target). */
  oneShotBase: Omit<OneShotArgs, 'messages' | 'bodyExtras'>;
}

/** Describe an image with the substitute model. One silent retry (cold-start tolerance). */
export async function describeImage(args: DescribeImageArgs): Promise<string> {
  const messages: WireMessage[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: VISION_DESCRIBE_INSTRUCTION },
        { type: 'image_url', image_url: { url: args.dataUrl } },
      ],
    },
  ];
  const call = () =>
    args.runOneShot({
      ...args.oneShotBase,
      messages,
      // Conservative: no reasoning, no tools, low temperature — a literal description.
      bodyExtras: { temperature: 0.2, max_tokens: 1024, reasoning: { enabled: false } },
    });
  try {
    return await call();
  } catch {
    return await call(); // second and final attempt
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/substitute-vision.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/attachments/substitute-vision.ts apps/user-client/tests/unit/substitute-vision.test.ts
git commit -m "Add substitute-vision describeImage (one-shot, conservative, retry-once)"
```

---

## Task 8: ViewableItem mapping + capability descriptor

**Files:**
- Create: `apps/user-client/src/components/lightbox/viewable-item.ts`
- Test: `apps/user-client/tests/unit/viewable-item.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/user-client/tests/unit/viewable-item.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { AttachmentRow } from '../../src/boot/client-data-db.js';
import { attachmentToViewable } from '../../src/components/lightbox/viewable-item.js';

function row(over: Partial<AttachmentRow>): AttachmentRow {
  return {
    id: 'a', chatId: 'c', messageId: null, origin: 'upload', kind: 'image', fileName: 'a.png',
    mime: 'image/jpeg', order: 0, state: 'active', createdAt: 0,
    blob: new Blob(['x'], { type: 'image/jpeg' }), width: 1, height: 1, visionDescription: null, ...over,
  };
}

describe('attachmentToViewable', () => {
  it('pending upload image → image kind, rename+remove, no download/delete, no editSource', () => {
    const v = attachmentToViewable(row({}), { pending: true, objectUrl: 'blob:1' });
    expect(v.kind).toBe('image');
    expect(v.imageUrl).toBe('blob:1');
    expect(v.caps).toEqual({ rename: true, remove: true, download: false, delete: false, editSource: false });
  });

  it('pending markdown text → markdown kind, editable source', () => {
    const v = attachmentToViewable(row({ kind: 'text', fileName: 'n.md', mime: 'text/markdown', text: '# x', blob: undefined }), { pending: true });
    expect(v.kind).toBe('markdown');
    expect(v.text).toBe('# x');
    expect(v.caps.editSource).toBe(true);
    expect(v.caps.remove).toBe(true);
  });

  it('plain text (.txt) → text kind, not markdown', () => {
    const v = attachmentToViewable(row({ kind: 'text', fileName: 'log.txt', mime: 'text/plain', text: 'hi', blob: undefined }), { pending: true });
    expect(v.kind).toBe('text');
  });

  it('sent upload → rename only, no remove, source read-only', () => {
    const v = attachmentToViewable(row({ messageId: 'm', kind: 'text', fileName: 'n.md', text: 'x', blob: undefined }), { pending: false });
    expect(v.caps).toEqual({ rename: true, remove: false, download: false, delete: false, editSource: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/viewable-item.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// apps/user-client/src/components/lightbox/viewable-item.ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { AttachmentRow } from '../../boot/client-data-db.js';

export interface Caps {
  rename: boolean;
  remove: boolean; // upload-origin, pending
  download: boolean; // generated-origin (not produced in v1)
  delete: boolean; // generated-origin (not produced in v1)
  editSource: boolean; // text/markdown, pending
}

export interface ViewableItem {
  id: string;
  kind: 'image' | 'text' | 'markdown';
  fileName: string;
  imageUrl?: string;
  text?: string;
  caps: Caps;
}

const MARKDOWN_EXT = new Set(['md', 'markdown']);

function isMarkdown(row: AttachmentRow): boolean {
  if (row.mime === 'text/markdown') return true;
  const i = row.fileName.lastIndexOf('.');
  return i >= 0 && MARKDOWN_EXT.has(row.fileName.slice(i + 1).toLowerCase());
}

/** Map a stored attachment to a presentation item + capability descriptor. */
export function attachmentToViewable(
  row: AttachmentRow,
  opts: { pending: boolean; objectUrl?: string },
): ViewableItem {
  const viewerKind: ViewableItem['kind'] =
    row.kind === 'image' ? 'image' : isMarkdown(row) ? 'markdown' : 'text';
  const isUpload = row.origin === 'upload';
  const isText = row.kind === 'text';
  return {
    id: row.id,
    kind: viewerKind,
    fileName: row.fileName,
    imageUrl: row.kind === 'image' ? opts.objectUrl : undefined,
    text: isText ? row.text : undefined,
    caps: {
      rename: true,
      remove: isUpload && opts.pending,
      download: row.origin === 'generated',
      delete: row.origin === 'generated',
      editSource: isText && opts.pending,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/viewable-item.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/lightbox/viewable-item.ts apps/user-client/tests/unit/viewable-item.test.ts
git commit -m "Add ViewableItem mapping + capability descriptor"
```

---

## Task 9: The unified Lightbox component

**Files:**
- Create: `apps/user-client/src/components/lightbox/LightboxTextBody.tsx`
- Create: `apps/user-client/src/components/lightbox/Lightbox.tsx`
- Test: `apps/user-client/tests/unit/lightbox.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/tests/unit/lightbox.test.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Lightbox } from '../../src/components/lightbox/Lightbox';
import type { ViewableItem } from '../../src/components/lightbox/viewable-item';

const caps = { rename: true, remove: true, download: false, delete: false, editSource: false };
const img = (id: string, name: string): ViewableItem => ({ id, kind: 'image', fileName: name, imageUrl: 'blob:1', caps });
const md = (id: string): ViewableItem => ({ id, kind: 'markdown', fileName: 'n.md', text: '# Hi', caps: { ...caps, editSource: true } });

function noop() {}
const handlers = { onRename: noop, onRemove: noop, onEditText: noop, onClose: noop };

describe('Lightbox', () => {
  it('shows the current item filename and a n / total counter', () => {
    const { getByText } = render(<Lightbox items={[img('1', 'a.png'), img('2', 'b.png')]} index={0} {...handlers} />);
    expect(getByText('a.png')).toBeTruthy();
    expect(getByText('1 / 2')).toBeTruthy();
  });

  it('loops navigation with the next chevron', () => {
    const { getByText, getByLabelText } = render(<Lightbox items={[img('1', 'a.png'), img('2', 'b.png')]} index={1} {...handlers} />);
    fireEvent.click(getByLabelText('Next'));
    expect(getByText('a.png')).toBeTruthy(); // wrapped around
  });

  it('renders Remove only when caps.remove and calls onRemove', () => {
    const onRemove = vi.fn();
    const { getByText } = render(<Lightbox items={[img('1', 'a.png')]} index={0} {...handlers} onRemove={onRemove} />);
    fireEvent.click(getByText('Remove'));
    expect(onRemove).toHaveBeenCalledWith('1');
  });

  it('toggles Preview/Source for markdown and persists an edit', () => {
    const onEditText = vi.fn();
    const { getByText, getByRole } = render(<Lightbox items={[md('1')]} index={0} {...handlers} onEditText={onEditText} />);
    fireEvent.click(getByText('Source'));
    const ta = getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '# Edited' } });
    fireEvent.blur(ta);
    expect(onEditText).toHaveBeenCalledWith('1', '# Edited');
  });

  it('does not render Download/Delete for an upload item', () => {
    const { queryByText } = render(<Lightbox items={[img('1', 'a.png')]} index={0} {...handlers} />);
    expect(queryByText('Download')).toBeNull();
    expect(queryByText('Delete')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/lightbox.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the text body**

```tsx
// apps/user-client/src/components/lightbox/LightboxTextBody.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { MarkdownContent } from '../chat/markdown/MarkdownContent';
import type { ViewableItem } from './viewable-item';

export function LightboxTextBody({ item, onEditText }: { item: ViewableItem; onEditText: (id: string, text: string) => void }): JSX.Element {
  const [view, setView] = useState<'preview' | 'source'>('preview');
  const [draft, setDraft] = useState(item.text ?? '');
  return (
    <div className="lightbox-text">
      <div className="lightbox-seg" role="tablist">
        <button type="button" className={view === 'preview' ? 'on' : ''} onClick={() => setView('preview')}>Preview</button>
        <button type="button" className={view === 'source' ? 'on' : ''} onClick={() => setView('source')}>Source</button>
      </div>
      {view === 'preview' ? (
        item.kind === 'markdown' ? (
          <div className="lightbox-md"><MarkdownContent text={draft} /></div>
        ) : (
          <pre className="lightbox-plain">{draft}</pre>
        )
      ) : (
        <textarea
          className="lightbox-source"
          value={draft}
          readOnly={!item.caps.editSource}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => item.caps.editSource && draft !== item.text && onEditText(item.id, draft)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Implement the Lightbox**

```tsx
// apps/user-client/src/components/lightbox/Lightbox.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { LightboxTextBody } from './LightboxTextBody';
import type { ViewableItem } from './viewable-item';

export interface LightboxProps {
  items: ViewableItem[];
  index: number;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  onEditText: (id: string, text: string) => void;
  onClose: () => void;
  /** Thumbnail rect for the zoom open/close (FLIP). Optional — falls back to a fade. */
  originRect?: DOMRect;
}

export function Lightbox(p: LightboxProps): JSX.Element | null {
  const [i, setI] = useState(p.index);
  const [renaming, setRenaming] = useState(false);
  const item = p.items[i];

  // Keep the index valid as items shrink (after a remove).
  useEffect(() => {
    if (p.items.length === 0) {
      p.onClose();
      return;
    }
    if (i >= p.items.length) setI(p.items.length - 1);
  }, [p.items.length, i, p]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') p.onClose();
      else if (e.key === 'ArrowRight') setI((n) => (n + 1) % p.items.length);
      else if (e.key === 'ArrowLeft') setI((n) => (n - 1 + p.items.length) % p.items.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p, p.items.length]);

  if (!item) return null;
  const multi = p.items.length > 1;
  const prev = (): void => setI((n) => (n - 1 + p.items.length) % p.items.length);
  const next = (): void => setI((n) => (n + 1) % p.items.length);

  return (
    <div className="lightbox-root" role="dialog" aria-modal="true">
      <div className="lightbox-backdrop" onClick={p.onClose} />
      <div className="lightbox">
        <div className="lightbox-top">
          {renaming ? (
            <input
              className="lightbox-name-edit"
              autoFocus
              defaultValue={item.fileName}
              onBlur={(e) => { setRenaming(false); if (e.target.value.trim()) p.onRename(item.id, e.target.value.trim()); }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(false); }}
            />
          ) : (
            <button type="button" className="lightbox-name" onClick={() => item.caps.rename && setRenaming(true)} title="Rename">
              {item.fileName}{item.caps.rename ? ' ✎' : ''}
            </button>
          )}
          <span className="lightbox-spacer" />
          {item.caps.download && <button type="button" className="lightbox-btn">Download</button>}
          {item.caps.delete && <button type="button" className="lightbox-btn lightbox-danger">Delete</button>}
          {item.caps.remove && <button type="button" className="lightbox-btn lightbox-danger" onClick={() => p.onRemove(item.id)}>Remove</button>}
          <button type="button" className="lightbox-x" aria-label="Close" onClick={p.onClose}>×</button>
        </div>
        <div className="lightbox-body">
          {item.kind === 'image' ? (
            <img className="lightbox-img" src={item.imageUrl} alt={item.fileName} />
          ) : (
            <LightboxTextBody item={item} onEditText={p.onEditText} />
          )}
          {multi && <button type="button" className="lightbox-chev l" aria-label="Previous" onClick={prev}>‹</button>}
          {multi && <button type="button" className="lightbox-chev r" aria-label="Next" onClick={next}>›</button>}
          {multi && <span className="lightbox-counter">{i + 1} / {p.items.length}</span>}
        </div>
      </div>
    </div>
  );
}
```

> The FLIP zoom from `originRect` is added in Task 16 alongside the CSS; the test above only needs the structural behaviour.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/lightbox.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/lightbox/Lightbox.tsx apps/user-client/src/components/lightbox/LightboxTextBody.tsx apps/user-client/tests/unit/lightbox.test.tsx
git commit -m "Add unified Lightbox (toolbar by caps, loop nav, preview/source)"
```

---

## Task 10: Attachment thumbnail + strip

**Files:**
- Create: `apps/user-client/src/components/chat/AttachmentThumb.tsx`
- Create: `apps/user-client/src/components/chat/AttachmentStrip.tsx`
- Test: `apps/user-client/tests/unit/attachment-strip.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/tests/unit/attachment-strip.test.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AttachmentRow } from '../../src/boot/client-data-db';
import { AttachmentStrip } from '../../src/components/chat/AttachmentStrip';

function row(over: Partial<AttachmentRow>): AttachmentRow {
  return { id: 'a', chatId: 'c', messageId: null, origin: 'upload', kind: 'image', fileName: 'a.png', mime: 'image/jpeg', order: 0, state: 'active', createdAt: 0, blob: new Blob(['x']), width: 1, height: 1, visionDescription: null, ...over };
}

describe('AttachmentStrip', () => {
  it('renders one thumb per attachment with the filename, and no X button', () => {
    const { getAllByRole, getByText, queryByLabelText } = render(
      <AttachmentStrip attachments={[row({ id: '1', fileName: 'a.png' }), row({ id: '2', kind: 'text', fileName: 'n.md', blob: undefined, text: 'x' })]} onOpen={vi.fn()} />,
    );
    expect(getAllByRole('button')).toHaveLength(2);
    expect(getByText('a.png')).toBeTruthy();
    expect(getByText('n.md')).toBeTruthy();
    expect(queryByLabelText(/remove|close|×/i)).toBeNull(); // deliberate: no X on the thumb
  });

  it('calls onOpen with the clicked index and the thumbnail rect', () => {
    const onOpen = vi.fn();
    const { getAllByRole } = render(<AttachmentStrip attachments={[row({ id: '1' }), row({ id: '2' })]} onOpen={onOpen} />);
    fireEvent.click(getAllByRole('button')[1]);
    expect(onOpen).toHaveBeenCalledWith(1, expect.anything());
  });

  it('renders nothing when empty', () => {
    const { container } = render(<AttachmentStrip attachments={[]} onOpen={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/attachment-strip.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the thumb**

```tsx
// apps/user-client/src/components/chat/AttachmentThumb.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import type { AttachmentRow } from '../../boot/client-data-db';

function extension(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toUpperCase() : 'TXT';
}

export function AttachmentThumb({ row, onOpen }: { row: AttachmentRow; onOpen: (rect: DOMRect) => void }): JSX.Element {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (row.kind === 'image' && row.blob) {
      const u = URL.createObjectURL(row.blob);
      setUrl(u);
      return () => URL.revokeObjectURL(u);
    }
    return undefined;
  }, [row.kind, row.blob]);

  const analysing = row.kind === 'image' && row.messageId !== null && row.visionDescription === null;
  return (
    <button
      type="button"
      className="attach-thumb"
      data-kind={row.kind}
      onClick={(e) => onOpen(e.currentTarget.getBoundingClientRect())}
      title={row.fileName}
    >
      {row.kind === 'image' && url ? (
        <span className="attach-thumb-img" style={{ backgroundImage: `url(${url})` }} />
      ) : (
        <span className="attach-thumb-doc">{extension(row.fileName)}</span>
      )}
      {analysing && <span className="attach-thumb-analysing" aria-label="Analysing image" />}
      <span className="attach-thumb-name">{row.fileName}</span>
    </button>
  );
}
```

- [ ] **Step 4: Implement the strip**

```tsx
// apps/user-client/src/components/chat/AttachmentStrip.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import type { AttachmentRow } from '../../boot/client-data-db';
import { AttachmentThumb } from './AttachmentThumb';

export function AttachmentStrip({ attachments, onOpen }: { attachments: AttachmentRow[]; onOpen: (index: number, rect: DOMRect) => void }): JSX.Element | null {
  if (attachments.length === 0) return null;
  return (
    <div className="attach-strip">
      {attachments.map((row, i) => (
        <AttachmentThumb key={row.id} row={row} onOpen={(rect) => onOpen(i, rect)} />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/attachment-strip.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/chat/AttachmentThumb.tsx apps/user-client/src/components/chat/AttachmentStrip.tsx apps/user-client/tests/unit/attachment-strip.test.tsx
git commit -m "Add attachment thumbnail + strip (no X — removal via lightbox)"
```

---

## Task 11: Cockpit integration — picker, paste, OS drop, strip, lightbox

**Files:**
- Modify: `apps/user-client/src/components/chat/Cockpit.tsx`
- Test: `apps/user-client/tests/unit/cockpit-attachments.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/tests/unit/cockpit-attachments.test.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db';
import { Cockpit } from '../../src/components/chat/Cockpit';
import { listPendingAttachments } from '../../src/data/attachments';

// Normalisation needs a real canvas; stub it so the cockpit flow is testable in jsdom.
vi.mock('../../src/attachments/image-normalise', () => ({
  normaliseImageForLlm: vi.fn().mockResolvedValue({ blob: new Blob(['j'], { type: 'image/jpeg' }), width: 10, height: 10 }),
  MAX_EDGE: 1024,
}));

function wrap(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
const persona = { id: 'p', name: 'Aurum', font: 'serif' } as never;
const offering = { profile: { vision: true } } as never;

beforeEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
  await openClientDataDb();
});

describe('Cockpit attachments', () => {
  it('adds an image via the (+) file input', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <Cockpit chatId="c1" persona={persona} offering={offering} draftValue="" onDraftChange={() => {}} onSend={() => {}} isStreamLive={false} />,
      { wrapper: wrap(qc) },
    );
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    const file = new File([new Uint8Array(10)], 'a.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    await waitFor(async () => expect(await listPendingAttachments('c1')).toHaveLength(1));
  });

  it('the (+) button is enabled (no longer the disabled stub)', () => {
    const qc = new QueryClient();
    const { container } = render(
      <Cockpit chatId="c1" persona={persona} offering={offering} draftValue="" onDraftChange={() => {}} onSend={() => {}} isStreamLive={false} />,
      { wrapper: wrap(qc) },
    );
    expect((container.querySelector('[data-control="plus"]') as HTMLButtonElement).disabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/cockpit-attachments.test.tsx`
Expected: FAIL — `Cockpit` requires a `chatId` prop / `(+)` is disabled / no file input.

- [ ] **Step 3: Extend the Cockpit props + add a shared ingest helper**

Add `chatId: string;` to the `Props` interface. Add this helper near the top of `Cockpit.tsx` (outside the component):

```tsx
import { classifyFile } from '../../attachments/file-classify';
import { normaliseImageForLlm } from '../../attachments/image-normalise';
import { addAttachment } from '../../data/attachments';

async function ingestFiles(chatId: string, files: FileList | File[], onReject: (msg: string) => void): Promise<void> {
  for (const file of Array.from(files)) {
    const c = classifyFile(file);
    if (!c.ok) { onReject(c.reason); continue; }
    if (c.kind === 'image') {
      const norm = await normaliseImageForLlm(file);
      await addAttachment({ chatId, kind: 'image', fileName: file.name, mime: 'image/jpeg', blob: norm.blob, width: norm.width, height: norm.height });
    } else {
      const text = await file.text();
      await addAttachment({ chatId, kind: 'text', fileName: file.name, mime: file.type || 'text/plain', text });
    }
  }
}
```

- [ ] **Step 4: Wire the picker, paste, drop, strip and lightbox into the component body**

Inside the component (using `usePendingAttachments`, `useRemoveAttachment`, `useRenameAttachment`, `useUpdateAttachmentText`, a `useQueryClient` to invalidate after `ingestFiles`, and local state for a hidden `<input type=file>` ref, a reject toast, the drag-over flag, and the lightbox open index):

```tsx
const qc = useQueryClient();
const { data: pending = [] } = usePendingAttachments(p.chatId);
const remove = useRemoveAttachment(p.chatId);
const rename = useRenameAttachment(p.chatId);
const editText = useUpdateAttachmentText(p.chatId);
const fileInputRef = useRef<HTMLInputElement>(null);
const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
const [originRect, setOriginRect] = useState<DOMRect | undefined>(undefined);
const [reject, setReject] = useState<string | null>(null);
const [dragging, setDragging] = useState(false);

const ingest = async (files: FileList | File[]): Promise<void> => {
  await ingestFiles(p.chatId, files, setReject);
  await qc.invalidateQueries({ queryKey: QK.attachmentsPending(p.chatId) });
};

const objectUrls = useMemo(() => new Map(pending.filter((a) => a.kind === 'image' && a.blob).map((a) => [a.id, URL.createObjectURL(a.blob as Blob)])), [pending]);
useEffect(() => () => objectUrls.forEach((u) => URL.revokeObjectURL(u)), [objectUrls]);
const items = pending.map((row) => attachmentToViewable(row, { pending: true, objectUrl: objectUrls.get(row.id) }));
```

Render order (controls row → divider → strip → input):

```tsx
{/* hidden picker input — opened by the (+) button */}
<input
  ref={fileInputRef}
  type="file"
  multiple
  accept="image/png,image/jpeg,image/webp,image/gif,text/*,.md,.json,.csv,.ts,.tsx,.js,.py"
  style={{ display: 'none' }}
  onChange={(e) => { if (e.target.files) void ingest(e.target.files); e.target.value = ''; }}
/>
```

Change the `(+)` button to:

```tsx
<button type="button" className="cockpit-icon-btn" data-control="plus" aria-label="Add attachment" onClick={() => fileInputRef.current?.click()}>
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
</button>
```

After the controls row, add the divider + strip:

```tsx
{pending.length > 0 && <div className="cockpit-divider" />}
<AttachmentStrip attachments={pending} onOpen={(i, rect) => { setOriginRect(rect); setLightboxIndex(i); }} />
```

Add paste + drop handlers to the cockpit container element:

```tsx
onPaste={(e) => {
  const files = Array.from(e.clipboardData.files);
  if (files.length > 0) { e.preventDefault(); void ingest(files); }
  // plain text paste falls through to the textarea (normal prompt text)
}}
onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
onDragLeave={() => setDragging(false)}
onDrop={(e) => { if (e.dataTransfer.files.length > 0) { e.preventDefault(); setDragging(false); void ingest(e.dataTransfer.files); } }}
```

Render the drop overlay + reject toast + the lightbox:

```tsx
{dragging && <div className="cockpit-drop-overlay">Drop files to attach</div>}
{reject && <div className="cockpit-reject" role="alert" onAnimationEnd={() => setReject(null)}>{reject}</div>}
{lightboxIndex !== null && (
  <Lightbox
    items={items}
    index={lightboxIndex}
    originRect={originRect}
    onRename={(id, name) => rename.mutate({ id, fileName: name })}
    onRemove={(id) => remove.mutate(id)}
    onEditText={(id, text) => editText.mutate({ id, text })}
    onClose={() => setLightboxIndex(null)}
  />
)}
```

Add the imports (`useRef/useState/useMemo/useEffect`, `useQueryClient`, `QK`, the attachment hooks, `AttachmentStrip`, `Lightbox`, `attachmentToViewable`).

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/cockpit-attachments.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Update the Cockpit's existing callers to pass `chatId`**

Search: `rg -n "<Cockpit" apps/user-client/src`. Add `chatId={...}` at each call site (the chat page knows the chat id). Run the cockpit's existing test file to confirm no regression: `pnpm --filter @chatsundere/user-client test -- tests/unit/cockpit-draft.test.tsx` (pre-existing localStorage-jsdom failures remain the unchanged baseline).

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/components/chat/Cockpit.tsx apps/user-client/tests/unit/cockpit-attachments.test.tsx <caller files>
git commit -m "Wire attachments into the cockpit (picker, paste, OS drop, strip, lightbox)"
```

---

## Task 12: Sent attachments in the message bubble

**Files:**
- Modify: `apps/user-client/src/components/chat/MessageBlock.tsx`
- Test: `apps/user-client/tests/unit/message-block-attachments.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/tests/unit/message-block-attachments.test.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db';
import { MessageBlock } from '../../src/components/chat/MessageBlock';
import { addAttachment, attachPendingToMessage } from '../../src/data/attachments';

function wrap(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
  await openClientDataDb();
});

describe('MessageBlock attachments', () => {
  it('renders an attachment strip under a user message that has attachments', async () => {
    await addAttachment({ chatId: 'c1', kind: 'text', fileName: 'n.md', mime: 'text/markdown', text: '# x' });
    await attachPendingToMessage('c1', 'm1');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const message = { id: 'm1', chatId: 'c1', role: 'user', contentBlocks: [{ type: 'text', text: 'hi' }], createdAt: 0, bookmarked: false, streamingState: 'complete' } as never;
    const { getByText } = render(
      <MessageBlock message={message} pills={new Map()} persona={null} mindspace={{} as never} displayName="me" expanded={false} onToggleExpand={() => {}} onCopy={() => {}} onBookmark={() => {}} />,
      { wrapper: wrap(qc) },
    );
    await waitFor(() => expect(getByText('n.md')).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/message-block-attachments.test.tsx`
Expected: FAIL — no strip rendered.

- [ ] **Step 3: Implement**

In `MessageBlock.tsx`, for `role === 'user'` messages, query and render attachments below `.msg-text`. Add near the top of the component:

```tsx
const { data: attachments = [] } = useMessageAttachments(p.message.role === 'user' ? p.message.id : '');
const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
const [originRect, setOriginRect] = useState<DOMRect | undefined>(undefined);
const objectUrls = useMemo(() => new Map(attachments.filter((a) => a.kind === 'image' && a.blob && a.state === 'active').map((a) => [a.id, URL.createObjectURL(a.blob as Blob)])), [attachments]);
useEffect(() => () => objectUrls.forEach((u) => URL.revokeObjectURL(u)), [objectUrls]);
const items = attachments.filter((a) => a.state === 'active').map((row) => attachmentToViewable(row, { pending: false, objectUrl: objectUrls.get(row.id) }));
```

After the `.msg-text` block:

```tsx
<AttachmentStrip attachments={attachments.filter((a) => a.state === 'active')} onOpen={(i, rect) => { setOriginRect(rect); setLightboxIndex(i); }} />
{attachments.some((a) => a.state === 'deleted') && <div className="msg-attach-deleted">image deleted</div>}
{lightboxIndex !== null && (
  <Lightbox
    items={items}
    index={lightboxIndex}
    originRect={originRect}
    onRename={(id, name) => void renameAttachment(id, name)}
    onRemove={() => {}}
    onEditText={() => {}}
    onClose={() => setLightboxIndex(null)}
  />
)}
```

(Use the low-level `renameAttachment` import; rename is allowed on sent items. `onRemove`/`onEditText` are no-ops because sent items have `remove:false`/`editSource:false`, so the buttons never render.) Add the imports (`useState/useMemo/useEffect`, `useMessageAttachments`, `renameAttachment`, `AttachmentStrip`, `Lightbox`, `attachmentToViewable`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/message-block-attachments.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/chat/MessageBlock.tsx apps/user-client/tests/unit/message-block-attachments.test.tsx
git commit -m "Render sent attachments under the user message (lightbox on tap)"
```

---

## Task 13: Stream-engine — multimodal user content

**Files:**
- Modify: `apps/user-client/src/lib/stream-engine.ts`
- Test: `apps/user-client/tests/unit/stream-engine-multimodal.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/user-client/tests/unit/stream-engine-multimodal.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { WireContentPart } from '@chatsundere/llm-unified';
import { buildEngineWireMessages } from '../../src/lib/stream-engine.js';

describe('buildEngineWireMessages multimodal', () => {
  it('accepts a WireContentPart[] as the user content (current turn)', () => {
    const content: WireContentPart[] = [
      { type: 'text', text: 'look' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,xxx' } },
    ];
    const msgs = buildEngineWireMessages('SYS', [], content, []);
    expect(msgs[msgs.length - 1]).toEqual({ role: 'user', content });
  });

  it('still accepts a plain string (no attachments)', () => {
    const msgs = buildEngineWireMessages('SYS', [], 'hello', []);
    expect(msgs[msgs.length - 1]).toEqual({ role: 'user', content: 'hello' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/stream-engine-multimodal.test.ts`
Expected: FAIL — type error / current signature takes `string`.

- [ ] **Step 3: Implement**

Change `buildEngineWireMessages` (lines 173–185) so the user content accepts the multimodal form:

```typescript
import type { WireContentPart, WireMessage } from '@chatsundere/llm-unified';

export function buildEngineWireMessages(
  systemPrompt: string,
  priorMessages: MessageRow[],
  userContent: string | WireContentPart[],
  toolExchange: WireMessage[],
): WireMessage[] {
  return [
    { role: 'system', content: systemPrompt },
    ...priorMessages.map(toWireMessage),
    { role: 'user', content: userContent },
    ...toolExchange,
  ];
}
```

(Prior-turn replay of attachments is threaded by the caller in Task 14 — `toWireMessage` stays text-only for v1, with the per-message attachment parts pre-resolved into the caller's `priorMessages` mapping when needed; see Task 14 note.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/stream-engine-multimodal.test.ts`
Expected: PASS. Then run the existing stream-engine test file to confirm callers still typecheck.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/stream-engine.ts apps/user-client/tests/unit/stream-engine-multimodal.test.ts
git commit -m "Allow multimodal user content in buildEngineWireMessages"
```

---

## Task 14: Send path — attach on send + resolve attachment content

**Files:**
- Create: `apps/user-client/src/attachments/resolve-send.ts`
- Modify: `apps/user-client/src/state/stream-manager.store.ts`
- Test: `apps/user-client/tests/unit/resolve-send.test.ts`

This task has two parts: (a) a pure-ish async resolver that turns a user message's attachments into `ResolvedPart[]` (calling substitute-vision where needed and caching the result), and (b) wiring it + `attachPendingToMessage` into `stream-manager.start`.

- [ ] **Step 1: Write the failing test for the resolver**

```typescript
// apps/user-client/tests/unit/resolve-send.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import type { AttachmentRow } from '../../src/boot/client-data-db.js';
import { resolveAttachmentParts } from '../../src/attachments/resolve-send.js';

function img(over: Partial<AttachmentRow> = {}): AttachmentRow {
  return { id: 'a', chatId: 'c', messageId: 'm', origin: 'upload', kind: 'image', fileName: 'a.png', mime: 'image/jpeg', order: 0, state: 'active', createdAt: 0, blob: new Blob(['x'], { type: 'image/jpeg' }), width: 1, height: 1, visionDescription: null, ...over };
}

const deps = {
  toDataUrl: vi.fn().mockResolvedValue('data:image/jpeg;base64,xxx'),
  describe: vi.fn().mockResolvedValue('a cat'),
  cacheDescription: vi.fn().mockResolvedValue(undefined),
};

describe('resolveAttachmentParts', () => {
  it('image-direct when disposition is direct', async () => {
    const parts = await resolveAttachmentParts([img()], 'direct', 'sub', deps);
    expect(parts[0]).toEqual({ kind: 'image-direct', fileName: 'a.png', dataUrl: 'data:image/jpeg;base64,xxx' });
  });

  it('image-description (describes + caches) when substitute, cache miss', async () => {
    const parts = await resolveAttachmentParts([img()], 'substitute', 'sub', deps);
    expect(deps.describe).toHaveBeenCalled();
    expect(deps.cacheDescription).toHaveBeenCalledWith('a', 'sub', 'a cat');
    expect(parts[0]).toEqual({ kind: 'image-description', fileName: 'a.png', model: 'sub', description: 'a cat' });
  });

  it('uses the cached description on a cache hit (no describe call)', async () => {
    deps.describe.mockClear();
    const parts = await resolveAttachmentParts([img({ visionDescription: { model: 'sub', text: 'cached' } })], 'substitute', 'sub', deps);
    expect(deps.describe).not.toHaveBeenCalled();
    expect(parts[0]).toEqual({ kind: 'image-description', fileName: 'a.png', model: 'sub', description: 'cached' });
  });

  it('image-placeholder when neither model sees', async () => {
    const parts = await resolveAttachmentParts([img()], 'placeholder', null, deps);
    expect(parts[0]).toEqual({ kind: 'image-placeholder', fileName: 'a.png' });
  });

  it('text attachments become text parts', async () => {
    const parts = await resolveAttachmentParts([img({ kind: 'text', fileName: 'n.md', text: '# x', blob: undefined })], 'direct', null, deps);
    expect(parts[0]).toEqual({ kind: 'text', fileName: 'n.md', text: '# x' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/resolve-send.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the resolver**

```typescript
// apps/user-client/src/attachments/resolve-send.ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { AttachmentRow } from '../boot/client-data-db.js';
import type { Disposition } from './vision-gate.js';
import type { ResolvedPart } from './wire-injection.js';

export interface ResolveDeps {
  toDataUrl: (blob: Blob) => Promise<string>;
  describe: (dataUrl: string, model: string) => Promise<string>;
  cacheDescription: (attachmentId: string, model: string, text: string) => Promise<void>;
}

/** Turn a message's attachments into resolved wire parts, running/​caching substitute-vision as needed. */
export async function resolveAttachmentParts(
  attachments: AttachmentRow[],
  disposition: Disposition,
  substituteModel: string | null,
  deps: ResolveDeps,
): Promise<ResolvedPart[]> {
  const parts: ResolvedPart[] = [];
  for (const a of attachments) {
    if (a.state === 'deleted') continue;
    if (a.kind === 'text') {
      parts.push({ kind: 'text', fileName: a.fileName, text: a.text ?? '' });
      continue;
    }
    if (!a.blob) continue;
    if (disposition === 'direct') {
      parts.push({ kind: 'image-direct', fileName: a.fileName, dataUrl: await deps.toDataUrl(a.blob) });
    } else if (disposition === 'substitute' && substituteModel) {
      let description = a.visionDescription?.model === substituteModel ? a.visionDescription.text : null;
      if (description === null) {
        description = await deps.describe(await deps.toDataUrl(a.blob), substituteModel);
        await deps.cacheDescription(a.id, substituteModel, description);
      }
      parts.push({ kind: 'image-description', fileName: a.fileName, model: substituteModel, description });
    } else {
      parts.push({ kind: 'image-placeholder', fileName: a.fileName });
    }
  }
  return parts;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/resolve-send.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire into `stream-manager.start`**

In `stream-manager.store.ts`, after the user message is created in the `db.transaction(...)` (lines 94–120), and **before** `runIntoDraft`:

1. Call `await attachPendingToMessage(args.chatId, userMessageId);` (inside the same `rw` transaction — add `db.attachments` to the transaction's table list).
2. After the transaction, build the user content:

```typescript
import { attachPendingToMessage, listMessageAttachments } from '../data/attachments';
import { imageDisposition } from '../attachments/vision-gate';
import { resolveAttachmentParts } from '../attachments/resolve-send';
import { buildUserWireContent } from '../attachments/wire-injection';
import { describeImage } from '../attachments/substitute-vision';
import { runOneShotCompletion, getOffering } from '@chatsundere/llm-unified';
import { blobToDataUrl } from '../attachments/blob-data-url'; // small helper, Step 6

// after the transaction:
const atts = await listMessageAttachments(userMessageId);
let userContent: string | import('@chatsundere/llm-unified').WireContentPart[] = args.userText;
if (atts.length > 0) {
  const activeRef = `${args.persona.providerId}:${args.offering.upstreamSlug}`;
  const substituteRef = settings.substituteVisionModel; // read from the settings row (args or a fetch)
  const lookup = (ref: string) => { const [pid, slug] = ref.split(':'); return getOffering(pid, slug); };
  const disposition = imageDisposition(activeRef, substituteRef, lookup as never);
  const parts = await resolveAttachmentParts(atts, disposition, substituteRef, {
    toDataUrl: blobToDataUrl,
    describe: async (dataUrl, model) => {
      const [pid, slug] = model.split(':');
      const sub = getOffering(pid, slug);
      return describeImage({ dataUrl, model, runOneShot: runOneShotCompletion, oneShotBase: buildOneShotBase(sub /* + provider/key/proxy as title-gen does */) });
    },
    cacheDescription: async (id, model, text) => { await getClientDataDb().attachments.update(id, { visionDescription: { model, text } }); },
  });
  userContent = buildUserWireContent(args.userText, parts);
}
```

Thread `userContent` into `runIntoDraft` so it reaches `buildEngineWireMessages` as the user content (replace the existing `args.userText` hand-off). `buildOneShotBase` mirrors the title-generator's provider/key/proxy/target assembly (see `title-generator.ts:106-126`); reuse that resolution (the same `resolvePersonaContext` helper the store already uses for the persona/secret).

> **Prior-turn replay (spec §9):** also fetch attachments for prior user messages and resolve them the same way (descriptions are already cached, so no re-describe), passing the resulting parts so `buildEngineWireMessages`' `priorMessages` mapping includes them. If this proves heavy, the holistic review will flag it; the current-turn path is the must-have and is fully specified above.

- [ ] **Step 6: Add the tiny blob→dataURL helper (TDD)**

Create `apps/user-client/src/attachments/blob-data-url.ts`:
```typescript
// SPDX-License-Identifier: AGPL-3.0-only
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
```
(Exercised via the cockpit/manual path; `FileReader` is unavailable in plain jsdom without a polyfill — keep it dependency-light and cover it in manual verification.)

- [ ] **Step 7: Run the store test suite**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/stream-manager-store.test.ts`
Expected: PASS (update the stub's `args` to include `chatId`/`persona`/`offering` if the new code reads them; keep the existing assertions green).

- [ ] **Step 8: Commit**

```bash
git add apps/user-client/src/attachments/resolve-send.ts apps/user-client/src/attachments/blob-data-url.ts apps/user-client/src/state/stream-manager.store.ts apps/user-client/tests/unit/resolve-send.test.ts
git commit -m "Attach pending attachments on send + resolve multimodal user content"
```

---

## Task 15: Settings — real substitute-vision picker

**Files:**
- Modify: `apps/user-client/src/routes/app/settings.tsx`
- Test: `apps/user-client/tests/unit/substitute-vision-setting.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/tests/unit/substitute-vision-setting.test.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, getClientDataDb, openClientDataDb } from '../../src/boot/client-data-db';
import { SubstituteVisionSetting } from '../../src/routes/app/settings';

function wrap(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
  await openClientDataDb();
});

describe('SubstituteVisionSetting', () => {
  it('writes the chosen offering ref to settings.substituteVisionModel', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { getByRole } = render(<SubstituteVisionSetting />, { wrapper: wrap(qc) });
    const select = (await waitFor(() => getByRole('combobox'))) as HTMLSelectElement;
    // The first real vision-capable option (depends on the seeded built-ins).
    await act(async () => { fireEvent.change(select, { target: { value: select.options[1]?.value } }); });
    await waitFor(async () => {
      const row = await getClientDataDb().settings.get(1);
      expect(row?.substituteVisionModel).toBe(select.options[1]?.value);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/substitute-vision-setting.test.tsx`
Expected: FAIL — `SubstituteVisionSetting` export does not exist.

- [ ] **Step 3: Implement**

Replace `SubstituteVisionPlaceholder` with a real `SubstituteVisionSetting`:

```tsx
import { listProviders } from '@chatsundere/llm-unified';
import { useSettings, useUpdateSettings } from '../../data/settings';

export function SubstituteVisionSetting(): JSX.Element {
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  const visionOfferings = listProviders().flatMap((pr) =>
    pr.offerings.filter((o) => o.profile.vision).map((o) => ({ ref: `${pr.templateId}:${o.upstreamSlug}`, label: `${o.upstreamSlug} (${pr.displayName})` })),
  );
  const disabled = visionOfferings.length === 0;
  return (
    <div>
      <p className="mb-3 text-[11px] text-paper-soft">
        Route images through a vision-capable model, so a chat model that can&apos;t see images on its
        own can still read them. One global choice for all personas — used only when your active model
        cannot see images.
      </p>
      <select
        className="cockpit-select"
        aria-label="Substitute vision model"
        disabled={disabled}
        title={disabled ? 'Configure a vision-capable provider first' : undefined}
        value={settings?.substituteVisionModel ?? ''}
        onChange={(e) => update.mutate({ substituteVisionModel: e.target.value || null })}
      >
        <option value="">None</option>
        {visionOfferings.map((o) => (<option key={o.ref} value={o.ref}>{o.label}</option>))}
      </select>
    </div>
  );
}
```

Update the render site (line ~369) from `<SubstituteVisionPlaceholder />` to `<SubstituteVisionSetting />`. Confirm `listProviders` / provider `templateId` + `displayName` are the real exports (per the signatures report; adjust the field names to match `registry.ts` if they differ).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/substitute-vision-setting.test.tsx`
Expected: PASS (skip/relax the assertion gracefully if no vision-capable offering is seeded in the test DB — seed one in the test if needed).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/app/settings.tsx apps/user-client/tests/unit/substitute-vision-setting.test.tsx
git commit -m "Make the global substitute-vision model picker real"
```

---

## Task 16: Styling + zoom animation

**Files:**
- Modify: `apps/user-client/src/index.css`
- Modify: `apps/user-client/src/components/lightbox/Lightbox.tsx` (FLIP from `originRect`)

No new unit test (visual; covered by manual verification §15). Keep the existing lightbox test green.

- [ ] **Step 1: Add the FLIP zoom to `Lightbox.tsx`**

Add a ref on `.lightbox` and an open effect that, given `originRect`, sets an initial transform mapping the lightbox rect onto the thumbnail rect, then transitions to identity on the next frame; on close, reverse before calling `onClose`. Respect reduced motion:

```tsx
const surfaceRef = useRef<HTMLDivElement>(null);
useEffect(() => {
  const el = surfaceRef.current;
  if (!el || !p.originRect) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const to = el.getBoundingClientRect();
  const sx = p.originRect.width / to.width;
  const sy = p.originRect.height / to.height;
  const dx = p.originRect.left - to.left;
  const dy = p.originRect.top - to.top;
  el.style.transformOrigin = 'top left';
  el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
  el.style.opacity = '0.6';
  requestAnimationFrame(() => {
    el.style.transition = 'transform 220ms ease, opacity 220ms ease';
    el.style.transform = 'none';
    el.style.opacity = '1';
  });
}, [p.originRect]);
```

Attach `ref={surfaceRef}` to the `.lightbox` div. (Close-zoom can reuse the same maths in a wrapper that delays `onClose`; acceptable to land the open-zoom first and refine close in manual tuning.)

- [ ] **Step 2: Add CSS** to `index.css` (mirroring the mockup; aurora/ink palette, backdrop blur 2px, thumbnail strip, lightbox surface, segmented toggle, chevrons, counter, drop overlay, reject toast, `attach-thumb-analysing` pulse, `cockpit-divider`). Include:

```css
.lightbox-root { position: absolute; inset: 0; z-index: 50; }
.lightbox-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.55); backdrop-filter: blur(2px); }
.lightbox { position: absolute; inset: 6% 4%; background: rgba(10,5,24,0.97); border: 1px solid rgba(255,255,255,0.10); border-radius: 16px; box-shadow: 0 0 40px -10px rgba(141,109,255,0.35); display: flex; flex-direction: column; overflow: hidden; }
.lightbox-top { display: flex; align-items: center; gap: 0.5rem; padding: 0.55rem 0.6rem; border-bottom: 1px solid rgba(255,255,255,0.08); }
.lightbox-name { font-family: var(--font-mono); font-size: 12px; color: var(--color-paper); background: none; border: none; cursor: pointer; }
.lightbox-spacer { flex: 1; }
.lightbox-btn { font-size: 11px; color: #d9c27a; border: 1px solid rgba(201,168,76,0.35); border-radius: 8px; padding: 3px 9px; background: none; }
.lightbox-danger { color: #ff9aa6; border-color: rgba(255,122,138,0.4); }
.lightbox-x { width: 26px; height: 26px; border-radius: 7px; background: rgba(255,255,255,0.07); color: var(--color-paper); }
.lightbox-body { position: relative; flex: 1; display: flex; align-items: center; justify-content: center; overflow: auto; }
.lightbox-img { max-width: 100%; max-height: 100%; object-fit: contain; }
.lightbox-chev { position: absolute; top: 50%; transform: translateY(-50%); width: 34px; height: 34px; border-radius: 50%; background: rgba(0,0,0,0.5); color: #fff; }
.lightbox-chev.l { left: 10px; } .lightbox-chev.r { right: 10px; }
.lightbox-counter { position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%); font-size: 10px; font-family: var(--font-mono); color: #fff; background: rgba(0,0,0,0.5); padding: 2px 9px; border-radius: 999px; }
.lightbox-seg { display: flex; border: 1px solid rgba(255,255,255,0.14); border-radius: 8px; overflow: hidden; width: max-content; margin: 0.6rem; }
.lightbox-seg button { font-size: 11px; padding: 3px 12px; color: rgba(232,230,245,0.6); background: none; }
.lightbox-seg button.on { background: rgba(141,109,255,0.85); color: #fff; }
.lightbox-text { align-self: stretch; width: 100%; }
.lightbox-md, .lightbox-plain { padding: 0 1rem 1rem; }
.lightbox-source { width: 100%; min-height: 50vh; background: rgba(0,0,0,0.35); border: 1px solid rgba(141,109,255,0.4); border-radius: 8px; padding: 0.7rem; font-family: var(--font-mono); font-size: 12px; color: #cfc6ee; }
.cockpit-divider { height: 1px; background: rgba(255,255,255,0.12); margin: 0.5rem 0; }
.attach-strip { display: flex; gap: 0.45rem; padding: 0.1rem 0.05rem; overflow-x: auto; }
.attach-thumb { position: relative; width: 46px; height: 46px; border-radius: 9px; flex: 0 0 auto; overflow: hidden; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.05); }
.attach-thumb-img { position: absolute; inset: 0; background-size: cover; background-position: center; }
.attach-thumb-doc { display: flex; align-items: center; justify-content: center; height: 100%; font-family: var(--font-mono); font-size: 9px; color: #c9b8ff; }
.attach-thumb-name { position: absolute; bottom: 0; left: 0; right: 0; font-size: 7px; padding: 1px 2px; background: rgba(0,0,0,0.55); color: var(--color-paper); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.attach-thumb-analysing { position: absolute; inset: 0; background: rgba(0,0,0,0.45); animation: pill-shimmer 2.2s infinite; }
.cockpit-drop-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(141,109,255,0.18); border: 2px dashed rgba(141,109,255,0.6); border-radius: 14px; color: var(--color-paper); pointer-events: none; }
.cockpit-reject { font-size: 11px; color: #ff9aa6; padding: 0.2rem 0.4rem; }
.msg-attach-deleted { font-size: 11px; font-style: italic; color: rgba(232,230,245,0.5); padding: 0.3rem 0.1rem; }
```

(Tune values to the live aesthetic; these mirror the approved mockups. The lightbox is absolute, bound to `.chat-page`, like the existing sheets.)

- [ ] **Step 3: Verify the lightbox test still passes + reduced-motion guard**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/lightbox.test.tsx`
Expected: PASS (jsdom reports reduced-motion unknown → the FLIP effect early-returns / is harmless).

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/index.css apps/user-client/src/components/lightbox/Lightbox.tsx
git commit -m "Style the lightbox + attachment strip; FLIP zoom open with reduced-motion guard"
```

---

## Task 17: Full verification gate

**Files:** none (verification only).

- [ ] **Step 1: Typecheck the workspace**

Run: `pnpm typecheck`
Expected: all packages pass (the persona-settings baseline was 13/13).

- [ ] **Step 2: Build**

Run: `pnpm run build`
Expected: clean (lightbox + attachment modules emitted; no new circular imports).

- [ ] **Step 3: Full user-client test suite**

Run: `pnpm --filter @chatsundere/user-client test`
Expected: all new tests green; the **only** failures are the unchanged pre-existing `cockpit-draft`/`chat-page`/`chat-route` localStorage-jsdom baseline (confirm identical on master before this branch). If any other test fails, fix it before proceeding.

- [ ] **Step 4: llm-unified suite (no behaviour change expected)**

Run: `pnpm --filter @chatsundere/llm-unified test`
Expected: unchanged green baseline.

- [ ] **Step 5: Biome**

Run: `pnpm biome check --write apps/user-client/src` (then re-stage). Expected: clean.

- [ ] **Step 6: Commit any lint fixups**

```bash
git add -A && git commit -m "Lint + verification fixups for attachments & lightbox"
```

---

## Task 18: Security-deferrals note + STATUS update

**Files:**
- Modify: `obsidian/insights/security-deferrals.md`
- Modify: `obsidian/STATUS-CLIENT-ONLY.md`

- [ ] **Step 1: Append the outbound-surface note** to `security-deferrals.md` (British English): user-uploaded image/text now leaves the device towards the active (or substitute) model's provider; identical in nature to the web-interfacing egress; no key/passphrase/MK surface touched; image data URLs and descriptions never logged; PDF/OCR deferred (beta or later).

- [ ] **Step 2: Update `STATUS-CLIENT-ONLY.md`** — move the image-attachment subsystem from "deferred" to a new "Done/Doing now" entry summarising what landed (unified lightbox, upload via picker/paste/OS-drop, attachments table v12, client-side normalisation, multimodal injection, global substitute vision), the verification numbers, the spec/plan links, and the "Next" (Chris device-tests the §15 manual steps). Refresh the `Last updated:` line.

- [ ] **Step 3: Commit (doc-only)**

```bash
git add obsidian/insights/security-deferrals.md obsidian/STATUS-CLIENT-ONLY.md
git commit -m "Log attachment outbound surface + update client STATUS [skip ci]"
```

---

## Self-Review (completed by author)

**Spec coverage:** §3 scope → Tasks 1–18. §4 data model → Task 1 (+ §4.4 lifecycle in Task 2/14). §5 upload → Tasks 3, 11. §5.3 normalisation → Task 4. §6 lightbox → Tasks 8, 9, 16. §7 cockpit strip → Tasks 10, 11. §8 sent-bubble → Task 12. §9 wire injection → Tasks 6, 13, 14. §10 substitute vision → Tasks 7, 14, 15. §11 gating/fallback → Tasks 5, 14. §12 UX (no X) → Task 10 (test asserts no X). §13 security → Task 18. §14 testing → every task. §15 manual verification → carried into STATUS (Task 18) for Chris. **No spec section is unimplemented.**

**Placeholder scan:** Task 14 Step 5 references `buildOneShotBase` and the provider/key/proxy resolution "as the title generator does" — this is intentionally delegated to the existing `resolvePersonaContext`/title-gen pattern (real, cited code), not a placeholder; the implementer copies that assembly. Prior-turn replay is flagged as the one area to confirm during the holistic review. No "TBD"/"add error handling"/empty steps elsewhere.

**Type consistency:** `AttachmentRow` fields are identical across Tasks 1, 2, 8, 12, 14. `ResolvedPart` defined in Task 6 is consumed unchanged in Task 14. `ViewableItem`/`Caps` defined in Task 8 used in Tasks 9–12. `Disposition` from Task 5 used in Task 14. `buildEngineWireMessages` signature change (Task 13) matches its caller change (Task 14). `attachPendingToMessage`/`listMessageAttachments`/`listPendingAttachments` names consistent across Tasks 2, 12, 14.
