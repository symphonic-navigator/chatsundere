# Desktop UI Iteration 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three `lg`-gated desktop refinements to the user-client chat — a 896 px column, left-aligned user-message bubbles, and a permanently open cockpit — plus the §5.6 broken-model repair, per `superpowers/specs/2026-07-18-desktop-ui-iteration-design.md` (read it first; it is the authority on intent).

**Architecture:** A new derived-state module (`useIsDesktop` / `useEffectiveChatMode`) makes desktop force interaction+pinned semantics at read time without ever writing the store. Every behavioural consumer of `isInteractionMode` / `isPinned` switches to the effective hook. Width and bubbles are CSS-only. The `InteractionMode` mount guard drops its `offering` condition so the topbar survives a broken model (cockpit still requires an offering).

**Tech Stack:** React 18, Zustand (existing store untouched), Tailwind v4 + plain CSS in `index.css`, Vitest + @testing-library/react (jsdom), TypeScript strict.

## Global Constraints

- Everything in the repo is **British English** (code, comments, commit messages, test names).
- TypeScript `strict` + `noUncheckedIndexedAccess`; **no non-null assertions (`!`)** — Biome bans them repo-wide. No `any` without an inline comment explaining why.
- Comments explain non-obvious *why*, never *what*. New files start with `// SPDX-License-Identifier: AGPL-3.0-only`.
- Every exported function gets at least a one-line JSDoc.
- The single breakpoint is `lg` = 1024 px. Do not introduce any other breakpoint.
- The Zustand store `current-chat.store.ts` is **not modified** in any task.
- Mobile behaviour is unchanged except the Task 5 broken-model repair (spec §1/§5.6).
- Work in a dedicated git worktree on branch `feat/desktop-ui-iteration-1` (see Execution notes). **Never merge, push, or switch branches.**
- Commit messages: free-form imperative, capitalised subject, no Conventional-Commits prefix. End every commit message with:
  `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`
- All commands below run from `/home/chris/workspace/chatsundere` unless a `cd` is shown. Vitest runs from `apps/user-client`.
- Full-suite baseline: the user-client vitest suite has **exactly 8** known environmental failures (Node localStorage). 8 = clean; a 9th failure is real.

## Execution notes (read before Task 1)

1. Create the worktree (from the main tree, which stays on `master`):
   ```bash
   git -C /home/chris/workspace/chatsundere worktree add .claude/worktrees/desktop-ui-iteration-1 -b feat/desktop-ui-iteration-1
   cd /home/chris/workspace/chatsundere/.claude/worktrees/desktop-ui-iteration-1
   pnpm install
   ```
   All file paths in tasks are repo-relative; resolve them against the **worktree** root.
2. After the last task, verify every commit landed on `feat/desktop-ui-iteration-1` (`git branch --contains <sha>`). Do not squash, merge, or push — Liz does that after review.

---

### Task 1: Effective chat-mode module

**Files:**
- Create: `apps/user-client/src/state/effective-chat-mode.ts`
- Test: `apps/user-client/tests/state/effective-chat-mode.test.ts`

