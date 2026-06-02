# Persona Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-persona context-window control with real truncation, a local-first persona avatar with a rounded-square crop, and a disabled placeholder for a future global substitute-vision-model setting.

**Architecture:** Three decoupled client-only features. Feature 1 adds pure token helpers (`context-window.ts`), wires truncation into `runStreamEngine`, retargets the gauge, and shows an in-stream "out of memory" marker. Feature 2 stores a downscaled full image + crop metadata in a new Dexie table and renders the crop via CSS (re-editable), with a monogram fallback. Feature 3 is an honest disabled card in My Settings.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), React 18, Dexie, TanStack Query, Vitest. Spec: `superpowers/specs/2026-06-02-persona-settings-design.md`.

**Conventions for every task:**
- British English in all code/comments/strings; SPDX header `// SPDX-License-Identifier: AGPL-3.0-only` on every new file.
- Single-file Vitest run: `cd apps/user-client && pnpm exec vitest run <relative-path>`.
- Typecheck gate (from repo root): `pnpm typecheck`.
- Commit message: imperative subject, body, then `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`. Do NOT push, merge, or switch branches.

---

## Task 1: Pure context-window helpers

**Files:**
- Create: `apps/user-client/src/lib/context-window.ts`
- Test: `apps/user-client/src/lib/context-window.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { Offering } from '@chatsundere/llm-unified';
import type { PersonaRow } from '../boot/client-data-db.js';
import type { WireMessage } from '@chatsundere/llm-unified';
import {
  CONTEXT_FLOOR,
  contextAdjustable,
  effectiveFloor,
  outOfWindowCount,
  resolveContextWindow,
  truncateToWindow,
} from './context-window.js';

function offering(recommended: number, max: number): Offering {
  // Only the `context` field is read by these helpers.
  return { context: { recommended, max } } as unknown as Offering;
}
function persona(contextWindow: number | null): PersonaRow {
  return { contextWindow } as unknown as PersonaRow;
}

describe('effectiveFloor / contextAdjustable', () => {
  it('caps the floor at the offering max', () => {
    expect(effectiveFloor(offering(50_000, 50_000))).toBe(50_000);
    expect(effectiveFloor(offering(200_000, 1_000_000))).toBe(CONTEXT_FLOOR);
  });
  it('is not adjustable when max is at or below the floor', () => {
    expect(contextAdjustable(offering(40_000, 40_000))).toBe(false);
    expect(contextAdjustable(offering(200_000, 1_000_000))).toBe(true);
  });
});

describe('resolveContextWindow', () => {
  it('uses recommended when persona override is null', () => {
    expect(resolveContextWindow(persona(null), offering(200_000, 1_000_000))).toBe(200_000);
  });
  it('clamps a persona override into [effectiveFloor, max]', () => {
    expect(resolveContextWindow(persona(10_000), offering(200_000, 1_000_000))).toBe(CONTEXT_FLOOR);
    expect(resolveContextWindow(persona(2_000_000), offering(200_000, 1_000_000))).toBe(1_000_000);
    expect(resolveContextWindow(persona(300_000), offering(200_000, 1_000_000))).toBe(300_000);
  });
});

describe('truncateToWindow', () => {
  const sys: WireMessage = { role: 'system', content: 'x'.repeat(400) }; // 100 tokens
  const u = (n: number): WireMessage => ({ role: 'user', content: 'x'.repeat(n * 4) }); // n tokens
  it('returns unchanged when within budget', () => {
    const msgs = [sys, u(10), u(10), u(5)];
    expect(truncateToWindow(msgs, 1000)).toEqual({ messages: msgs, trimmed: 0 });
  });
  it('drops oldest history first, keeping system + current', () => {
    const msgs = [sys, u(50), u(50), u(50), u(5)]; // total 255
    const res = truncateToWindow(msgs, 200); // must drop until <=200
    expect(res.trimmed).toBe(1);
    expect(res.messages[0]).toBe(sys);
    expect(res.messages[res.messages.length - 1]).toBe(msgs[4]);
  });
  it('never drops below system + current even if over budget', () => {
    const msgs = [sys, u(500)];
    expect(truncateToWindow(msgs, 10)).toEqual({ messages: msgs, trimmed: 0 });
  });
});

describe('outOfWindowCount', () => {
  it('counts the oldest messages that fall outside the window', () => {
    // budget 100, system 40 -> 60 remaining; messages newest-first 30,30,30
    expect(outOfWindowCount([30, 30, 30], 40, 100)).toBe(1);
  });
  it('keeps at least the newest message', () => {
    expect(outOfWindowCount([30, 30], 95, 100)).toBe(1);
  });
  it('returns 0 when everything fits', () => {
    expect(outOfWindowCount([10, 10, 10], 10, 1000)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm exec vitest run src/lib/context-window.test.ts`
Expected: FAIL — `context-window.js` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
// SPDX-License-Identifier: AGPL-3.0-only

import type { Offering, WireMessage } from '@chatsundere/llm-unified';
import type { PersonaRow } from '../boot/client-data-db.js';
import { estimateTokens } from './token-estimator.js';

/** Smallest selectable context window. Our system prompts are substantial and
 *  every integrated model ships a generous window, so 64k is a safe floor. */
export const CONTEXT_FLOOR = 65_536;
/** Slider granularity. */
export const CONTEXT_STEP = 4_096;

/** Effective floor for an offering — never above its own max. */
export function effectiveFloor(offering: Offering): number {
  return Math.min(CONTEXT_FLOOR, offering.context.max);
}

/** Whether the window is worth a slider (there is head-room above the floor). */
export function contextAdjustable(offering: Offering): boolean {
  return offering.context.max > effectiveFloor(offering);
}

/** Resolve the window a persona actually uses against an offering. */
export function resolveContextWindow(persona: PersonaRow, offering: Offering): number {
  const target = persona.contextWindow ?? offering.context.recommended;
  return Math.min(offering.context.max, Math.max(effectiveFloor(offering), target));
}

function wireTokens(m: WireMessage): number {
  return estimateTokens(typeof m.content === 'string' ? m.content : '');
}

/**
 * Drop the oldest history messages until the estimated token total fits the
 * budget. The system prompt (first) and the current user turn (last) are never
 * dropped. `trimmed` counts the history messages actually removed.
 */
export function truncateToWindow(
  messages: WireMessage[],
  budget: number,
): { messages: WireMessage[]; trimmed: number } {
  if (messages.length <= 2) return { messages, trimmed: 0 };
  const system = messages[0]!;
  const current = messages[messages.length - 1]!;
  const history = messages.slice(1, -1);
  let total = wireTokens(system) + wireTokens(current) + history.reduce((s, m) => s + wireTokens(m), 0);
  let start = 0;
  while (total > budget && start < history.length) {
    total -= wireTokens(history[start]!);
    start += 1;
  }
  return { messages: [system, ...history.slice(start), current], trimmed: start };
}

