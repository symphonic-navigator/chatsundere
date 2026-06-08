# Substitute-vision live-pill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the substitute-vision describe run as a live, per-image pill inside an already-live persona response (the response "begins" immediately), and remove the interim band-aids so `isStreamLive` is the single source of truth.

**Architecture:** The stream handle is created *before* the substitute describe (so `isStreamLive` is true throughout). `resolveUserContent` moves from `start` into `runIntoDraft` (gated on a fresh send), where each uncached substitute image emits a `describe_image` tool-call pill (pending → completed/failed) into the live handle, ahead of the lore pill, before the LLM tokens stream.

**Tech Stack:** TypeScript (strict), React 18, Zustand, Dexie, Vitest, `@chatsundere/llm-unified`.

**Reference spec:** `superpowers/specs/2026-06-08-substitute-vision-live-pill-design.md`

**Project conventions:** British English everywhere (code, comments, identifiers, commits, user-facing copy). No emojis in code/commits. TS strict; Biome bans non-null `!` (use `biome-ignore lint/style/noNonNullAssertion` with a reason, matching existing code). Commit trailer `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`. Typecheck: `pnpm typecheck` (turbo-cached — use `pnpm typecheck --force` at the gate). Tests: `pnpm --filter @chatsundere/user-client test <pattern>`. Pre-commit runs Biome only; run `pnpm biome check --write <files>` + re-stage if it complains.

---

## File Structure

**Create:**
- `apps/user-client/src/components/chat/VisionPill.tsx` — renders a `describe_image` tool-call pill (pending/completed/failed), modelled on `ExpertPill.tsx`.
- `apps/user-client/tests/components/chat/vision-pill.test.tsx`.

**Modify:**
- `apps/user-client/src/components/chat/Pill.tsx` — dispatch `describe_image` → `VisionPill`.
- `apps/user-client/src/attachments/resolve-send.ts` — `onDescribeStart`/`onDescribeEnd` deps.
- `apps/user-client/src/state/stream-manager.store.ts` — handle-first; move `resolveUserContent` into `runIntoDraft` (gated `!reusedDraft`) with vision-pill emission; `start` passes raw args + `userMessageId`; remove `describingChats`/`markDescribing`.
- Band-aid removal: `apps/user-client/src/routes/app/chat/chat-page.tsx`, `components/chat/InteractionMode.tsx`, `components/chat/Cockpit.tsx`, `components/chat/DualActionBtn.tsx`, and the 6 test fixtures; delete `tests/components/chat/dual-action-btn.test.tsx`.

**Task order (by dependency):** VisionPill (1) → resolve-send callbacks (2) → band-aid removal (3) → stream-manager restructure (4) → gate (5).

---

## Task 1: VisionPill component + Pill dispatch

**Files:**
- Create: `apps/user-client/src/components/chat/VisionPill.tsx`
- Modify: `apps/user-client/src/components/chat/Pill.tsx`
- Test: `apps/user-client/tests/components/chat/vision-pill.test.tsx`

The pill payload shape is `{ name: 'describe_image'; model: string; fileName: string; result?: string; error?: string }`. `PillRow` is `{ id, messageId, kind, positionHint, status: 'pending'|'completed'|'failed', payload: unknown, createdAt }`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/tests/components/chat/vision-pill.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PillRow } from '../../../src/boot/client-data-db.js';
import { VisionPill } from '../../../src/components/chat/VisionPill.js';

const row = (status: PillRow['status'], payload: Record<string, unknown>): PillRow => ({
  id: 'p1',
  messageId: 'm1',
  kind: 'tool-call',
  positionHint: 'above-text',
  status,
  payload: { name: 'describe_image', ...payload },
  createdAt: 1,
});