**Interfaces:**
- Consumes: `useCurrentChatStore` from `apps/user-client/src/state/current-chat.store.ts` (fields `isInteractionMode: boolean`, `isPinned: boolean`; action `reset()`).
- Produces (later tasks import exactly these):
  - `DESKTOP_MEDIA_QUERY: string` (value `'(min-width: 1024px)'`)
  - `useIsDesktop(): boolean`
  - `useEffectiveChatMode(): { isInteractionMode: boolean; isPinned: boolean }`

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/state/effective-chat-mode.test.ts`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useCurrentChatStore } from '../../src/state/current-chat.store.js';
import {
  DESKTOP_MEDIA_QUERY,
  useEffectiveChatMode,
  useIsDesktop,
} from '../../src/state/effective-chat-mode.js';

type ChangeListener = () => void;

/** Replaces window.matchMedia with a controllable stub; returns a flip switch. */
function installMatchMedia(initialMatches: boolean): { setMatches: (next: boolean) => void } {
  const listeners = new Set<ChangeListener>();
  let matches = initialMatches;
  const mql = {
    get matches() {
      return matches;
    },
    media: DESKTOP_MEDIA_QUERY,
    onchange: null,
    addEventListener: (_type: string, cb: ChangeListener) => {
      listeners.add(cb);
    },
    removeEventListener: (_type: string, cb: ChangeListener) => {
      listeners.delete(cb);
    },
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  };
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: () => mql,
  });
  return {
    setMatches(next: boolean) {
      matches = next;
      for (const cb of listeners) cb();
    },
  };
}

const originalMatchMedia = window.matchMedia;

describe('effective-chat-mode', () => {
  beforeEach(() => {
    useCurrentChatStore.getState().reset();
  });
  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: originalMatchMedia,
    });
  });

  it('passes the store through unchanged below the breakpoint', () => {
    installMatchMedia(false);
    const { result, rerender } = renderHook(() => useEffectiveChatMode());
    expect(result.current).toEqual({ isInteractionMode: false, isPinned: false });
    act(() => {
      useCurrentChatStore.getState().setInteractionMode(true);
      useCurrentChatStore.getState().togglePin();
    });
    rerender();
    expect(result.current).toEqual({ isInteractionMode: true, isPinned: true });
  });

  it('forces interaction and pinned at the breakpoint, without writing the store', () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useEffectiveChatMode());
    expect(result.current).toEqual({ isInteractionMode: true, isPinned: true });
    // Derived, never stored (spec §5.2).
    expect(useCurrentChatStore.getState().isInteractionMode).toBe(false);
    expect(useCurrentChatStore.getState().isPinned).toBe(false);
  });

  it('reacts to a media-query flip in both directions', () => {
    const media = installMatchMedia(false);
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(false);
    act(() => media.setMatches(true));
    expect(result.current).toBe(true);
    act(() => media.setMatches(false));
    expect(result.current).toBe(false);
  });

  it('reports mobile when matchMedia is unavailable', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: undefined,
    });
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/user-client && pnpm vitest run tests/state/effective-chat-mode.test.ts
```
Expected: FAIL — module `src/state/effective-chat-mode.ts` does not exist.

- [ ] **Step 3: Write the implementation**

Create `apps/user-client/src/state/effective-chat-mode.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { useSyncExternalStore } from 'react';
import { useCurrentChatStore } from './current-chat.store.js';

/** The Tailwind `lg` breakpoint — the project's single breakpoint (CLAUDE.md §3.4). */
export const DESKTOP_MEDIA_QUERY = '(min-width: 1024px)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }
  const mql = window.matchMedia(DESKTOP_MEDIA_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
}

/** True at and above the `lg` breakpoint (1024 px); reactive to window resizes. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot);
}

export interface EffectiveChatMode {
  isInteractionMode: boolean;
  isPinned: boolean;
}

/**
 * The chat's effective mode flags. Desktop has a single chat mode — always
 * interaction, always pinned semantics (spec 2026-07-18 §5) — derived at read
 * time so the store stays the mobile source of truth and a resize across the
 * breakpoint needs no state migration.
 */
export function useEffectiveChatMode(): EffectiveChatMode {
  const isDesktop = useIsDesktop();
  const isInteractionMode = useCurrentChatStore((s) => s.isInteractionMode);
  const isPinned = useCurrentChatStore((s) => s.isPinned);
  return {
    isInteractionMode: isDesktop || isInteractionMode,
    isPinned: isDesktop || isPinned,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/user-client && pnpm vitest run tests/state/effective-chat-mode.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/state/effective-chat-mode.ts apps/user-client/tests/state/effective-chat-mode.test.ts
git commit -m "Add effective chat-mode derivation for the desktop single mode"
```

---

### Task 2: Chat-page consumes the effective mode; lazy-mount writes desktop-gated

**Files:**
- Modify: `apps/user-client/src/routes/app/chat/chat-page.tsx` (lines cited below are pre-change anchors)
- Test: `apps/user-client/tests/unit/chat-page.test.tsx` (extend)

**Interfaces:**
- Consumes: `useEffectiveChatMode`, `useIsDesktop` from Task 1.
- Produces: no new exports; downstream behaviour only.

- [ ] **Step 1: Write the failing tests**

In `apps/user-client/tests/unit/chat-page.test.tsx`, add the `installMatchMedia` helper **verbatim from Task 1 Step 1** (top of file, after imports; also import `DESKTOP_MEDIA_QUERY` from `../../src/state/effective-chat-mode.js` and add the matching `afterEach` restore inside the new describe). Then add this describe block at the end of the file, reusing the file's existing `makeWrapper` and `seedPersonaWithMindspace` helpers:

```tsx
describe('desktop single mode (spec 2026-07-18 §5)', () => {
  const originalMatchMedia = window.matchMedia;
  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: originalMatchMedia,
    });
  });

  it('renders interaction mode with no BottomAffordance on desktop, without store writes', async () => {
    installMatchMedia(true);
    const { db, personaId } = await seedPersonaWithMindspace();
    const chatId = uuidv7();
    await db.chats.add({
      id: chatId,
      personaId,
      title: 'Desktop chat',
      createdAt: 1,
      updatedAt: 1,
    } as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Wrapper = makeWrapper(qc, `/app/chat/${chatId}`);
    render(<ChatPage />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(document.querySelector('.chat-page')).toHaveAttribute('data-mode', 'interaction');
    });
    expect(screen.queryByLabelText('Enter interaction mode')).not.toBeInTheDocument();
    expect(useCurrentChatStore.getState().isInteractionMode).toBe(false);
  });

  it('keeps reading mode with the BottomAffordance on mobile', async () => {
    installMatchMedia(false);
    const { db, personaId } = await seedPersonaWithMindspace();
    const chatId = uuidv7();
    await db.chats.add({
      id: chatId,
      personaId,
      title: 'Mobile chat',
      createdAt: 1,
      updatedAt: 1,
    } as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Wrapper = makeWrapper(qc, `/app/chat/${chatId}`);
    render(<ChatPage />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(document.querySelector('.chat-page')).toHaveAttribute('data-mode', 'reading');
    });
    expect(screen.getByLabelText('Enter interaction mode')).toBeInTheDocument();
  });

  it('skips the lazy-mount interaction/pin store writes on desktop', async () => {
    installMatchMedia(true);
    const { personaId } = await seedPersonaWithMindspace();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Wrapper = makeWrapper(qc, `/app/chat/new?persona=${personaId}`);
    render(<ChatPage />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(document.querySelector('.chat-page')).not.toBeNull();
    });
    // Derived-not-stored (spec §5.3 exception): the store must stay clean so a
    // later narrow below 1024 px lands in reading mode, like every other chat.
    expect(useCurrentChatStore.getState().isInteractionMode).toBe(false);
    expect(useCurrentChatStore.getState().isPinned).toBe(false);
  });

  it('performs the lazy-mount interaction/pin store writes on mobile (guard)', async () => {
    installMatchMedia(false);
    const { personaId } = await seedPersonaWithMindspace();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Wrapper = makeWrapper(qc, `/app/chat/new?persona=${personaId}`);
    render(<ChatPage />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(useCurrentChatStore.getState().isInteractionMode).toBe(true);
    });
    expect(useCurrentChatStore.getState().isPinned).toBe(true);
  });
});
```

If the existing chat-row seeding in this file uses a fuller `ChatRow` shape (search the file for `db.chats.add`), copy that exact shape instead of the `as never` stub above.

- [ ] **Step 2: Run to verify the new tests fail**

```bash
cd apps/user-client && pnpm vitest run tests/unit/chat-page.test.tsx
```
Expected: the two desktop tests FAIL (`data-mode` is `"reading"`; store writes happen); the two mobile guards PASS.

- [ ] **Step 3: Implement**

In `apps/user-client/src/routes/app/chat/chat-page.tsx`:

a) Add the import (with the other `../../../state/` imports):

```ts
import { useEffectiveChatMode, useIsDesktop } from '../../../state/effective-chat-mode.js';
```

b) Replace the two store reads (pre-change lines 99 and 101):

```ts
const isInteractionMode = useCurrentChatStore((s) => s.isInteractionMode);
// …
const isPinned = useCurrentChatStore((s) => s.isPinned);
```

with (single block, placed where line 99 was; delete the old line 101):

```ts
// Effective mode: desktop forces interaction+pinned at read time (spec
// 2026-07-18 §5.2). Store setters below still write the mobile truth.
const { isInteractionMode, isPinned } = useEffectiveChatMode();
const isDesktop = useIsDesktop();
```

Every later reference in this file (`Enter` hotkey effect ~474, live-voice hold ~739, `dictation.active` ~776, `data-mode` ~803, `BottomAffordance` gate ~993, `DimOverlay` ~1129, `InteractionMode` guard ~1134) now reads the effective values **by name, unchanged** — do not edit those lines in this task.

c) Gate the lazy-mount store writes (pre-change lines 146–156). Replace the effect body's first branch:

```ts
    if (isLazy && personaIdFromQuery) {
      setLazy(personaIdFromQuery);
      setInteractionMode(true);
      // Pin on mount — idempotent guard avoids double-toggle on strict-mode re-renders.
      if (!useCurrentChatStore.getState().isPinned) togglePin();
    } else if (chatId) {
```

with:

```ts
    if (isLazy && personaIdFromQuery) {
      setLazy(personaIdFromQuery);
      // Desktop derives interaction+pinned (spec §5.3 exception): writing them
      // here would leak desktop state into mobile after a resize below 1024 px.
      if (!isDesktop) {
        setInteractionMode(true);
        // Pin on mount — idempotent guard avoids double-toggle on strict-mode re-renders.
        if (!useCurrentChatStore.getState().isPinned) togglePin();
      }
    } else if (chatId) {
```

(The effect keeps its existing `biome-ignore` one-shot dependency comment; `isDesktop` is intentionally not a dependency — mount-time semantics.)

- [ ] **Step 4: Run the test file**

```bash
cd apps/user-client && pnpm vitest run tests/unit/chat-page.test.tsx
```
Expected: PASS (all pre-existing tests in the file must also still pass — the file's older tests run at the stubbed mobile default, so their behaviour is unchanged).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/app/chat/chat-page.tsx apps/user-client/tests/unit/chat-page.test.tsx
git commit -m "Derive the desktop single chat mode in chat-page"
```

---

### Task 3: Pinned semantics in InteractionMode, Cockpit (pin button removed on desktop), ChatStream

**Files:**
- Modify: `apps/user-client/src/components/chat/InteractionMode.tsx:75`
- Modify: `apps/user-client/src/components/chat/Cockpit.tsx:125-126, :232, :567-586`
- Modify: `apps/user-client/src/components/chat/ChatStream.tsx:109`
- Test: `apps/user-client/tests/components/chat/InteractionMode.test.tsx` (extend)

**Interfaces:**
- Consumes: `useEffectiveChatMode`, `useIsDesktop`, `DESKTOP_MEDIA_QUERY` from Task 1.
- Produces: no new exports. The pin button (`data-control="pin"`) exists in the DOM only below `lg`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/user-client/tests/components/chat/InteractionMode.test.tsx`. Reuse the file's existing render pattern (persona/offering stubs, `idleDictationStub`, QueryClientProvider + MemoryRouter — copy the exact prop list from the file's first test) and add the `installMatchMedia` helper **verbatim from Task 1 Step 1** plus an `afterEach` matchMedia restore:

```tsx
it('hides the pin control on desktop — nothing to toggle in the single mode', () => {
  installMatchMedia(true);
  renderInteractionMode(); // the file's existing render helper/pattern
  expect(document.querySelector('[data-control="pin"]')).toBeNull();
});

it('shows the pin control on mobile (guard)', () => {
  installMatchMedia(false);
  renderInteractionMode();
  expect(document.querySelector('[data-control="pin"]')).not.toBeNull();
});

it('does not close on an outside tap on desktop (pinned semantics, spec §7.5)', () => {
  installMatchMedia(true);
  renderInteractionMode();
  // The file's beforeEach sets isInteractionMode true; an outside pointerdown
  // must NOT flip it back on desktop (the unpinned auto-close is mobile-only).
  fireEvent.pointerDown(document.body);
  expect(useCurrentChatStore.getState().isInteractionMode).toBe(true);
});
```

(`fireEvent` comes from `@testing-library/react` — extend the file's existing import.)

If the file has no named render helper, inline the full `render(<InteractionMode …/>)` JSX from its first test in both new tests (complete prop list, no elision).

- [ ] **Step 2: Run to verify the desktop test fails**

```bash
cd apps/user-client && pnpm vitest run tests/components/chat/InteractionMode.test.tsx
```
Expected: desktop test FAILS (pin button present), mobile guard PASSES.

- [ ] **Step 3: Implement**

a) `InteractionMode.tsx` — replace line 75:

```ts
const isPinned = useCurrentChatStore((s) => s.isPinned);
```

with:

```ts
const { isPinned } = useEffectiveChatMode();
```

and add the import `import { useEffectiveChatMode } from '../../state/effective-chat-mode.js';`. The store import stays (other selectors still use it). This makes the outside-tap close (line 95), the send-close (line 154), and the dep array (line 150) desktop-inert — no further edits there.

b) `Cockpit.tsx` — replace line 125:

```ts
const isPinned = useCurrentChatStore((s) => s.isPinned);
```

with:

```ts
const { isPinned } = useEffectiveChatMode();
const isDesktop = useIsDesktop();
```

adding the import `import { DESKTOP_MEDIA_QUERY, useEffectiveChatMode, useIsDesktop } from '../../state/effective-chat-mode.js';`. (`togglePin` and `setInteractionMode` reads stay — `onTogglePin` remains for mobile.)