/**
 * Number of oldest messages outside the model's window, fitting messages
 * newest-first under (budget - systemTokens). At least the newest message is
 * always kept. Used to place the in-stream "out of memory" marker.
 */
export function outOfWindowCount(
  messageTokens: number[],
  systemTokens: number,
  budget: number,
): number {
  let remaining = budget - systemTokens;
  let kept = 0;
  for (let i = messageTokens.length - 1; i >= 0; i -= 1) {
    if (kept > 0 && remaining - (messageTokens[i] ?? 0) < 0) break;
    remaining -= messageTokens[i] ?? 0;
    kept += 1;
  }
  return messageTokens.length - kept;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm exec vitest run src/lib/context-window.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/context-window.ts apps/user-client/src/lib/context-window.test.ts
git commit -m "Add context-window helpers (resolve, truncate, out-of-window count)"
```

---

## Task 2: Dexie v10 — persona.contextWindow + personaAvatars table

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts`
- Modify: `apps/user-client/src/data/queryKeys.ts`
- Test: `apps/user-client/src/boot/client-data-db.migration-v10.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from './client-data-db.js';

describe('Dexie v10 migration', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('backfills personas.contextWindow=null and exposes personaAvatars', async () => {
    const db = await openClientDataDb();
    const id = crypto.randomUUID();
    await db.personas.add({
      id,
      name: 'Test',
      tagline: '',
      colour: '#fff',
      font: 'serif',
      instructions: 'hi',
      canonicalId: null,
      providerId: '',
      modelId: '',
      mindspaceId: null,
      aboutMeOverride: null,
      textureOverride: null,
      temperature: 0.85,
      adultPersona: false,
      chatsundereTonality: true,
      contextWindow: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const got = await db.personas.get(id);
    expect(got?.contextWindow).toBeNull();
    // personaAvatars table is usable
    await db.personaAvatars.put({
      personaId: id,
      blob: new Blob(['x'], { type: 'image/webp' }),
      mime: 'image/webp',
      width: 100,
      height: 100,
      crop: { x: 0, y: 0, zoom: 1 },
      updatedAt: Date.now(),
    });
    expect(await db.personaAvatars.get(id)).not.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm exec vitest run src/boot/client-data-db.migration-v10.test.ts`
Expected: FAIL — `personaAvatars` is not a property; `contextWindow` not on type.

- [ ] **Step 3: Implement schema changes**

In `client-data-db.ts`, add `contextWindow` to `PersonaRow` (after `chatsundereTonality`):

```ts
  chatsundereTonality: boolean;
  /** Per-persona context window in tokens. null = use the offering's recommended. */
  contextWindow: number | null;
  createdAt: number;
```

Add the avatar crop + row types (after the `PillRow` interface):

```ts
export interface AvatarCrop {
  /** Pan as a fraction of the display size; 0 = centred. */
  x: number;
  y: number;
  /** Cover-scale multiplier; 1 = cover the box exactly. */
  zoom: number;
}

export interface PersonaAvatarRow {
  personaId: string; // PK, 1:1 with a persona
  blob: Blob; // downscaled FULL image (not pre-cropped)
  mime: string;
  width: number; // natural width of the stored image
  height: number; // natural height of the stored image
  crop: AvatarCrop;
  updatedAt: number;
}
```

Add the table handle to the `ClientDataDb` class (after `pills!`):

```ts
  personaAvatars!: Table<PersonaAvatarRow, string>;
```

Add the v10 version block (after the v9 block, before the closing brace of the constructor):

```ts
    // Version 10 — persona-settings: per-persona context window + avatars.
    // personas gain a non-indexed `contextWindow` (backfilled null); a new
    // `personaAvatars` table holds the downscaled image + crop metadata.
    this.version(10)
      .stores({
        settings: 'id',
        providers: 'id, templateId, enabled',
        mindspaces: 'id, builtIn, displayName',
        personas: 'id, providerId',
        chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
        messages: 'id, chatId, [chatId+createdAt]',
        pills: 'id, messageId',
        personaAvatars: 'personaId',
      })
      .upgrade(async (tx) => {
        await tx
          .table('personas')
          .toCollection()
          .modify((p: Record<string, unknown>) => {
            p.contextWindow = null;
          });
      });
```

In `queryKeys.ts`, add to the `QK` object:

```ts
  personaAvatar: (id: string) => ['persona-avatar', id] as const,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm exec vitest run src/boot/client-data-db.migration-v10.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/boot/client-data-db.ts apps/user-client/src/data/queryKeys.ts apps/user-client/src/boot/client-data-db.migration-v10.test.ts
git commit -m "Add Dexie v10 — persona.contextWindow and personaAvatars table"
```

---

## Task 3: Default the contextWindow in the persona editor draft

**Files:**
- Modify: `apps/user-client/src/routes/app/persona-editor.tsx`

This unblocks Task 8 (the slider) by making `DraftPersona` carry the field. `DraftPersona` is `Omit<PersonaRow, 'id'|'createdAt'|'updatedAt'>`, so it now requires `contextWindow`.

- [ ] **Step 1: Add the default**

In `defaultDraft`, add to the returned object (after `chatsundereTonality: true,`):

```ts
    chatsundereTonality: true,
    contextWindow: null,
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS (no missing-property error on `DraftPersona`).

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/routes/app/persona-editor.tsx
git commit -m "Default persona draft contextWindow to null"
```

---

## Task 4: Wire truncation into the stream engine

**Files:**
- Modify: `apps/user-client/src/lib/stream-engine.ts`

The truncation logic is unit-tested in Task 1. This wires it in. The caller is unchanged because `runStreamEngine` already receives `persona` + `offering`.

- [ ] **Step 1: Add the import**

At the top of `stream-engine.ts`, alongside the other relative imports:

```ts
import { resolveContextWindow, truncateToWindow } from './context-window.js';
```

- [ ] **Step 2: Apply truncation before streaming**

Replace the `wireMessages` construction and the `streamCompletion` `messages:` argument so the budget-trimmed array is sent. After building `wireMessages` (the `const wireMessages: WireMessage[] = [...]` block), add:

```ts
  const budget = resolveContextWindow(args.persona, args.offering);
  const { messages: sentMessages } = truncateToWindow(wireMessages, budget);
```

Then change the `streamCompletion` call's `messages` field from `messages: wireMessages,` to:

```ts
    messages: sentMessages,
```

- [ ] **Step 3: Verify typecheck + existing engine behaviour**

Run: `pnpm typecheck`
Expected: PASS.
Run: `cd apps/user-client && pnpm exec vitest run src/lib/context-window.test.ts`
Expected: PASS (the trimming logic).

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/lib/stream-engine.ts
git commit -m "Truncate chat history to the persona's context window before streaming"
```

---

## Task 5: Retarget the gauge to the resolved window

**Files:**
- Modify: `apps/user-client/src/components/chat/InteractionMode.tsx`
- Test: `apps/user-client/src/components/chat/InteractionMode.test.tsx` (extend if present; otherwise create)

- [ ] **Step 1: Write/extend the failing test**

Add a test asserting the topbar receives the resolved window (clamped), not the raw recommended. If `InteractionMode.test.tsx` exists, add this case; otherwise create the file with a minimal render. Use a persona override below the floor to prove clamping:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InteractionMode } from './InteractionMode.js';
import type { Offering } from '@chatsundere/llm-unified';
import type { PersonaRow } from '../../boot/client-data-db.js';

// The gauge text is contextUtilisation(usedTokens, window). With usedTokens
// = window/2 the gauge must read 50% — proving `window` is the resolved value.
it('gauge uses the resolved context window (clamped), not raw recommended', () => {
  const offering = { context: { recommended: 200_000, max: 1_000_000 }, profile: { reasoning: 'none' } } as unknown as Offering;
  // override below the 64k floor -> resolves to 65_536
  const persona = { id: 'p', name: 'A', colour: '#fff', font: 'serif', contextWindow: 1_000, instructions: 'x', adultPersona: false, chatsundereTonality: true } as unknown as PersonaRow;
  render(
    <InteractionMode
      persona={persona}
      chat={null}
      offering={offering}
      usedTokens={32_768}
      draftValue=""
      onDraftChange={() => {}}
      onSend={() => {}}
      isStreamLive={false}
      onExit={() => {}}
      onRenameChat={() => {}}
      onOpenPersonaEditor={() => {}}
    />,
  );
  expect(screen.getByText('50%')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm exec vitest run src/components/chat/InteractionMode.test.tsx`
Expected: FAIL — gauge currently reads ~3% (usedTokens/recommended), not 50%.

- [ ] **Step 3: Implement**

In `InteractionMode.tsx` add the import:

```ts
import { resolveContextWindow } from '../../lib/context-window.js';
```

Change the `InteractionTopbar` prop from `contextWindow={p.offering.context.recommended}` to:

```ts
        contextWindow={resolveContextWindow(p.persona, p.offering)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm exec vitest run src/components/chat/InteractionMode.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/chat/InteractionMode.tsx apps/user-client/src/components/chat/InteractionMode.test.tsx
git commit -m "Gauge against the resolved per-persona context window"
```

---

## Task 6: In-stream "out of memory" marker

**Files:**
- Create: `apps/user-client/src/components/chat/ContextMemoryMarker.tsx`
- Modify: `apps/user-client/src/components/chat/ChatStream.tsx`
- Modify: `apps/user-client/src/routes/app/chat/chat-page.tsx`
- Test: `apps/user-client/src/components/chat/ChatStream.contextMarker.test.tsx`

- [ ] **Step 1: Create the marker component**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

/** Quiet inline marker: messages above this point are no longer in the model's
 *  context window. They remain in the DB and are still readable — the model
 *  simply does not see them on the next turn. */
export function ContextMemoryMarker(): JSX.Element {
  return (
    <div
      data-context-memory-marker
      className="my-3 flex items-center gap-2 px-3 text-[11px] uppercase tracking-wider text-paper-soft/60"
    >
      <span className="h-px flex-1 bg-white/10" />
      <span className="rounded bg-white/5 px-2 py-0.5 font-mono">
        Earlier messages are out of the model's memory
      </span>
      <span className="h-px flex-1 bg-white/10" />
    </div>
  );
}
```

- [ ] **Step 2: Write the failing test**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChatStream } from './ChatStream.js';
import type { MessageRow, PersonaRow } from '../../boot/client-data-db.js';

function msg(id: string, createdAt: number, text: string): MessageRow {
  return {
    id,
    chatId: 'c',
    role: 'user',
    contentBlocks: [{ type: 'text', text }],
    createdAt,
    bookmarked: false,
    streamingState: 'complete',
  };
}

it('shows the memory marker when oldest messages fall out of the window', () => {
  // three ~50-token messages, budget 120, system 40 -> only newest ~1 fits
  const messages = [msg('a', 1, 'x'.repeat(200)), msg('b', 2, 'x'.repeat(200)), msg('c', 3, 'x'.repeat(200))];
  render(
    <ChatStream
      chatId="c"
      messages={messages}
      pills={[]}
      persona={{ name: 'A', colour: '#fff', font: 'serif' } as unknown as PersonaRow}
      displayName="Chris"
      streamHandle={null}
      contextBudget={120}
      systemTokens={40}
    />,
  );
  expect(screen.getByText(/out of the model's memory/i)).toBeInTheDocument();
});

it('shows no marker when everything fits', () => {
  const messages = [msg('a', 1, 'hi'), msg('b', 2, 'there')];
  render(
    <ChatStream
      chatId="c"
      messages={messages}
      pills={[]}
      persona={{ name: 'A', colour: '#fff', font: 'serif' } as unknown as PersonaRow}
      displayName="Chris"
      streamHandle={null}
      contextBudget={100_000}
      systemTokens={10}
    />,
  );
  expect(screen.queryByText(/out of the model's memory/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/user-client && pnpm exec vitest run src/components/chat/ChatStream.contextMarker.test.tsx`
Expected: FAIL — `contextBudget`/`systemTokens` props do not exist; no marker rendered.

- [ ] **Step 4: Implement in ChatStream**

Add imports near the other lib imports:

```ts
import { outOfWindowCount } from '../../lib/context-window.js';
import { estimateTokens } from '../../lib/token-estimator.js';
import { ContextMemoryMarker } from './ContextMemoryMarker.js';
```

Extend `ChatStreamProps`:

```ts
  /** Resolved context window (tokens) for the marker. Undefined = no marker. */
  contextBudget?: number;
  /** Estimated system-prompt tokens, reserved before fitting history. */
  systemTokens?: number;
```

After `const sorted = [...p.messages].sort((a, b) => a.createdAt - b.createdAt);` add:

```ts
  const outCount =
    p.contextBudget != null
      ? outOfWindowCount(
          sorted.map((m) => estimateTokens(flattenAnswerText(m.contentBlocks))),
          p.systemTokens ?? 0,
          p.contextBudget,
        )
      : 0;
```

Inside the `sorted.map((m, i) => { ... })` render, immediately after the `<div key={m.id}>` opening tag (before `{sep}`), insert the marker for the boundary row:

```tsx
          <div key={m.id}>
            {i === outCount && outCount > 0 ? <ContextMemoryMarker /> : null}
            {sep}
```

- [ ] **Step 5: Wire the props from chat-page**

In `chat-page.tsx`, add the import:

```ts
import { resolveContextWindow } from '../../../lib/context-window.js';
```

Change the `usedTokens` memo to also expose `systemTokens`. Replace `const usedTokens = useMemo(() => { ... }, [...]);` so it returns an object, and read both:

```ts
  const { usedTokens, systemTokens } = useMemo(() => {
    if (!offering || !effectivePersona || !settingsQuery.data) return { usedTokens: 0, systemTokens: 0 };
    if (!effectivePersona.instructions.trim()) return { usedTokens: 0, systemTokens: 0 };
    const sys = buildPrompt(
      {
        tonalityEnabled: effectivePersona.chatsundereTonality,
        nsfwEnabled: effectivePersona.adultPersona,
        globalInstructions: settingsQuery.data.globalInstructions,
        aboutMe: effectivePersona.aboutMeOverride?.trim()
          ? effectivePersona.aboutMeOverride
          : settingsQuery.data.globalAboutMe,
        personaInstructions: effectivePersona.instructions,
        projectInstructions: '',
        memoryContext: '',
      },
      'chat',
    );
    const msgTexts = (chatQuery.data?.messages ?? []).map((m) =>
      m.contentBlocks
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join(''),
    );
    return { usedTokens: estimateTokens([sys, ...msgTexts]), systemTokens: estimateTokens(sys) };
  }, [offering, effectivePersona, settingsQuery.data, chatQuery.data?.messages]);

  const contextBudget = useMemo(
    () => (offering && effectivePersona ? resolveContextWindow(effectivePersona, offering) : undefined),
    [offering, effectivePersona],
  );
```

Pass the new props to `<ChatStream ...>` (in the chat-mode branch):

```tsx
          streamHandle={streamHandle}
          contextBudget={contextBudget}
          systemTokens={systemTokens}
          onRegenerate={onRegenerate}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/user-client && pnpm exec vitest run src/components/chat/ChatStream.contextMarker.test.tsx`
Expected: PASS.
Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/components/chat/ContextMemoryMarker.tsx apps/user-client/src/components/chat/ChatStream.tsx apps/user-client/src/components/chat/ChatStream.contextMarker.test.tsx apps/user-client/src/routes/app/chat/chat-page.tsx
git commit -m "Show an in-stream marker when earlier messages leave the context window"
```

---

## Task 7: Context-window slider in the persona editor

**Files:**
- Modify: `apps/user-client/src/routes/app/persona-editor.tsx`
- Test: `apps/user-client/src/routes/app/persona-editor.contextSlider.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ContextWindowControl } from './persona-editor.js';
import type { Offering } from '@chatsundere/llm-unified';