describe('VisionPill', () => {
  it('shows reading + filename while pending', () => {
    render(<VisionPill row={row('pending', { model: 'gemini', fileName: 'cat.jpg' })} />);
    expect(screen.getByText(/reading image/i)).toBeTruthy();
    expect(screen.getByText(/cat\.jpg/)).toBeTruthy();
  });

  it('expands to the description and model when completed', () => {
    render(
      <VisionPill
        row={row('completed', { model: 'gemini', fileName: 'cat.jpg', result: 'A black cat.' })}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/A black cat\./)).toBeTruthy();
    expect(screen.getByText(/via gemini/i)).toBeTruthy();
  });

  it('shows a failure label when failed', () => {
    render(
      <VisionPill row={row('failed', { model: 'gemini', fileName: 'cat.jpg', error: 'timeout' })} />,
    );
    expect(screen.getByText(/couldn't read image/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it, verify FAIL**

Run: `pnpm --filter @chatsundere/user-client test vision-pill`
Expected: FAIL — module missing.

- [ ] **Step 3: Create `VisionPill.tsx`** (modelled on `ExpertPill.tsx`)

```tsx
// apps/user-client/src/components/chat/VisionPill.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import type { PillRow } from '../../boot/client-data-db.js';

interface VisionPayload {
  model?: string;
  fileName?: string;
  result?: string;
  error?: string;
}

/** Pill for a substitute-vision describe: live "reading image" while pending,
 *  expandable to the description + model when done. One per substituted image. */
export function VisionPill({ row }: { row: PillRow }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const p = (row.payload ?? {}) as VisionPayload;
  const name = p.fileName ?? 'image';
  const model = p.model ?? 'vision model';

  if (row.status === 'pending') {
    return (
      <span className="artefact-pill" data-state="building">
        <span className="artefact-pill-ic" aria-hidden>
          ▢
        </span>
        <span className="artefact-pill-ttl">Reading image</span>
        <span className="artefact-pill-sub">{name}</span>
        <span className="artefact-pill-bar">
          <i />
        </span>
      </span>
    );
  }

  if (row.status === 'failed') {
    return (
      <span className="artefact-pill" data-state="tombstone" aria-disabled>
        <span className="artefact-pill-ic" aria-hidden>
          ▢
        </span>
        <span className="artefact-pill-ttl">Couldn't read image</span>
        <span className="artefact-pill-sub">{name}</span>
      </span>
    );
  }

  return (
    <span className="pill-wrap">
      <button
        type="button"
        className="pill"
        data-pill-kind="tool-call"
        data-pill-status="completed"
        data-pill-expandable
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="pill-icon" aria-hidden>
          ▢
        </span>
        Read image · {name}
      </button>
      {expanded ? (
        <span className="pill-detail">
          {p.result !== undefined && <code className="pill-detail-result">{p.result}</code>}
          <span className="pill-detail-lore-note">via {model}</span>
        </span>
      ) : null}
    </span>
  );
}
```

- [ ] **Step 4: Run the test, verify PASS** (3/3)

Run: `pnpm --filter @chatsundere/user-client test vision-pill`

- [ ] **Step 5: Dispatch `describe_image` → `VisionPill` in `Pill.tsx`**

In `apps/user-client/src/components/chat/Pill.tsx`, add the import and a dispatch branch alongside the existing `create_artefact`/`ask_expert` branches (after the `ask_expert` branch, before the `positionHint === 'above-text'` recursion):

```tsx
import { VisionPill } from './VisionPill.js';
// ...
  if (
    row.kind === 'tool-call' &&
    (row.payload as { name?: string } | undefined)?.name === 'describe_image'
  ) {
    return <VisionPill row={row} />;
  }
```

NOTE: the `positionHint === 'above-text'` wrapper branch in `Pill.tsx` recurses with an `inline` row. Place the `describe_image` dispatch **before** that wrapper branch so a `positionHint: 'above-text'` describe pill routes to `VisionPill` (which renders its own chrome) rather than being wrapped. The `VisionPill` is rendered without the `.pill-above` wrapper; that is fine — vision pills sit at the top of the response by buffer order (Task 4), not by the wrapper.

- [ ] **Step 6: Run the Pill suite + typecheck**

Run: `pnpm --filter @chatsundere/user-client test Pill vision-pill`
Expected: existing Pill tests green + vision-pill 3/3.
Run: `pnpm typecheck`

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/components/chat/VisionPill.tsx apps/user-client/src/components/chat/Pill.tsx apps/user-client/tests/components/chat/vision-pill.test.tsx
git commit -m "Add VisionPill for substitute-vision describe pills"
```

---

## Task 2: resolveAttachmentParts describe callbacks

**Files:**
- Modify: `apps/user-client/src/attachments/resolve-send.ts`
- Test: `apps/user-client/tests/unit/resolve-attachment-parts.test.ts` (create if absent; otherwise add to the existing resolve-send test)

Current `ResolveDeps` is `{ toDataUrl, describe, cacheDescription }`. `resolveAttachmentParts(attachments, disposition, substituteModel, deps)` iterates attachments; for a `substitute` disposition with an uncached image it calls `deps.describe(dataUrl, model)` then `deps.cacheDescription`. We add two optional callbacks fired around a *real* describe.

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/tests/unit/resolve-attachment-parts.test.ts
import { describe, expect, it, vi } from 'vitest';
import type { AttachmentRow } from '../../src/boot/client-data-db.js';
import { resolveAttachmentParts } from '../../src/attachments/resolve-send.js';

const img = (over: Partial<AttachmentRow> = {}): AttachmentRow =>
  ({
    id: 'a1',
    chatId: 'c1',
    messageId: 'm1',
    kind: 'image',
    origin: 'upload',
    state: 'active',
    fileName: 'cat.jpg',
    mime: 'image/jpeg',
    blob: new Blob(['x']),
    createdAt: 1,
    ...over,
  }) as AttachmentRow;

const deps = {
  toDataUrl: async () => 'data:,',
  describe: async () => 'A cat.',
  cacheDescription: async () => {},
};

describe('resolveAttachmentParts describe callbacks', () => {
  it('fires onDescribeStart/onDescribeEnd once for an uncached substitute image', async () => {
    const start = vi.fn();
    const end = vi.fn();
    await resolveAttachmentParts([img()], 'substitute', 'prov:model', {
      ...deps,
      onDescribeStart: start,
      onDescribeEnd: end,
    });
    expect(start).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }), { ok: true, text: 'A cat.' });
  });

  it('reports failure through onDescribeEnd and does not throw', async () => {
    const end = vi.fn();
    const parts = await resolveAttachmentParts([img()], 'substitute', 'prov:model', {
      ...deps,
      describe: async () => {
        throw new Error('boom');
      },
      onDescribeStart: vi.fn(),
      onDescribeEnd: end,
    });
    expect(end).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }), { ok: false, error: 'boom' });
    expect(parts[0]).toEqual({ kind: 'image-placeholder', fileName: 'cat.jpg' });
  });

  it('does not fire for a cached description', async () => {
    const start = vi.fn();
    await resolveAttachmentParts(
      [img({ visionDescription: { model: 'prov:model', text: 'cached' } })],
      'substitute',
      'prov:model',
      { ...deps, onDescribeStart: start, onDescribeEnd: vi.fn() },
    );
    expect(start).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it, verify FAIL**

Run: `pnpm --filter @chatsundere/user-client test resolve-attachment-parts`
Expected: FAIL — callbacks not invoked (and the failure-path test fails since `onDescribeEnd` is not called).

- [ ] **Step 3: Add the callbacks to `resolve-send.ts`**

Extend `ResolveDeps`:

```ts
export interface ResolveDeps {
  toDataUrl: (blob: Blob) => Promise<string>;
  describe: (dataUrl: string, model: string) => Promise<string>;
  cacheDescription: (attachmentId: string, model: string, text: string) => Promise<void>;
  /** Fired immediately before a real (uncached) substitute describe for an image. */
  onDescribeStart?: (a: AttachmentRow) => void;
  /** Fired after that describe resolves or fails. */
  onDescribeEnd?: (
    a: AttachmentRow,
    outcome: { ok: true; text: string } | { ok: false; error: string },
  ) => void;
}
```

In the `substitute` branch, wrap the describe (the existing block that runs when `description === null`):

```ts
      if (description === null) {
        deps.onDescribeStart?.(a);
        try {
          description = await deps.describe(await deps.toDataUrl(a.blob), substituteModel);
          await deps.cacheDescription(a.id, substituteModel, description);
          deps.onDescribeEnd?.(a, { ok: true, text: description });
        } catch (e) {
          deps.onDescribeEnd?.(a, {
            ok: false,
            error: e instanceof Error ? e.message : 'Vision describe failed.',
          });
          // Substitute model unavailable — degrade this image to a placeholder rather than
          // letting the error abort the entire attachment list.
          parts.push({ kind: 'image-placeholder', fileName: a.fileName });
          continue;
        }
      }
```

- [ ] **Step 4: Run the test, verify PASS** (3/3)

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm typecheck
git add apps/user-client/src/attachments/resolve-send.ts apps/user-client/tests/unit/resolve-attachment-parts.test.ts
git commit -m "Add describe lifecycle callbacks to resolveAttachmentParts"
```

---

## Task 3: Remove the interim band-aids

**Files:**
- Modify: `apps/user-client/src/routes/app/chat/chat-page.tsx`, `components/chat/InteractionMode.tsx`, `components/chat/Cockpit.tsx`, `components/chat/DualActionBtn.tsx`
- Modify fixtures: `tests/components/chat/InteractionMode.test.tsx`, `tests/unit/cockpit-attachments.test.tsx`, `tests/unit/cockpit-source-menu.test.tsx`, `tests/unit/cockpit.test.tsx`, `tests/unit/interaction-mode.test.tsx`, `tests/unit/interaction-topbar.test.tsx`
- Delete: `tests/components/chat/dual-action-btn.test.tsx`

This reverts commits `2c54e60` + `af46e5d`'s UI changes and the cockpit hint. The `describingChats` store field is left for now (unused after the Cockpit hint is gone) and removed in Task 4. After this task `isStreamLive` is again the only send/footer gate (the duplicate/footer bugs return until Task 4 restructures — acceptable in-worktree).

- [ ] **Step 1: chat-page.tsx**

Revert the `onSend` guard to its original (remove the `sendMessage.isPending` clause + comment):

```ts
  const onSend = async (text: string): Promise<void> => {
    if (!effectivePersona) return;
    const newChatId = await sendMessage.mutateAsync({
```

Remove the `isSending={sendMessage.isPending}` prop from the `<InteractionMode … />` render.

Revert the interrupted-footer condition (remove `|| sendMessage.isPending`):

```ts
        if (isStreamLive) return null;
```
(restore the original comment block ending at "suppress it while a stream is actually live for this chat.")

- [ ] **Step 2: InteractionMode.tsx**

Remove the `isSending: boolean;` prop (and its JSDoc) from `Props`, and remove `isSending={p.isSending}` from the `<Cockpit … />` render.

- [ ] **Step 3: DualActionBtn.tsx**

Revert to the pre-band-aid version:

```tsx
interface Props {
  hasText: boolean;
  isStreamLive: boolean;
  personaName: string;
  onSend: () => void;
}

export function DualActionBtn(p: Props): JSX.Element {
  const disabled = !p.hasText || p.isStreamLive;
  const title = p.isStreamLive
    ? `${p.personaName} is still replying…`
    : p.hasText
      ? 'Send'
      : 'Voice arrives with Block 4';
  return (
    <button
      type="button"
      className="dual-action-btn"
      data-dual="action"
      disabled={disabled}
      title={title}
      aria-label={p.hasText ? 'Send' : 'Microphone (disabled)'}
      onClick={p.hasText && !p.isStreamLive ? p.onSend : undefined}
    >
```
(keep the rest of the file — the two SVGs — unchanged.)

- [ ] **Step 4: Cockpit.tsx**

Remove the `isSending: boolean;` prop (+ JSDoc) from `Props`. Remove `p.isSending` from the Enter guard (back to `if (p.isStreamLive || p.draftValue.trim().length === 0) return;`). Remove `isSending={p.isSending}` from `<DualActionBtn … />`. Remove the `describingImage` selector line (`const describingImage = useStreamManagerStore(...)`) and the `{describingImage && <output …>Describing image…</output>}` element. Remove the now-unused `import { useStreamManagerStore } from '../../state/stream-manager.store.js';` (Biome/typecheck will flag it if missed).

- [ ] **Step 5: Fixtures — remove `isSending={false}`**

In each of the 6 fixture files, delete the `isSending={false}` line added beside `isStreamLive={false}`:
`tests/components/chat/InteractionMode.test.tsx`, `tests/unit/cockpit-attachments.test.tsx` (2 occurrences), `tests/unit/cockpit-source-menu.test.tsx`, `tests/unit/cockpit.test.tsx`, `tests/unit/interaction-mode.test.tsx`, `tests/unit/interaction-topbar.test.tsx`.

Run `rg -n "isSending" apps/user-client/tests apps/user-client/src` afterwards — it must return **nothing**.

- [ ] **Step 6: Delete the dual-action-btn test**

```bash
git rm apps/user-client/tests/components/chat/dual-action-btn.test.tsx
```

- [ ] **Step 7: Typecheck + targeted tests + commit**

```bash
pnpm typecheck --force
pnpm --filter @chatsundere/user-client test cockpit interaction Pill
```
Expected: green except the known `cockpit-draft` localStorage-jsdom baseline. No `isSending`/`describingImage` references remain.
```bash
git add -A apps/user-client/src/routes/app/chat/chat-page.tsx apps/user-client/src/components/chat/InteractionMode.tsx apps/user-client/src/components/chat/Cockpit.tsx apps/user-client/src/components/chat/DualActionBtn.tsx apps/user-client/tests
git commit -m "Remove interim substitute-vision send band-aids"
```

---

## Task 4: Stream-manager restructure — handle-first describe pills

**Files:**
- Modify: `apps/user-client/src/state/stream-manager.store.ts`
- Test: `apps/user-client/tests/unit/stream-manager-store.test.ts`

This is the core. Move `resolveUserContent` into `runIntoDraft` (gated `!reusedDraft`); the handle is created first; each uncached substitute image emits a `describe_image` pill ahead of the lore pill; remove `describingChats`/`markDescribing`.

Read the current `start` (≈ lines 144-203), `runIntoDraft` (≈ 354-470+), and `resolveUserContent` (≈ 285-345) first.

- [ ] **Step 1: Write the failing test**

```ts
// add to apps/user-client/tests/unit/stream-manager-store.test.ts
// (mirror the existing harness: baseStartArgs, fake db, a stubbed stream).
it('emits a pending describe_image pill into the live handle before tokens', async () => {
  // Arrange a fresh substitute send: an image attachment bound to the user message,
  // an active model WITHOUT vision, a substitute WITH vision, and a substituteOneShotBase.
  // Use a describe stub that resolves after a microtask so the pending state is observable.
  // (See the existing tests for how baseStartArgs + the in-memory db are built; extend
  //  them with: db.attachments holding one image row for the new userMessage, and
  //  args.substituteVisionModel + args.substituteOneShotBase set, and getOffering stubbed
  //  so the active ref has profile.vision=false and the substitute ref vision=true.)
  const store = useStreamManagerStore.getState();
  // ... build args (see harness) ...
  const p = store.start(args as never); // do NOT await — inspect mid-flight
  // Allow the transaction + handle creation + first describe pill to flush:
  await Promise.resolve();
  await Promise.resolve();
  const handle = useStreamManagerStore.getState().streams.get(chatId);
  const pills = handle?.pillBuffer ?? [];
  const visionPill = pills.find(
    (pl) => pl.kind === 'tool-call' && (pl.payload as { name?: string }).name === 'describe_image',
  );
  expect(visionPill?.status).toBe('pending');
  await p; // let the send complete
});
```

NOTE for the implementer: the existing `stream-manager-store.test.ts` already builds a fake Dexie + `baseStartArgs` + a stubbed stream engine. Reuse that harness; add the attachment row + substitute fields. If wiring a full mid-flight assertion proves brittle, assert instead the **post-condition**: after a completed substitute send, the persisted message's pills include a `describe_image` pill with `status: 'completed'` and the description in its payload — and a `regenerate` produces no such pill. Prefer the post-condition test if the timing assertion is flaky (it is the durable contract). Keep at least the regenerate-does-not-describe assertion.

- [ ] **Step 2: Run it, verify FAIL**

Run: `pnpm --filter @chatsundere/user-client test stream-manager-store`
Expected: FAIL — no describe pill (resolution still happens in `start`, pre-handle).

- [ ] **Step 3: Change `start` to pass raw args + `userMessageId`; drop the pre-resolve**

In `start`, delete the `resolveUserContent` call and the `markDescribing` block. Pass the raw args and the `userMessageId` to `runIntoDraft`:

```ts
    // The persona response goes live immediately; runIntoDraft resolves the
    // user turn's attachments (running substitute-vision describes as live pills)
    // inside the live stream for a fresh send.
    runIntoDraft(args, draftMessageId, set, get, false, userMessageId);
```

(`args.userMessageText` is already the raw user text from the send path; `runIntoDraft` overrides it with the resolved content for fresh sends.)

- [ ] **Step 4: Add the `userMessageId` param + resolution to `runIntoDraft`**

Change the signature to accept `userMessageId: string | null` (last param; `regenerate` passes `null`):

```ts
function runIntoDraft(
  args: StartArgs,
  draftMessageId: string,
  set: (fn: (s: StreamManagerStore) => Partial<StreamManagerStore>) => void,
  get: () => StreamManagerStore,
  reusedDraft: boolean,
  userMessageId: string | null = null,
): void {
```

Update the `regenerate` call site (it currently calls `runIntoDraft(args, args.targetMessageId, set, get, true)`) — it stays as-is (the new param defaults to `null`).

After the handle is `set` (the existing `set((s) => { … m.set(args.chatId, handle); … })` block) and **before** `runToolLoop`, insert the resolution. The lore pill (if any) is already in `handle.contentBuffer`/`pillBuffer`; vision pills must precede it. Use a local rebuild keyed off `lorePill` (in scope):

```ts
  // Resolve the fresh user turn's attachments into wire content, emitting a live
  // describe_image pill per uncached substitute image (ahead of the lore pill).
  // Regenerate (reusedDraft) keeps args.userMessageText as-is (no re-describe).
  let userMessageText = args.userMessageText;
  if (!reusedDraft && userMessageId) {
    const visionPills: PillRow[] = [];
    const rebuildBuffers = (): void => {
      set((s) => {
        const live = s.streams.get(args.chatId);
        if (!live) return s;
        const contentBuffer: ContentBlock[] = [
          ...visionPills.map((vp) => ({ type: 'pill', pillId: vp.id }) as ContentBlock),
          ...(lorePill ? [{ type: 'pill', pillId: lorePill.id } as ContentBlock] : []),
        ];
        const pillBuffer: PillRow[] = [...visionPills, ...(lorePill ? [lorePill] : [])];
        const m = new Map(s.streams);
        m.set(args.chatId, { ...live, contentBuffer, pillBuffer });
        return { streams: m };
      });
    };
    userMessageText = await resolveUserContent(args, userMessageId, controller.signal, {
      onDescribeStart: (a) => {
        visionPills.push({
          id: uuidv7(),
          messageId: '',
          kind: 'tool-call',
          positionHint: 'above-text',
          status: 'pending',
          payload: {
            name: 'describe_image',
            model: args.substituteVisionModel ?? 'vision model',
            fileName: a.fileName,
          },
          createdAt: Date.now(),
        });
        rebuildBuffers();
      },
      onDescribeEnd: (a, outcome) => {
        const vp = visionPills.find(
          (x) => (x.payload as { fileName?: string }).fileName === a.fileName && x.status === 'pending',
        );
        if (vp) {
          vp.status = outcome.ok ? 'completed' : 'failed';
          vp.payload = {
            ...(vp.payload as Record<string, unknown>),
            ...(outcome.ok ? { result: outcome.text } : { error: outcome.error }),
          };
        }
        rebuildBuffers();
      },
    });
  }
```

`Date.now()` is already used in this module — keep using it. (`uuidv7`, `ContentBlock`, `PillRow` are already imported.)

Then thread `userMessageText` into the stream call — change the `streamOnce` `runStreamEngine({ ...args, … })` to override it:

```ts
    streamOnce: (toolExchange, tools) =>
      runStreamEngine({
        ...args,
        userMessageText,
        toolsInstruction,
        knowledgeLibrariesContext,
        loreContext: args.loreContext ?? '',
        tools,
        toolExchange,
        signal: controller.signal,
        onChunk,
      }),
```

- [ ] **Step 5: Update `resolveUserContent` signature**

Change it to take the abort signal + the describe callbacks, and drop the `markDescribing`/`describingOn` logic (remove it entirely). New signature + body shape:

```ts
async function resolveUserContent(
  args: StartArgs,
  userMessageId: string,
  signal: AbortSignal,
  callbacks: {
    onDescribeStart: (a: AttachmentRow) => void;
    onDescribeEnd: (
      a: AttachmentRow,
      outcome: { ok: true; text: string } | { ok: false; error: string },
    ) => void;
  },
): Promise<string | WireContentPart[]> {
  const db = getClientDataDb();
  try {
    const atts = await listMessageAttachments(userMessageId);
    if (atts.length === 0) return args.userText;
    const activeRef = `${args.provider.id}:${args.offering.upstreamSlug}`;
    const substituteRef = args.substituteVisionModel ?? null;
    const lookup = (ref: string) => {
      const idx = ref.indexOf(':');
      if (idx < 0) return undefined;
      return getOffering(ref.slice(0, idx), ref.slice(idx + 1));
    };
    const disposition = imageDisposition(activeRef, substituteRef, lookup);
    const base = args.substituteOneShotBase;
    const parts = await resolveAttachmentParts(atts, disposition, substituteRef, {
      toDataUrl: blobToDataUrl,
      describe: async (dataUrl, model) => {
        if (!base) throw new Error('substitute-vision: no resolved one-shot context');
        return describeImage({ dataUrl, model, runOneShot: runOneShotCompletion, oneShotBase: base, signal });
      },
      cacheDescription: async (id, model, text) => {
        await db.attachments.update(id, { visionDescription: { model, text } });
      },
      onDescribeStart: callbacks.onDescribeStart,
      onDescribeEnd: callbacks.onDescribeEnd,
    });
    return buildUserWireContent(args.userText, parts);
  } catch (err) {
    console.error('[stream-manager] attachment resolution failed; sending text only', err);
    return args.userText;
  }
}
```

NOTE: `describeImage`'s args type is `DescribeImageArgs` (no `signal` today). Add an optional `signal?: AbortSignal` to `DescribeImageArgs` in `attachments/substitute-vision.ts` and forward it into the `runOneShot` call's args (the one-shot path accepts a `signal`); if threading the signal into `describeImage` is non-trivial, drop the `signal` from the `describeImage` call here and rely on the outer abort (the send's `controller.abort()` already tears down the stream; a describe in flight will finish into a discarded draft). Keep the change minimal — the signal is a nicety, not load-bearing.

- [ ] **Step 6: Remove `describingChats` from the store**

Delete the `describingChats: Set<string>;` field from `StreamManagerStore`, the `describingChats: new Set(),` initialiser, and any remaining references (there should be none after Task 3 removed the Cockpit selector).

- [ ] **Step 7: Run the store test + typecheck**

Run: `pnpm --filter @chatsundere/user-client test stream-manager-store`
Expected: the new describe-pill test passes; existing stream-manager tests stay green.
Run: `pnpm typecheck --force`

- [ ] **Step 8: Commit**

```bash
git add apps/user-client/src/state/stream-manager.store.ts apps/user-client/src/attachments/substitute-vision.ts apps/user-client/tests/unit/stream-manager-store.test.ts
git commit -m "Run substitute-vision describe as a live in-stream pill"
```

---

## Task 5: Full verification gate

- [ ] **Step 1: Typecheck (uncached)**

Run: `pnpm typecheck --force`
Expected: 14/14.

- [ ] **Step 2: Full user-client vitest**

Run: `pnpm --filter @chatsundere/user-client test`
Expected: green except the known `cockpit-draft`/`chat-page`/`chat-route` localStorage-jsdom baseline (verify the failing files are exactly those three and fail identically on the worktree base). Confirm `rg -n "isSending|describingChats|describingImage" apps/user-client/src apps/user-client/tests` returns nothing.

- [ ] **Step 3: Build + biome**

Run: `pnpm run build` (expected 9/9) and `pnpm biome check apps/user-client/src` (clean apart from the pre-existing `index.css` format drift, which is not ours).

---

## Self-Review notes (addressed)

- **Spec coverage:** §4.1 flow → Task 3 (band-aid removal) + Task 4 (handle-first, resolve-in-runIntoDraft, gated `!reusedDraft`); §4.2 vision pill → Task 1; §4.3 callbacks/wiring → Task 2 + Task 4 (emission + vision-before-lore rebuild); §4.4 persistence/abort → Task 4 (pillBuffer persists; abortDiscard unchanged); §5 cleanup → Task 3 (+ describingChats in Task 4); §6 errors → Task 2 (failure path) + Task 4 (resolveUserContent try/catch); §7 tests → Tasks 1,2,4 + Task 5.
- **Ordering:** leaf UI (1) + attachments (2) before the stream-manager consumer (4); band-aid removal (3) before the restructure so each task is typecheck-green (the `describingChats` store field is removed in Task 4 once its last consumer — the Cockpit selector — is gone in Task 3).
- **Type consistency:** payload `{ name:'describe_image', model, fileName, result?, error? }` (Task 1 ↔ Task 4); `onDescribeStart(a)`/`onDescribeEnd(a, {ok:true,text}|{ok:false,error})` (Task 2 ↔ Task 4); `runIntoDraft(..., userMessageId: string|null=null)` (Task 4); `resolveUserContent(args, userMessageId, signal, callbacks)` (Task 4).
- **Vision-before-lore:** the `rebuildBuffers` helper reconstructs `contentBuffer`/`pillBuffer` as `[...visionPills, lore?]` on every describe event (no token blocks exist yet at resolution time), guaranteeing order without index math.
- **Known risk flagged:** the mid-flight pending-pill assertion (Task 4 Step 1) may be timing-brittle — the plan offers the durable post-condition assertion as the primary contract.