c) `Cockpit.tsx` line 232 — the desktop plain-Enter check duplicates the media query string; point it at the shared constant. Replace:

```ts
!ctrlEnter && !e.shiftKey && window.matchMedia('(min-width: 1024px)').matches;
```

with:

```ts
!ctrlEnter && !e.shiftKey && window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
```

d) `Cockpit.tsx` lines 567–586 — wrap the pin button in a desktop gate. The capability is structurally absent on desktop, so it is removed, not disabled (spec §5.4, recorded in ADR 0036):

```tsx
{!isDesktop ? (
  <button
    type="button"
    className={`cockpit-icon-btn${isPinned ? ' active' : ''}`}
    data-control="pin"
    aria-label={isPinned ? 'Unpin cockpit' : 'Pin cockpit'}
    aria-pressed={isPinned}
    onClick={onTogglePin}
  >
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M12 2v10M8 14l4-4 4 4M6 22h12" />
    </svg>
  </button>
) : null}
```

e) `ChatStream.tsx` — replace line 109:

```ts
const isPinned = useCurrentChatStore((s) => s.isPinned);
```

with:

```ts
const { isPinned } = useEffectiveChatMode();
```

adding the import `import { useEffectiveChatMode } from '../../state/effective-chat-mode.js';`. (The `MessageBlock` `isPinned` prop at line 277 now carries the effective value — `MessageBlock` itself is untouched.)

- [ ] **Step 4: Run the affected test files**

```bash
cd apps/user-client && pnpm vitest run tests/components/chat/InteractionMode.test.tsx tests/components/chat/Cockpit.edit.test.tsx tests/components/chat/Cockpit.voicemode.test.tsx tests/unit/interaction-mode.test.tsx
```
Expected: PASS (the setup.ts matchMedia stub reports `matches: false`, so untouched tests keep mobile behaviour).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/chat/InteractionMode.tsx apps/user-client/src/components/chat/Cockpit.tsx apps/user-client/src/components/chat/ChatStream.tsx apps/user-client/tests/components/chat/InteractionMode.test.tsx
git commit -m "Apply effective pinned semantics and remove the pin control on desktop"
```

---

### Task 4: Root header uses the effective mode

**Files:**
- Modify: `apps/user-client/src/routes/root.tsx:47`
- Test: none new (behavioural coverage rides Task 2's `data-mode` tests; the header branch is exercised by existing route tests at the mobile default).

**Interfaces:**
- Consumes: `useEffectiveChatMode` from Task 1.

- [ ] **Step 1: Implement**

In `apps/user-client/src/routes/root.tsx`, replace line 47:

```ts
const isInteractionMode = useCurrentChatStore((s) => s.isInteractionMode);
```

with:

```ts
// Effective, not raw store: on desktop the chat has a single (interaction)
// mode, so the brand bar must never present the reading-mode strip there
// (spec 2026-07-18 §5.3).
const { isInteractionMode } = useEffectiveChatMode();
```

Add the import `import { useEffectiveChatMode } from '../state/effective-chat-mode.js';`. If `useCurrentChatStore` is then only used for `chatHeader` (line 48), keep that import — it is still needed.

- [ ] **Step 2: Run the neighbouring tests**

```bash
cd apps/user-client && pnpm vitest run tests/routes/
```
Expected: PASS, no regressions.

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/routes/root.tsx
git commit -m "Drive the chat brand bar from the effective chat mode"
```

---

### Task 5: Broken-model repair — topbar mounts without an offering (spec §5.6)

**Files:**
- Modify: `apps/user-client/src/components/chat/InteractionMode.tsx` (Props + render)
- Modify: `apps/user-client/src/components/chat/InteractionTopbar.tsx` (Props + gauge)
- Modify: `apps/user-client/src/routes/app/chat/chat-page.tsx:1134` (mount guard)
- Test: `apps/user-client/tests/components/chat/InteractionMode.test.tsx` (extend)

**Interfaces:**
- Consumes: existing `resolveContextWindow(persona: PersonaRow, offering: Offering): number` from `apps/user-client/src/lib/context-window.ts`.
- Produces (changed prop contracts):
  - `InteractionMode` Props: `offering: Offering | null` (was `Offering`).
  - `InteractionTopbar` Props: `contextWindow: number | null` (was `number`).

- [ ] **Step 1: Write the failing tests**