const offering = { context: { recommended: 200_000, max: 1_000_000 } } as unknown as Offering;

it('disables and labels the control when the model has no head-room', () => {
  const fixed = { context: { recommended: 64_000, max: 64_000 } } as unknown as Offering;
  render(<ContextWindowControl offering={fixed} value={null} onChange={() => {}} />);
  expect(screen.getByRole('slider')).toBeDisabled();
});

it('shows the resolved value and a Use-default reset', () => {
  const onChange = vi.fn();
  render(<ContextWindowControl offering={offering} value={300_000} onChange={onChange} />);
  expect(screen.getByText(/300,000 tokens/)).toBeInTheDocument();
  screen.getByRole('button', { name: /use default/i }).click();
  expect(onChange).toHaveBeenCalledWith(null);
});
```

Add `import { vi } from 'vitest';` to the test imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm exec vitest run src/routes/app/persona-editor.contextSlider.test.tsx`
Expected: FAIL — `ContextWindowControl` is not exported.

- [ ] **Step 3: Implement the control**

In `persona-editor.tsx`, add imports:

```ts
import { CONTEXT_STEP, contextAdjustable, effectiveFloor, resolveContextWindow } from '../../lib/context-window.js';
import { getOffering } from '@chatsundere/llm-unified';
```

Add the exported component (near the other helper components at the bottom of the file):

