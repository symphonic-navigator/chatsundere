# Chat polish (cancel / table / read-only home) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three small client-only chat-surface polish changes — cancel a running inference (preserving the partial answer), stop wide Markdown tables from forcing a horizontal scrollbar, and give a quick home route from read-only mode.

**Architecture:** All client-only, no Dexie migration, no backend, no crypto. (B) reuses the existing `AbortController` plumbing — only a single-chat preserve action and a stop affordance on the send button are new. (C) wraps tables in an `overflow-x` scroll container, mirroring the working code-block pattern. (D) renders the existing brand logo, smaller, in reading mode.

**Tech Stack:** React 18, Zustand, react-markdown, Tailwind v4 / `index.css`, Vitest + @testing-library/react. Tests live under `apps/user-client/tests/`.

---

## File Structure

- `apps/user-client/src/state/stream-manager.store.ts` — add `abortPreserve(chatId)`; refactor `abortAllForPersonaPreserve` to delegate to it (DRY).
- `apps/user-client/src/components/chat/DualActionBtn.tsx` — third visual state: a **stop** button while a stream is live.
- `apps/user-client/src/components/chat/Cockpit.tsx` — accept + forward `onStop` to `DualActionBtn`.
- `apps/user-client/src/components/chat/InteractionMode.tsx` — pass `onStop` through to `Cockpit`.
- `apps/user-client/src/routes/app/chat/chat-page.tsx` — define `onStop` (calls `abortPreserve`) and pass it to `InteractionMode`.
- `apps/user-client/src/components/chat/markdown/markdown-components.tsx` — `table` override wrapping the table in a scroll container.
- `apps/user-client/src/index.css` — `.msg-table-wrap` rule + `min-width: 0` guard on the message column; `.brand-logo-small` rule.
- `apps/user-client/src/routes/root.tsx` — render the logo in reading mode with a `brand-logo-small` modifier.

**All paths below are relative to `apps/user-client/` unless absolute.** Run all commands from `apps/user-client/`.

---

## Task 1: `abortPreserve` store action