Append to `apps/user-client/tests/components/chat/InteractionMode.test.tsx` (again reusing the file's render pattern; pass `offering={null}`):

```tsx
it('mounts the topbar without a cockpit when no offering resolves (spec §5.6)', () => {
  installMatchMedia(false);
  renderInteractionMode({ offering: null }); // adapt to the file's pattern: same props, offering null
  // The repair path stays reachable: exit + persona avatar are in the topbar.
  expect(screen.getByLabelText('Exit to Entrance Hall')).toBeInTheDocument();
  // No model — no composer.
  expect(document.querySelector('.cockpit-focus-capture')).toBeNull();
  // The gauge degrades to an explicit unavailable state, not a fake 0 %.
  expect(screen.getByText('—')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd apps/user-client && pnpm vitest run tests/components/chat/InteractionMode.test.tsx
```
Expected: FAIL — a type/render error (`offering` currently non-nullable) or a missing `—`.

- [ ] **Step 3: Implement**

a) `InteractionTopbar.tsx`:

- Props: change `contextWindow: number;` to:

```ts
/** Resolved context window, or null when no offering resolves (removed model —
 *  the gauge shows an inert unavailable state, spec 2026-07-18 §5.6). */
contextWindow: number | null;
```

- Replace line 33:

```ts
const pct = contextUtilisation(p.usedTokens, p.contextWindow);
```

with:

```ts
const pct = p.contextWindow === null ? null : contextUtilisation(p.usedTokens, p.contextWindow);
```

- Replace the gauge button (lines 156–174) with:

```tsx
<button
  type="button"
  className="context-gauge"
  aria-label={
    pct === null
      ? 'Context unavailable — no model resolved'
      : p.compactable
        ? 'Compact conversation'
        : 'Compact conversation (unavailable)'
  }
  title={
    pct === null
      ? 'No model resolved for this chat — pick one from the persona page.'
      : p.compactable
        ? 'Compact the conversation'
        : 'Nothing to compact yet — the conversation is still short'
  }
  disabled={pct === null || !p.compactable}
  onClick={pct !== null && p.compactable ? p.onCompact : undefined}
>
  <div className="context-gauge-bar">
    <div className="context-gauge-fill" style={{ width: `${pct ?? 0}%` }} />
  </div>
  <div className="context-gauge-text">{pct === null ? '—' : `${pct}%`}</div>
</button>
```

b) `InteractionMode.tsx`:

- Props: change `offering: Offering;` to:

```ts
/** Null when the chat's model cannot be resolved (removed provider/model).
 *  The topbar still mounts — it is the repair path — but the cockpit needs a
 *  model to compose against and stays absent (spec 2026-07-18 §5.6). */
offering: Offering | null;
```

- The topbar's `contextWindow` prop (line 173) becomes:

```tsx
contextWindow={p.offering ? resolveContextWindow(p.persona, p.offering) : null}
```

- Wrap the whole `cockpit-focus-capture` div (lines 187–229, the div plus its `<Cockpit …/>` child) in a null-guard so `Cockpit` keeps receiving a non-null `Offering`:

```tsx
{p.offering ? (
  <div
    className="cockpit-focus-capture"
    /* …existing onFocusCapture/onBlurCapture unchanged… */
  >
    <Cockpit
      /* …existing props unchanged, offering={p.offering}… */
    />
  </div>
) : null}
```

(Keep the existing long explanatory comment above the div where it is.)

c) `chat-page.tsx` — the mount guard (pre-change line 1134). Replace:

```tsx
{isInteractionMode && effectivePersona && offering && (!isLiveVoice || isPinned) ? (
```

with:

```tsx
{isInteractionMode && effectivePersona && (!isLiveVoice || isPinned) ? (
```

(`offering` continues to be passed as a prop — it is now legitimately nullable. Also improves mobile: a `BottomAffordance` tap with a broken model now opens the topbar instead of nothing.)

- [ ] **Step 4: Run the affected tests + typecheck**