```tsx
/**
 * Context-window slider. Green from the floor to the offering's recommended
 * window, red from recommended to max (higher = costlier/slower/often weaker).
 * `value` is the persona's override (null = recommended). Emits null on reset.
 */
export function ContextWindowControl({
  offering,
  value,
  onChange,
}: {
  offering: Offering;
  value: number | null;
  onChange: (next: number | null) => void;
}): JSX.Element {
  const floor = effectiveFloor(offering);
  const { max, recommended } = offering.context;
  const adjustable = contextAdjustable(offering);
  const resolved = resolveContextWindow({ contextWindow: value } as PersonaRow, offering);
  const recFraction = max > floor ? ((recommended - floor) / (max - floor)) * 100 : 100;
  const inRed = resolved > recommended;

  return (
    <div className="mt-4">
      <div className="mb-1 flex items-center justify-between">
        <label htmlFor="persona-context" className="text-xs uppercase tracking-widest text-paper-soft">
          Context window
        </label>
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={value === null}
          className="text-[11px] uppercase tracking-wider text-paper-soft hover:text-paper disabled:opacity-40"
        >
          Use default
        </button>
      </div>
      <div
        aria-hidden
        className="mb-2 h-1.5 w-full rounded-full"
        style={{
          background: `linear-gradient(to right, #6aa97a 0%, #6aa97a ${recFraction}%, #b33a5e ${recFraction}%, #b33a5e 100%)`,
        }}
      />
      <div className="flex items-center gap-3">
        <input
          id="persona-context"
          type="range"
          min={floor}
          max={max}
          step={CONTEXT_STEP}
          value={resolved}
          disabled={!adjustable}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 disabled:opacity-40"
        />
        <span className="w-28 text-right font-mono text-sm text-paper">
          {resolved.toLocaleString()} tokens
        </span>
      </div>
      <p className="mt-1 text-[11px] text-paper-soft">
        {!adjustable
          ? "This model's context window isn't adjustable."
          : inRed
            ? 'Above the recommended window — higher is costlier, slower, and often weaker.'
            : `Default ${recommended.toLocaleString()}. Lower trims cost; the red zone goes up to the model maximum.`}
      </p>
    </div>
  );
}
```

Inside the **Behavior** `AccordionCard` (after the Adult-Persona toggle block, before the closing `</AccordionCard>`), render the control when an offering resolves:

```tsx
        {(() => {
          const prov = providers.data?.find((pr) => pr.id === draft.providerId);
          const off = prov && draft.modelId ? getOffering(prov.templateId, draft.modelId) : undefined;
          return off ? (
            <ContextWindowControl
              offering={off}
              value={draft.contextWindow}
              onChange={(n) => patch({ contextWindow: n })}
            />
          ) : null;
        })()}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm exec vitest run src/routes/app/persona-editor.contextSlider.test.tsx`
Expected: PASS.
Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/app/persona-editor.tsx apps/user-client/src/routes/app/persona-editor.contextSlider.test.tsx
git commit -m "Add per-persona context-window slider with green/red zones and reset"
```