**Files:**
- Modify: `src/state/stream-manager.store.ts` (interface at lines 102-111; `abortAllForPersonaPreserve` at lines 245-262)
- Test: `tests/unit/stream-manager-store.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test inside the `describe('stream-manager.store', …)` block in `tests/unit/stream-manager-store.test.ts` (model it on the existing `'abortDiscard removes the draft, keeps the user message'` test at line 324):

```ts
  it('abortPreserve keeps a fresh-send draft as incomplete (not deleted)', async () => {
    const { db, personaId } = await seedChat();
    const myChatId = 'c-abort-preserve';
    await db.chats.add({
      id: myChatId,
      personaId,
      title: null,
      resolvedMindspaceId: 'm1',
      createdAt: 1,
      lastMessageAt: 1,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });
    const persona = await db.personas.get(personaId);
    const model = nanoGpt.offerings[0];
    vi.spyOn(engine, 'runStreamEngine').mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );
    const store = useStreamManagerStore.getState();
    void store.start({ ...baseStartArgs(myChatId, persona, model), chatId: myChatId } as never);
    await new Promise((r) => setTimeout(r, 20));
    expect(useStreamManagerStore.getState().has(myChatId)).toBe(true);

    await store.abortPreserve(myChatId);

    const msgs = await db.messages.where('chatId').equals(myChatId).toArray();
    // The user message survives, AND the persona draft survives as incomplete.
    expect(msgs.filter((m) => m.role === 'user').length).toBe(1);
    const personaRow = msgs.find((m) => m.role === 'persona');
    expect(personaRow).toBeDefined();
    expect(personaRow?.streamingState).toBe('incomplete');
    // The handle is gone — the input is free again.
    expect(useStreamManagerStore.getState().has(myChatId)).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/stream-manager-store.test.ts -t "abortPreserve keeps a fresh-send draft"`
Expected: FAIL — `store.abortPreserve is not a function`.

- [ ] **Step 3: Add `abortPreserve` to the store interface**

In `src/state/stream-manager.store.ts`, add the signature to the `StreamManagerStore` interface (after line 108, `abortAllForPersonaPreserve`):

```ts
  abortPreserve: (chatId: string) => Promise<void>;
```

- [ ] **Step 4: Implement `abortPreserve` and refactor `abortAllForPersonaPreserve` to delegate**

Replace the existing `abortAllForPersonaPreserve` implementation (lines 245-262) with these two actions:

```ts
  abortPreserve: async (chatId) => {
    const h = get().streams.get(chatId);
    if (!h) return;
    h.controller.abort();
    const db = getClientDataDb();
    // Persist the partial buffer + mark incomplete so the StreamInterruptedFooter
    // offers Retry — for a fresh send AND a regenerate (unlike abortDiscard, which
    // deletes a fresh-send draft). The user decides: keep what they have, or retry.
    await db.messages.update(h.draftMessageId, {
      contentBlocks: h.contentBuffer,
      streamingState: 'incomplete',
    });
    set((s) => {
      const m = new Map(s.streams);
      m.delete(chatId);
      return { streams: m };
    });
  },

  abortAllForPersonaPreserve: async (personaId) => {
    const matching = [...get().streams.values()].filter((h) => h.personaId === personaId);
    for (const h of matching) await get().abortPreserve(h.chatId);
  },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run tests/unit/stream-manager-store.test.ts -t "abortPreserve keeps a fresh-send draft"`
Expected: PASS.

- [ ] **Step 6: Run the full store test file (guard the refactor)**

Run: `pnpm vitest run tests/unit/stream-manager-store.test.ts`
Expected: all pass (the `abortAllForPersonaPreserve` refactor preserves behaviour).

- [ ] **Step 7: Commit**

```bash
git add src/state/stream-manager.store.ts tests/unit/stream-manager-store.test.ts
git commit -m "Add abortPreserve store action for user-initiated stream cancel"
```

---

## Task 2: Stop affordance on `DualActionBtn`

**Files:**
- Modify: `src/components/chat/DualActionBtn.tsx` (whole file, currently 47 lines)
- Test: `tests/unit/dual-action-btn.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/dual-action-btn.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DualActionBtn } from '../../src/components/chat/DualActionBtn';