```bash
cd apps/user-client && pnpm vitest run tests/components/chat/InteractionMode.test.tsx tests/unit/chat-page.test.tsx tests/unit/interaction-mode.test.tsx
cd ../.. && pnpm typecheck
```
Expected: tests PASS; typecheck clean (the nullable prop must not break any other `InteractionMode`/`InteractionTopbar` call site — fix any surfaced site by passing the now-nullable value through, never with a non-null assertion).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/chat/InteractionMode.tsx apps/user-client/src/components/chat/InteractionTopbar.tsx apps/user-client/src/routes/app/chat/chat-page.tsx apps/user-client/tests/components/chat/InteractionMode.test.tsx
git commit -m "Keep the chat topbar reachable when no model offering resolves"
```

---

### Task 6: Widen the chat column to 896 px

**Files:**
- Modify: `apps/user-client/src/index.css:1936-1940` (`.chat-page` lg block)
- Modify: `apps/user-client/src/routes/root.tsx:125` (chat brand bar)
- Test: none (CSS; covered by manual verification).

- [ ] **Step 1: Implement**

a) `index.css` — in the `@media (min-width: 1024px)` block at lines 1936–1944, change only the `.chat-page` max-width:

```css
@media (min-width: 1024px) {
  .chat-page {
    top: 2.75rem;
    /* 56rem = 896px (Tailwind max-w-4xl) — the desktop chat column,
       spec 2026-07-18 §3. Must stay in lock-step with the chat brand bar's
       lg:max-w-4xl in root.tsx. */
    max-width: 56rem;
  }
  .chat-page[data-mode="reading"] {
    top: 2.25rem;
  }
}
```

Leave `.toast-stack` (lines 1966–1970) untouched — deliberate, spec §3.

b) `root.tsx:125` — in the chat-route header branch, change `lg:max-w-[640px]` to `lg:max-w-4xl`:

```tsx
`mx-auto w-full max-w-[420px] px-3 lg:max-w-4xl ${
  isReadingChat ? 'py-1 lg:py-1.5' : 'bg-black/40 py-2 lg:py-2.5'
}`
```

Do **not** touch the `<main>` at line 219 — every non-chat page keeps 640 px.

- [ ] **Step 2: Verify**

```bash
cd apps/user-client && pnpm vitest run tests/unit/chat-page.test.tsx && cd ../.. && pnpm typecheck
```
Expected: PASS / clean (no behavioural change; this is a visual task for the device check).

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/index.css apps/user-client/src/routes/root.tsx
git commit -m "Widen the desktop chat column to 896px"
```

---

### Task 7: Desktop user-message bubbles

**Files:**
- Modify: `apps/user-client/src/index.css` (immediately after the `.msg.from-persona` rule at lines 530–532)
- Test: none (CSS; covered by manual verification).

- [ ] **Step 1: Implement**

Directly after the existing rules

```css
.msg.from-user {
  text-align: right;
}
.msg.from-persona {
  text-align: left;
}
```

insert:

```css
/* Desktop message presentation (spec 2026-07-18 §4): user messages become
   left-aligned, content-sized bubbles; persona text stays open across the
   column (long-form Markdown reads best unboxed). Role remains doubly cued
   by the msg-name prefix + colour. Mobile keeps the right-aligned
   transparent treatment above. */
@media (min-width: 1024px) {
  .msg.from-user {
    text-align: left;
    width: fit-content;
    max-width: 85%;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 0.75rem;
    padding: 0.6rem 0.9rem;
  }
}
```

- [ ] **Step 2: Verify the stylesheet still builds**

```bash
pnpm --filter user-client build
```
Expected: build succeeds (9/9 pipeline steps if run at the repo root as `pnpm run build`).

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/index.css
git commit -m "Render desktop user messages as left-aligned bubbles"
```

---

### Task 8: ADR 0036, CLAUDE.md §3.4 amendment, UX-deferral entry

**Files:**
- Create: `obsidian/decisions/0036-desktop-refinements-within-single-ui.md`
- Modify: `CLAUDE.md` (§3 rule 4)
- Modify: `obsidian/insights/ux-deferrals.md` (append one entry, matching the file's existing entry format)

- [ ] **Step 1: Write the ADR**

Create `obsidian/decisions/0036-desktop-refinements-within-single-ui.md`:

```markdown
# 0036 — Desktop refinements within the single-UI principle

Date: 2026-07-18
Status: Accepted

## Context

Hard rule §3.4 ("Desktop is a constrained-width version of the same UI")
served the mobile-first build phase well, but with the client feature-complete
and in field use, a 640 px desktop column, right-aligned ragged user text and
a collapsible cockpit read as mobile constraints exported to a screen that
does not share them. The 2026-07-18 desktop iteration (spec
`superpowers/specs/2026-07-18-desktop-ui-iteration-design.md`) wanted a
principled way to refine desktop without forking the UI.

## Decision

Desktop remains the **same UI** — same routes, same components, same flows —
but may receive targeted refinements gated on the single `lg` breakpoint
(1024 px) where a mobile constraint exists only because of mobile's limits,
not as a design value. Mobile-first remains the design root. Desktop
refinements must never fork flows or add desktop-only features.