---

## Task 8: Avatar crop maths (pure)

**Files:**
- Create: `apps/user-client/src/lib/avatar-crop.ts`
- Test: `apps/user-client/src/lib/avatar-crop.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { cropToBackground, fitDimensions } from './avatar-crop.js';

describe('fitDimensions', () => {
  it('leaves small images untouched', () => {
    expect(fitDimensions(300, 200, 512)).toEqual({ width: 300, height: 200 });
  });
  it('scales the longest edge down to max, preserving aspect', () => {
    expect(fitDimensions(2048, 1024, 512)).toEqual({ width: 512, height: 256 });
    expect(fitDimensions(1000, 2000, 512)).toEqual({ width: 256, height: 512 });
  });
});

describe('cropToBackground', () => {
  it('covers a square box and centres a square image at zoom 1', () => {
    const bg = cropToBackground(100, 100, { x: 0, y: 0, zoom: 1 }, 200);
    expect(bg.backgroundSize).toBe('200px 200px');
    expect(bg.backgroundPosition).toBe('0px 0px');
  });
  it('applies zoom and fractional pan', () => {
    const bg = cropToBackground(100, 100, { x: 0.25, y: -0.25, zoom: 2 }, 200);
    // coverScale 2, *zoom 2 => 4 => 400px; centre offset (200-400)/2 = -100
    // pan x: +0.25*200 = +50 -> -50 ; pan y: -0.25*200 = -50 -> -150
    expect(bg.backgroundSize).toBe('400px 400px');
    expect(bg.backgroundPosition).toBe('-50px -150px');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm exec vitest run src/lib/avatar-crop.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// SPDX-License-Identifier: AGPL-3.0-only

import type { AvatarCrop } from '../boot/client-data-db.js';

/** Downscale dimensions so the longest edge is at most `max`, preserving aspect. */
export function fitDimensions(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * CSS background props that reproduce a crop inside a square box of `size` px.
 * Model: cover the box, multiply by `zoom`, then pan by a fraction of `size`.
 */
export function cropToBackground(
  naturalWidth: number,
  naturalHeight: number,
  crop: AvatarCrop,
  size: number,
): { backgroundSize: string; backgroundPosition: string } {
  const coverScale = Math.max(size / naturalWidth, size / naturalHeight);
  const scale = coverScale * crop.zoom;
  const bgW = naturalWidth * scale;
  const bgH = naturalHeight * scale;
  const bgX = (size - bgW) / 2 + crop.x * size;
  const bgY = (size - bgH) / 2 + crop.y * size;
  return {
    backgroundSize: `${bgW}px ${bgH}px`,
    backgroundPosition: `${bgX}px ${bgY}px`,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm exec vitest run src/lib/avatar-crop.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/avatar-crop.ts apps/user-client/src/lib/avatar-crop.test.ts
git commit -m "Add pure avatar crop maths (fit dimensions, crop-to-CSS)"
```

---

## Task 9: Image normalisation (downscale to WebP)

**Files:**
- Create: `apps/user-client/src/lib/avatar-normalise.ts`

The canvas encode cannot run under jsdom, so this task ships the function (covered by manual verification §9 of the spec); `fitDimensions` it relies on is already tested in Task 8.

- [ ] **Step 1: Implement**

```ts
// SPDX-License-Identifier: AGPL-3.0-only

import { fitDimensions } from './avatar-crop.js';

export const AVATAR_MAX_EDGE = 512;
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

export interface NormalisedImage {
  blob: Blob;
  mime: 'image/webp';
  width: number;
  height: number;
}

/**
 * Decode a picked image file, downscale its longest edge to AVATAR_MAX_EDGE,
 * and re-encode as WebP. Rejects files over AVATAR_MAX_BYTES or that fail to
 * decode. Browser-only (uses Image + canvas).
 */
export async function normaliseAvatar(file: File): Promise<NormalisedImage> {
  if (file.size > AVATAR_MAX_BYTES) {
    throw new Error('That image is over 5 MB — please pick a smaller one.');
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const { width, height } = fitDimensions(img.naturalWidth, img.naturalHeight, AVATAR_MAX_EDGE);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not process the image — canvas unavailable.');
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/webp', 0.9),
    );
    if (!blob) throw new Error('Could not encode the image.');
    return { blob, mime: 'image/webp', width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That file couldn't be read as an image."));
    img.src = src;
  });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/lib/avatar-normalise.ts
git commit -m "Add avatar image normalisation (downscale to 512px WebP)"
```

---

## Task 10: Avatar data hooks + cascade delete

**Files:**
- Create: `apps/user-client/src/data/persona-avatars.ts`
- Modify: `apps/user-client/src/data/personas.ts`
- Test: `apps/user-client/src/data/persona-avatars.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, getClientDataDb, openClientDataDb } from '../boot/client-data-db.js';
import { useRemovePersonaAvatar, useSetPersonaAvatar, usePersonaAvatar } from './persona-avatars.js';
import { useDeletePersona } from './personas.js';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('persona avatars', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('set, read, and remove an avatar', async () => {
    const w = wrapper();
    const set = renderHook(() => useSetPersonaAvatar(), { wrapper: w });
    await set.result.current.mutateAsync({
      personaId: 'p1',
      blob: new Blob(['x'], { type: 'image/webp' }),
      mime: 'image/webp',
      width: 100,
      height: 100,
      crop: { x: 0, y: 0, zoom: 1 },
    });
    const read = renderHook(() => usePersonaAvatar('p1'), { wrapper: w });
    await waitFor(() => expect(read.result.current.data).not.toBeNull());

    const rem = renderHook(() => useRemovePersonaAvatar(), { wrapper: w });
    await rem.result.current.mutateAsync('p1');
    expect(await getClientDataDb().personaAvatars.get('p1')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm exec vitest run src/data/persona-avatars.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hooks**

```ts
// SPDX-License-Identifier: AGPL-3.0-only

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type AvatarCrop, type PersonaAvatarRow, getClientDataDb } from '../boot/client-data-db.js';
import { QK } from './queryKeys.js';

/** Read a persona's avatar row, or null when none is set. */
export function usePersonaAvatar(personaId: string | null) {
  return useQuery({
    queryKey: personaId ? QK.personaAvatar(personaId) : ['persona-avatar', '__none'],
    enabled: personaId !== null,
    queryFn: async () => {
      if (!personaId) return null;
      return (await getClientDataDb().personaAvatars.get(personaId)) ?? null;
    },
  });
}