describe('DualActionBtn', () => {
  it('renders a stop button and calls onStop while a stream is live', () => {
    const onStop = vi.fn();
    const onSend = vi.fn();
    const { getByRole } = render(
      <DualActionBtn
        hasText={true}
        isStreamLive={true}
        personaName="Aurum"
        onSend={onSend}
        onStop={onStop}
      />,
    );
    const btn = getByRole('button', { name: /stop/i });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends (not stops) when there is text and no live stream', () => {
    const onStop = vi.fn();
    const onSend = vi.fn();
    const { getByRole } = render(
      <DualActionBtn
        hasText={true}
        isStreamLive={false}
        personaName="Aurum"
        onSend={onSend}
        onStop={onStop}
      />,
    );
    const btn = getByRole('button', { name: 'Send' });
    fireEvent.click(btn);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/dual-action-btn.test.tsx`
Expected: FAIL — `onStop` is not a prop / no button named "stop".

- [ ] **Step 3: Implement the stop state**

Replace the entire contents of `src/components/chat/DualActionBtn.tsx` with:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

interface Props {
  hasText: boolean;
  isStreamLive: boolean;
  personaName: string;
  onSend: () => void;
  onStop: () => void;
}

export function DualActionBtn(p: Props): JSX.Element {
  // While a reply streams, the same button becomes a Stop control (least
  // astonishing: the button you pressed halts the reply). Otherwise it is the
  // send arrow (enabled with text) or a disabled mic placeholder (Block 4).
  if (p.isStreamLive) {
    return (
      <button
        type="button"
        className="dual-action-btn"
        data-dual="stop"
        title={`Stop ${p.personaName}`}
        aria-label="Stop"
        onClick={p.onStop}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      </button>
    );
  }

  const disabled = !p.hasText;
  const title = p.hasText ? 'Send' : 'Voice arrives with Block 4';
  return (
    <button
      type="button"
      className="dual-action-btn"
      data-dual="action"
      disabled={disabled}
      title={title}
      aria-label={p.hasText ? 'Send' : 'Microphone (disabled)'}
      onClick={p.hasText ? p.onSend : undefined}
    >
      {p.hasText ? (
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
          <path d="M5 12l14-7-5 14-2-7-7-0z" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <rect x="9" y="3" width="6" height="12" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      )}
    </button>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/unit/dual-action-btn.test.tsx`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/DualActionBtn.tsx tests/unit/dual-action-btn.test.tsx
git commit -m "Turn the send button into a stop control while a stream is live"
```

---

## Task 3: Wire `onStop` through the cockpit chain

The `DualActionBtn` now requires an `onStop` prop. Thread it from `chat-page` (which owns the store call) → `InteractionMode` → `Cockpit` → `DualActionBtn`.

**Files:**
- Modify: `src/components/chat/Cockpit.tsx` (Props interface ~line 34-45; `DualActionBtn` usage at lines 486-490)
- Modify: `src/components/chat/InteractionMode.tsx` (Props interface ~line 10-30; `Cockpit` usage at lines 175-182)
- Modify: `src/routes/app/chat/chat-page.tsx` (`InteractionMode` usage at lines 575-585)
- Test: `tests/unit/cockpit.test.tsx`

- [ ] **Step 1: Write the failing test**

Add this test to `tests/unit/cockpit.test.tsx` (it already renders `<Cockpit>`; reuse the existing `aurum` persona fixture and render helper in that file — match how the other tests in the file construct the `<Cockpit>` props). The new prop is `onStop`:

```tsx
  it('renders a stop button that calls onStop when a stream is live', () => {
    const onStop = vi.fn();
    // Render the Cockpit with isStreamLive=true and onStop wired. Reuse the
    // file's existing render setup/props; only isStreamLive + onStop matter here.
    const { getByRole } = renderCockpit({ isStreamLive: true, onStop });
    fireEvent.click(getByRole('button', { name: /stop/i }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });
```

> Implementation note for the engineer: `tests/unit/cockpit.test.tsx` already imports `Cockpit`, `render`, `fireEvent`, and builds a full props object. Factor the existing inline render into a small `renderCockpit(overrides)` helper if one is not already present, defaulting every required prop (including the **new** `onStop: () => {}`) and spreading `overrides`. Then the other existing tests keep passing unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/cockpit.test.tsx -t "stop button that calls onStop"`
Expected: FAIL — `onStop` not in Cockpit props / no stop button rendered.

- [ ] **Step 3: Add `onStop` to `Cockpit` Props and forward it**

In `src/components/chat/Cockpit.tsx`, add to the `Props` interface (next to `onSend: (text: string) => void;`):

```ts
  onStop: () => void;
```

Then update the `DualActionBtn` usage (lines 486-490) to pass it:

```tsx
        <DualActionBtn
          hasText={p.draftValue.trim().length > 0}
          isStreamLive={p.isStreamLive}
          personaName={p.persona.name}
          onSend={() => p.onSend(p.draftValue)}
          onStop={p.onStop}
        />
```

> Keep the existing prop values exactly as they currently are (the snippet above shows the four existing props plus the new `onStop`); only add the `onStop` line.

- [ ] **Step 4: Add `onStop` to `InteractionMode` Props and forward it**

In `src/components/chat/InteractionMode.tsx`, add to the `Props` interface (next to `onSend: (text: string) => void;`):

```ts
  onStop: () => void;
```

Then in the `<Cockpit … />` usage (lines 175-182) add:

```tsx
          onStop={p.onStop}
```

- [ ] **Step 5: Define `onStop` in `chat-page` and pass it to `InteractionMode`**

In `src/routes/app/chat/chat-page.tsx`, the active chat id is available (the same value passed as `chatId` to `InteractionMode`). Add an `onStop` to the `<InteractionMode … />` usage (lines 575-585) that preserves the partial answer:

```tsx
          onStop={() => void useStreamManagerStore.getState().abortPreserve(activeChatId)}
```

> `useStreamManagerStore` is already imported (line 41). Use the **same** chat-id expression that the adjacent `chatId={…}` prop on this `InteractionMode` uses — do not introduce a new variable. If that prop reads e.g. `chatId={activeChatId}`, use `activeChatId` here too.

- [ ] **Step 6: Run the cockpit test + typecheck**

Run: `pnpm vitest run tests/unit/cockpit.test.tsx`
Expected: all pass (new stop test + existing tests via the defaulted helper).

Run: `pnpm typecheck --force`
Expected: 0 errors (the new required `onStop` prop is supplied at every call site).

- [ ] **Step 7: Commit**

```bash
git add src/components/chat/Cockpit.tsx src/components/chat/InteractionMode.tsx src/routes/app/chat/chat-page.tsx tests/unit/cockpit.test.tsx
git commit -m "Wire stop control to abortPreserve through the cockpit chain"
```

---

## Task 4: Table overflow scroll wrapper

**Files:**
- Modify: `src/components/chat/markdown/markdown-components.tsx` (the object returned by `createMarkdownComponents`, lines 21-57)
- Modify: `src/index.css` (table rules around line 648; message-text box)
- Test: `tests/unit/markdown-table-overflow.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/markdown-table-overflow.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { render } from '@testing-library/react';
import type { ComponentPropsWithoutRef } from 'react';
import { describe, expect, it } from 'vitest';
import { createMarkdownComponents } from '../../src/components/chat/markdown/markdown-components';

describe('markdown table override', () => {
  it('wraps a table in a horizontal-scroll container', () => {
    const comps = createMarkdownComponents(null);
    const Table = comps.table as (p: ComponentPropsWithoutRef<'table'>) => JSX.Element;
    const { container } = render(
      <Table>
        <tbody>
          <tr>
            <td>cell</td>
          </tr>
        </tbody>
      </Table>,
    );
    const wrap = container.querySelector('.msg-table-wrap');
    expect(wrap).not.toBeNull();
    expect(wrap?.querySelector('table')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/markdown-table-overflow.test.tsx`
Expected: FAIL — `comps.table` is undefined → render throws / `.msg-table-wrap` is null.

- [ ] **Step 3: Add the `table` override**

In `src/components/chat/markdown/markdown-components.tsx`, add a `table` entry to the returned object (e.g. after the `img` override at line 55). The table keeps full table semantics; the wrapper owns the scroll:

```tsx
    table(props: ComponentPropsWithoutRef<'table'>) {
      // A GFM table wider than the 380px chat column would otherwise stretch
      // the whole stream and force a page-level horizontal scrollbar. Wrap it
      // in a scroll container (same pattern as code blocks / KaTeX) so it
      // scrolls inside its own bubble instead.
      return (
        <div className="msg-table-wrap">
          <table {...props} />
        </div>
      );
    },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/unit/markdown-table-overflow.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add the CSS (wrapper scroll + column shrink guard)**

In `src/index.css`, add the wrapper rule next to the existing `.msg-text table` block (around line 648):

```css
.msg-table-wrap {
  overflow-x: auto;
  max-width: 100%;
}
```

And add a `min-width: 0` guard to the message-text box so a wide child can no longer stretch the flex column. Locate the `.msg-text` rule in `src/index.css` (the message body class applied in `MessageBlock.tsx`) and add to it:

```css
  min-width: 0;
```

> If `.msg-text` does not already exist as its own rule with a width context, add a minimal rule:
> ```css
> .msg-text {
>   min-width: 0;
> }
> ```
> Do not change any other `.msg-text` declarations.

- [ ] **Step 6: Verify the build picks up the CSS**

Run: `pnpm run build`
Expected: build succeeds (9/9 packages). (CSS has no unit test; correctness of the scroll is device-verified — see the spec's manual verification.)

- [ ] **Step 7: Commit**

```bash
git add src/components/chat/markdown/markdown-components.tsx src/index.css tests/unit/markdown-table-overflow.test.tsx
git commit -m "Wrap wide Markdown tables in a horizontal-scroll container"
```

---

## Task 5: Read-only-mode home logo

This is a JSX-gating + CSS change with no meaningful logic to unit-test in isolation (rendering `<Root>` pulls in boot/session/splash machinery — high cost, low value). It is verified manually on device (spec §Manual verification, item 4). Keep the change minimal; exact sizing is a later styling pass by Chris.

**Files:**
- Modify: `src/routes/root.tsx` (logo block, lines 120-135)
- Modify: `src/index.css` (`.brand-logo` neighbourhood)

- [ ] **Step 1: Render the logo in reading mode with a small modifier**

In `src/routes/root.tsx`, replace the conditional logo block (lines 121-135, currently gated by `{!isReadingChat && ( … )}`) so the logo now renders **unconditionally** (it already rendered everywhere except reading mode; this adds the reading-mode case as a small variant). Remove the `{!isReadingChat && (` / `)}` wrapper and render the `<Link>` directly, deriving the small modifier + twinkle from `isReadingChat`:

```tsx
            <Link
              to="/"
              className={`brand-logo${isReadingChat ? ' brand-logo-small' : ''}`}
              style={{ opacity: topbarLogoVisible ? 1 : 0 }}
            >
              <span
                ref={(el) => {
                  topbarLogoRef.current = el;
                }}
                className="brand-logo-text"
              >
                Chatsundere
              </span>
              {!isReadingChat && (
                <span className="brand-logo-twinkle" aria-hidden="true">
                  ✦
                </span>
              )}
            </Link>
```

> Effect: outside a chat → unchanged full logo. In a chat, interaction mode → unchanged full logo. In a chat, reading mode → the small logo (twinkle dropped). The `to="/"` target is unchanged (root redirects an authenticated user to the Entrance Hall = main menu).

- [ ] **Step 2: Add the `brand-logo-small` CSS**

In `src/index.css`, near the existing `.brand-logo` rules, add a minimal modifier so the logo fits the thin reading-mode strip:

```css
.brand-logo-small .brand-logo-text {
  font-size: 0.8rem;
  letter-spacing: 0.02em;
}
```

> Keep it minimal — Chris does the precise sizing/position as a styling pass.

- [ ] **Step 3: Typecheck + build**

Run: `pnpm typecheck --force`
Expected: 0 errors.

Run: `pnpm run build`
Expected: 9/9.

- [ ] **Step 4: Commit**

```bash
git add src/routes/root.tsx src/index.css
git commit -m "Show a small home logo in read-only chat mode"
```

---

## Final verification (before squash)

Run from `apps/user-client/`:

- [ ] `pnpm typecheck --force` — expect 0 errors.
- [ ] `pnpm vitest run` — expect the new tests green and the suite at the known master baseline (the 8 pre-existing `cockpit-draft` / `chat-page` / `chat-route` localStorage-jsdom failures may remain; verify they are identical on master and not newly introduced by this work).
- [ ] `pnpm run build` — expect 9/9.
- [ ] `pnpm biome check` (or the repo's biome command) — expect clean (no `!` non-null assertions introduced).

Then hand back for the holistic review + squash (Liz). **Not a Larissa-gated change** (client-only; no auth/sync/proxy/crypto; no new egress; no Dexie migration).

## Manual verification (device, Chris) — from the spec

1. **Cancel:** send a message; while streaming, the send button shows a stop icon → tap → stream halts, partial answer stays with a Retry footer, input is immediately usable. Then type+send a new message (continues), and on a fresh attempt tap Retry (re-rolls).
2. **Cancel a regenerate:** regenerate a reply, stop mid-stream → partial preserved with Retry, original not lost.
3. **Table overflow:** a Markdown table wider than 380 px scrolls horizontally inside its bubble; the chat stream shows no horizontal scrollbar; code blocks and maths still scroll as before.
4. **Read-only home:** open a chat, drop to reading mode → a small Chatsundere logo appears top-left → tap → lands in the Entrance Hall. Interaction-mode logo unchanged.