First refinements under this rule: a 896 px chat column, left-aligned
content-sized user-message bubbles (persona text stays open), and a
permanently open cockpit — desktop has a single chat mode (always
interaction, always pinned semantics), derived at read time and never
written to the store.

Within that single mode the cockpit's pin control is **removed on desktop,
not disabled** — a conscious, narrow exception to §11's "disabled over
hidden": with nothing to toggle, the capability is structurally absent, and
a greyed pin would advertise a phantom state (same reasoning class as the
admin tile's hidden-not-disabled exception, spec 2026-07-05 §4.2).

## Consequences

- CLAUDE.md §3.4 is reworded to reference this ADR.
- Desktop loses the zen/dim reading mode — a named trade, logged in
  `obsidian/insights/ux-deferrals.md`, with a sketched remedy (a lightweight
  "focus read" affordance) should field testing read the permanent composer
  as nagging.
- Future desktop ideas (e.g. sidebars) must pass the same test: same UI,
  same flows, refinement not fork — each gets its own spec and Laura pass.
```

- [ ] **Step 2: Amend CLAUDE.md §3 rule 4**

In `CLAUDE.md`, replace:

```markdown
4. **Mobile-first UI at 380 px.** Desktop is a constrained-width version of the same UI. Single `lg` breakpoint (1024 px) — tablets are phones.
```

with:

```markdown
4. **Mobile-first UI at 380 px.** Desktop is the same UI with targeted `lg`-gated refinements (see [ADR 0036](obsidian/decisions/0036-desktop-refinements-within-single-ui.md)); single `lg` breakpoint (1024 px) — tablets are phones.
```

- [ ] **Step 3: Append the UX-deferral entry**

Open `obsidian/insights/ux-deferrals.md`, match its existing entry format (date, feature, finding, decision), and append an entry with this content:

> **2026-07-18 — Desktop single mode (desktop UI iteration 1).** Laura
> spec-pass soft: with the cockpit permanently open, desktop loses the
> zen/dim reading state — the one surface that was pure invitation; a
> composer is always in view. Consciously accepted (Chris's call, core to
> "cockpit always open"); dwelling survives via the 896 px column and open
> persona text. Revisit trigger: field reports reading the permanent
> composer as nagging → sketched remedy is a lightweight desktop
> "focus read" affordance that hides composer chrome without reintroducing
> the two-mode machinery. Spec §5.5, ADR 0036.

- [ ] **Step 4: Commit**

```bash
git add obsidian/decisions/0036-desktop-refinements-within-single-ui.md CLAUDE.md obsidian/insights/ux-deferrals.md
git commit -m "Record ADR 0036 for lg-gated desktop refinements"
```

---

### Task 9: Final sweep + full gates

**Files:** none new.

- [ ] **Step 1: Consumer sweep (spec §5.3)**

```bash
rg -n "isPinned|isInteractionMode" apps/user-client/src
```
Every behavioural read must go through `useEffectiveChatMode()`. Expected remaining direct-store references: the store definition itself (`current-chat.store.ts`), store **writes** (`setInteractionMode`, `togglePin` call sites), the intentionally store-reading lazy-mount + edit-entry lines in `chat-page.tsx` (`useCurrentChatStore.getState().isPinned` idempotence guards), and `MessageBlock`'s `isPinned` **prop** (fed by ChatStream). Anything else: route it through the hook and add it to the commit.

- [ ] **Step 2: Full gates**

```bash
pnpm typecheck --force        # expect 14/14, 0 cached
pnpm run build                # expect 9/9
cd apps/user-client && pnpm vitest run   # expect exactly 8 known Node-localStorage failures
cd ../.. && pnpm biome check apps/user-client/src apps/user-client/tests
```
Expected: all green / at baseline. A 9th vitest failure is a real regression — fix it before finishing; do not reclassify it as environmental without proving the identical failure exists on `master`.

- [ ] **Step 3: Commit any sweep fixes**

```bash
git add -A && git commit -m "Route remaining chat-mode reads through the effective hook"
```
(Skip if the sweep found nothing.)

---

## Post-execution (Liz, not the executor)

- Laura pre-squash pass (user-reachable flow/state changes). Not a Larissa path.
- Squash to one feature unit ("Add desktop UI iteration 1: wider chat, user bubbles, permanent cockpit"), verify the squash captures the full tree, run gates on master.
- STATUS-CLIENT-ONLY update + Chris's manual verification (spec §8) — including the resize ping-pong, the broken-model state, and the 380 px phone spot-check.