export interface SetAvatarArgs {
  personaId: string;
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  crop: AvatarCrop;
}

/** Create or replace a persona's avatar. */
export function useSetPersonaAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: SetAvatarArgs) => {
      const row: PersonaAvatarRow = { ...args, updatedAt: Date.now() };
      await getClientDataDb().personaAvatars.put(row);
    },
    onSuccess: (_v, args) => qc.invalidateQueries({ queryKey: QK.personaAvatar(args.personaId) }),
  });
}

/** Remove a persona's avatar (back to the monogram). */
export function useRemovePersonaAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (personaId: string) => {
      await getClientDataDb().personaAvatars.delete(personaId);
    },
    onSuccess: (_v, personaId) => qc.invalidateQueries({ queryKey: QK.personaAvatar(personaId) }),
  });
}
```

In `personas.ts`, extend `useDeletePersona`'s transaction to cascade-delete the avatar. Add `db.personaAvatars` to the transaction tables and delete the row:

```ts
      await db.transaction('rw', db.personas, db.chats, db.messages, db.pills, db.personaAvatars, async () => {
```

and, just before `await db.personas.delete(id);`:

```ts
        await db.personaAvatars.delete(id);
        await db.personas.delete(id);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm exec vitest run src/data/persona-avatars.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/data/persona-avatars.ts apps/user-client/src/data/personas.ts apps/user-client/src/data/persona-avatars.test.ts
git commit -m "Add persona-avatar data hooks and cascade-delete with persona"
```

---

## Task 11: PersonaAvatar display component

**Files:**
- Create: `apps/user-client/src/components/PersonaAvatar.tsx`
- Test: `apps/user-client/src/components/PersonaAvatar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../boot/client-data-db.js';
import { PersonaAvatar } from './PersonaAvatar.js';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('PersonaAvatar', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('renders the monogram when no avatar is set', async () => {
    render(<PersonaAvatar personaId="p1" name="Aria Vale" colour="#fff" size={48} />, {
      wrapper: wrapper(),
    });
    expect(await screen.findByText('AV')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm exec vitest run src/components/PersonaAvatar.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from 'react';
import { usePersonaAvatar } from '../data/persona-avatars.js';
import { cropToBackground } from '../lib/avatar-crop.js';
import { monogramFor } from '../lib/monogram.js';

/**
 * Rounded-square persona avatar. Renders the stored image (CSS-cropped) when
 * present, otherwise the monogram tile — identical look to the legacy tile so
 * personas without an image are unchanged.
 */
export function PersonaAvatar({
  personaId,
  name,
  colour,
  size,
}: {
  personaId: string;
  name: string;
  colour: string;
  size: number;
}): JSX.Element {
  const { data } = usePersonaAvatar(personaId);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!data?.blob) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(data.blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [data?.blob]);

  if (url && data) {
    const bg = cropToBackground(data.width, data.height, data.crop, size);
    return (
      <div
        data-persona-avatar
        aria-label={`${name} avatar`}
        className="shrink-0 overflow-hidden rounded-md bg-cover bg-center"
        style={{
          width: size,
          height: size,
          backgroundImage: `url(${url})`,
          backgroundSize: bg.backgroundSize,
          backgroundPosition: bg.backgroundPosition,
          backgroundRepeat: 'no-repeat',
        }}
      />
    );
  }

  return (
    <div
      data-persona-avatar
      className="grid shrink-0 place-items-center rounded-md font-display"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `${colour}1f`,
        color: colour,
        border: `1px solid ${colour}33`,
      }}
    >
      {monogramFor(name)}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm exec vitest run src/components/PersonaAvatar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/PersonaAvatar.tsx apps/user-client/src/components/PersonaAvatar.test.tsx
git commit -m "Add PersonaAvatar component with CSS crop and monogram fallback"
```

---

## Task 12: Avatar crop modal (CSS-based)

**Files:**
- Create: `apps/user-client/src/components/AvatarCropModal.tsx`
- Test: `apps/user-client/src/components/AvatarCropModal.test.tsx`

The modal previews via the same CSS crop as the display — no canvas. It receives an already-normalised image (object URL + natural dims) and emits the final crop.

- [ ] **Step 1: Write the failing test**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AvatarCropModal } from './AvatarCropModal.js';

it('emits the current crop on confirm', () => {
  const onConfirm = vi.fn();
  render(
    <AvatarCropModal
      imageUrl="blob:fake"
      naturalWidth={400}
      naturalHeight={400}
      initialCrop={{ x: 0, y: 0, zoom: 1 }}
      onConfirm={onConfirm}
      onCancel={() => {}}
    />,
  );
  const zoom = screen.getByRole('slider', { name: /zoom/i });
  fireEvent.change(zoom, { target: { value: '1.5' } });
  screen.getByRole('button', { name: /save/i }).click();
  expect(onConfirm).toHaveBeenCalledWith({ x: 0, y: 0, zoom: 1.5 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm exec vitest run src/components/AvatarCropModal.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { useRef, useState } from 'react';
import type { AvatarCrop } from '../boot/client-data-db.js';
import { cropToBackground } from '../lib/avatar-crop.js';

const BOX = 280;

/**
 * Rounded-square crop window. Drag to pan, slider to zoom. Operates purely on
 * CSS background (the same maths the display uses), so the preview is exact.
 */
export function AvatarCropModal({
  imageUrl,
  naturalWidth,
  naturalHeight,
  initialCrop,
  onConfirm,
  onCancel,
}: {
  imageUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  initialCrop: AvatarCrop;
  onConfirm: (crop: AvatarCrop) => void;
  onCancel: () => void;
}): JSX.Element {
  const [crop, setCrop] = useState<AvatarCrop>(initialCrop);
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  const bg = cropToBackground(naturalWidth, naturalHeight, crop, BOX);

  function onPointerDown(e: React.PointerEvent): void {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: crop.x, baseY: crop.y };
  }
  function onPointerMove(e: React.PointerEvent): void {
    const d = dragRef.current;
    if (!d) return;
    setCrop((c) => ({
      ...c,
      x: d.baseX + (e.clientX - d.startX) / BOX,
      y: d.baseY + (e.clientY - d.startY) / BOX,
    }));
  }
  function onPointerUp(): void {
    dragRef.current = null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" data-avatar-crop-modal>
      <div className="w-full max-w-sm rounded-t-2xl bg-ink p-4 sm:rounded-2xl">
        <h2 className="mb-3 text-center font-display text-sm text-paper">Position your avatar</h2>
        <div className="mx-auto select-none touch-none">
          <div
            className="mx-auto overflow-hidden rounded-2xl border border-white/15 bg-black/40"
            style={{
              width: BOX,
              height: BOX,
              backgroundImage: `url(${imageUrl})`,
              backgroundSize: bg.backgroundSize,
              backgroundPosition: bg.backgroundPosition,
              backgroundRepeat: 'no-repeat',
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
        </div>
        <label className="mt-4 block text-xs uppercase tracking-widest text-paper-soft" htmlFor="avatar-zoom">
          Zoom
        </label>
        <input
          id="avatar-zoom"
          aria-label="Zoom"
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={crop.zoom}
          onChange={(e) => setCrop((c) => ({ ...c, zoom: Number(e.target.value) }))}
          className="w-full"
        />
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-md border border-paper-soft/30 px-3 py-2 text-xs uppercase tracking-wider text-paper-soft"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(crop)}
            className="flex-1 rounded-md border border-paper bg-paper/20 px-3 py-2 text-xs uppercase tracking-wider text-paper"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
```

> Note: if `bg-ink` is not an existing Tailwind token, use `bg-[#0a0a0a]`. Check `tailwind.config`/`index.css` for the project's surface token and match the existing modal/sheet styling (e.g. `BranchSheet.tsx`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm exec vitest run src/components/AvatarCropModal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/AvatarCropModal.tsx apps/user-client/src/components/AvatarCropModal.test.tsx
git commit -m "Add rounded-square avatar crop modal (CSS pan/zoom)"
```

---

## Task 13: Show the avatar in PersonaCard and the chat top-bar

**Files:**
- Modify: `apps/user-client/src/components/PersonaCard.tsx`
- Modify: `apps/user-client/src/components/chat/InteractionTopbar.tsx`

- [ ] **Step 1: PersonaCard**

Add the import:

```ts
import { PersonaAvatar } from './PersonaAvatar.js';
```

Replace the monogram tile (the `<div className="grid h-12 w-12 ...">{monogram}</div>` block) with:

```tsx
        <PersonaAvatar personaId={persona.id} name={persona.name} colour={persona.colour} size={48} />
```

Remove the now-unused `const monogram = monogramFor(persona.name);` line and the `monogramFor` import if no longer referenced (run typecheck to confirm).

- [ ] **Step 2: InteractionTopbar**

Add the import:

```ts
import { PersonaAvatar } from '../PersonaAvatar.js';
```

At the start of the `topbar-center` div (before the `{p.chat ? ... }` title block), add a small avatar:

```tsx
      <div className="topbar-center">
        <PersonaAvatar personaId={p.persona.id} name={p.persona.name} colour={p.persona.colour} size={28} />
```

> If the topbar layout breaks (it is a 3-column flex), wrap the avatar + title in a small flex row, or place the avatar in `topbar-left` after the hamburger instead. Match the existing topbar styling; keep it compact (mobile-first).

- [ ] **Step 3: Verify**

Run: `pnpm typecheck`
Expected: PASS.
Run: `cd apps/user-client && pnpm exec vitest run src/components/PersonaAvatar.test.tsx`
Expected: PASS (sanity that the component still mounts).

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/components/PersonaCard.tsx apps/user-client/src/components/chat/InteractionTopbar.tsx
git commit -m "Show persona avatar in My Circle cards and the chat top-bar"
```

---

## Task 14: Avatar control in the persona editor (pick → crop → save-on-persist)

**Files:**
- Modify: `apps/user-client/src/routes/app/persona-editor.tsx`
- Test: `apps/user-client/src/routes/app/persona-editor.avatar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AvatarField } from './persona-editor.js';

it('renders an avatar field with a change affordance', () => {
  render(
    <AvatarField
      personaId="p1"
      name="Aria"
      colour="#fff"
      pending={null}
      onPick={() => {}}
      onRemove={() => {}}
    />,
  );
  expect(screen.getByRole('button', { name: /change avatar/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm exec vitest run src/routes/app/persona-editor.avatar.test.tsx`
Expected: FAIL — `AvatarField` not exported.

- [ ] **Step 3: Implement the field + wire the save flow**

Add imports to `persona-editor.tsx`:

```ts
import { useRef as useReactRef } from 'react';
import { AvatarCropModal } from '../../components/AvatarCropModal.js';
import { PersonaAvatar } from '../../components/PersonaAvatar.js';
import type { AvatarCrop } from '../../boot/client-data-db.js';
import { useRemovePersonaAvatar, useSetPersonaAvatar } from '../../data/persona-avatars.js';
import { normaliseAvatar } from '../../lib/avatar-normalise.js';
import { toastStore } from '../../state/toast.store.js';
```

Define the pending-avatar type and the presentational field component (exported for the test):

```tsx
export type PendingAvatar =
  | { blob: Blob; mime: string; width: number; height: number; crop: AvatarCrop }
  | 'remove'
  | null;

export function AvatarField({
  personaId,
  name,
  colour,
  pending,
  onPick,
  onRemove,
}: {
  personaId: string | null;
  name: string;
  colour: string;
  pending: PendingAvatar;
  onPick: (file: File) => void;
  onRemove: () => void;
}): JSX.Element {
  const inputRef = useReactRef<HTMLInputElement>(null);
  const previewUrl = pending && pending !== 'remove' ? URL.createObjectURL(pending.blob) : null;
  return (
    <div className="mb-3 flex items-center gap-3">
      {previewUrl ? (
        <div
          className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-cover bg-center"
          style={{ backgroundImage: `url(${previewUrl})` }}
          data-avatar-preview
        />
      ) : pending === 'remove' || !personaId ? (
        <div
          className="grid h-12 w-12 shrink-0 place-items-center rounded-md font-display"
          style={{ background: `${colour}1f`, color: colour, border: `1px solid ${colour}33` }}
        >
          {name.trim().slice(0, 2).toUpperCase() || '??'}
        </div>
      ) : (
        <PersonaAvatar personaId={personaId} name={name} colour={colour} size={48} />
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        aria-label="Change avatar"
        onClick={() => inputRef.current?.click()}
        className="rounded-md border border-paper-soft/30 px-3 py-1 text-xs uppercase tracking-wider text-paper-soft hover:text-paper"
      >
        Change avatar
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="text-[11px] uppercase tracking-wider text-paper-soft hover:text-paper"
      >
        Remove
      </button>
    </div>
  );
}
```

In the `PersonaEditor` component body, add state + handlers (near the other `useState` hooks):

```ts
  const setAvatarMut = useSetPersonaAvatar();
  const removeAvatarMut = useRemovePersonaAvatar();
  const [pendingAvatar, setPendingAvatar] = useState<PendingAvatar>(null);
  const [cropState, setCropState] = useState<{
    url: string;
    width: number;
    height: number;
    blob: Blob;
    mime: string;
  } | null>(null);

  async function onPickAvatar(file: File): Promise<void> {
    try {
      const n = await normaliseAvatar(file);
      setCropState({ url: URL.createObjectURL(n.blob), width: n.width, height: n.height, blob: n.blob, mime: n.mime });
    } catch (e) {
      toastStore.show({ message: (e as Error).message, tone: 'warn', durationMs: 3500 });
    }
  }
```

Render the field inside the **Identity** `<section>` (after the tagline input, before the section closes):

```tsx
        <div className="mt-3">
          <div className="mb-2 text-xs uppercase tracking-widest text-paper-soft">Avatar</div>
          <AvatarField
            personaId={isCreate ? null : (id ?? null)}
            name={draft.name || 'New Persona'}
            colour={draft.colour}
            pending={pendingAvatar}
            onPick={(f) => {
              setIsDirty(true);
              void onPickAvatar(f);
            }}
            onRemove={() => {
              setIsDirty(true);
              setPendingAvatar('remove');
            }}
          />
        </div>
```

Render the crop modal at the end of the editor's returned JSX (before the final `</section>`):

```tsx
      {cropState ? (
        <AvatarCropModal
          imageUrl={cropState.url}
          naturalWidth={cropState.width}
          naturalHeight={cropState.height}
          initialCrop={{ x: 0, y: 0, zoom: 1 }}
          onCancel={() => {
            URL.revokeObjectURL(cropState.url);
            setCropState(null);
          }}
          onConfirm={(crop) => {
            setPendingAvatar({
              blob: cropState.blob,
              mime: cropState.mime,
              width: cropState.width,
              height: cropState.height,
              crop,
            });
            URL.revokeObjectURL(cropState.url);
            setCropState(null);
          }}
        />
      ) : null}
```

Extend `persistDraft` to flush the pending avatar after the persona id is known. Replace the existing `persistDraft` body with:

```ts
  async function persistDraft() {
    let pid: string | undefined = id;
    if (isCreate) {
      const row = await create.mutateAsync(draft);
      pid = row.id;
    } else if (id) {
      await update.mutateAsync({ id, patch: draft });
    }
    if (pid && pendingAvatar) {
      if (pendingAvatar === 'remove') {
        await removeAvatarMut.mutateAsync(pid);
      } else {
        await setAvatarMut.mutateAsync({ personaId: pid, ...pendingAvatar });
      }
      setPendingAvatar(null);
    }
    setIsDirty(false);
  }
```

> Note: `create.mutateAsync` already returns the new `PersonaRow` (see `useCreatePersona`), so `row.id` is the freshly-generated id.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm exec vitest run src/routes/app/persona-editor.avatar.test.tsx`
Expected: PASS.
Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/app/persona-editor.tsx apps/user-client/src/routes/app/persona-editor.avatar.test.tsx
git commit -m "Add avatar pick/crop control to the persona editor, saved on persist"
```

---

## Task 15: Disabled substitute-vision-model placeholder in My Settings

**Files:**
- Modify: `apps/user-client/src/routes/app/settings.tsx`
- Test: `apps/user-client/src/routes/app/settings.visionPlaceholder.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SubstituteVisionPlaceholder } from './settings.js';

it('renders a disabled, honest placeholder', () => {
  render(<SubstituteVisionPlaceholder />);
  expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /choose substitute model/i })).toBeDisabled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm exec vitest run src/routes/app/settings.visionPlaceholder.test.tsx`
Expected: FAIL — `SubstituteVisionPlaceholder` not exported.

- [ ] **Step 3: Implement**

In `settings.tsx`, add the exported component (near the other section components, e.g. above `ProvidersSection`):

```tsx
/**
 * Honest placeholder (disabled over hidden): when models without vision can't
 * read attached images, a substitute vision model will describe them. Dormant
 * until the image-attachment subsystem lands. No persistence, no picker yet.
 */
export function SubstituteVisionPlaceholder(): JSX.Element {
  return (
    <div className="opacity-60">
      <p className="mb-3 text-[11px] text-paper-soft">
        Route screenshots and images through a vision-capable model, so a chat model that
        can't see images on its own can still read them. One global choice for all personas.
      </p>
      <button
        type="button"
        disabled
        title="Activates once image attachments arrive (coming soon)"
        className="rounded-md border border-paper-soft/20 px-3 py-2 text-xs uppercase tracking-wider text-paper-soft/40"
      >
        Choose substitute model
      </button>
      <p className="mt-2 text-[11px] text-paper-soft">Activates once image attachments arrive (coming soon).</p>
    </div>
  );
}
```

Render it in a new `AccordionCard` placed right after the **Upstream Providers** card:

```tsx
      <AccordionCard
        icon="◫"
        label="Image understanding"
        meta="For models without vision"
      >
        <SubstituteVisionPlaceholder />
      </AccordionCard>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm exec vitest run src/routes/app/settings.visionPlaceholder.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/app/settings.tsx apps/user-client/src/routes/app/settings.visionPlaceholder.test.tsx
git commit -m "Add disabled substitute-vision-model placeholder in My Settings"
```

---

## Task 16: Final verification

- [ ] **Step 1: Typecheck (the CI gate)**

Run: `pnpm typecheck`
Expected: 13/13 packages pass.

- [ ] **Step 2: Full user-client test suite**

Run: `cd apps/user-client && pnpm exec vitest run`
Expected: all new tests pass; the only failures are the **pre-existing** `cockpit-draft` / `chat-page` / `chat-route` localStorage-jsdom baseline. If any other test fails, fix it before proceeding. Verify the baseline is unchanged by checking out master in the main checkout if in doubt — do NOT switch branches in this worktree.

- [ ] **Step 3: Build**

Run: `pnpm --filter @chatsundere/user-client run build`
Expected: clean build.

- [ ] **Step 4: Report**

Report measured results (typecheck count, vitest pass/fail with the baseline named, build status). Do not claim success without the command output.

---

## Self-review notes (author)

- **Spec coverage:** F1 → Tasks 1,3,4,5,6,7; F2 → Tasks 2,8,9,10,11,12,13,14; F3 → Task 15; migration → Task 2; tests throughout; final gate → Task 16.
- **Type consistency:** `AvatarCrop` defined in Task 2, used in Tasks 8/10/11/12/14. `PendingAvatar` defined and consumed in Task 14. `SetAvatarArgs` in Task 10 matches the `setAvatarMut.mutateAsync({ personaId, ...pendingAvatar })` call in Task 14. `contextWindow` added to `PersonaRow` (Task 2), defaulted (Task 3), read by `resolveContextWindow` (Task 1).
- **Known canvas gap:** `normaliseAvatar` (Task 9) and the modal's drag (Task 12) are exercised by manual verification (spec §9); their pure maths are unit-tested (Task 8).
- **Larissa:** not required (client-only).
