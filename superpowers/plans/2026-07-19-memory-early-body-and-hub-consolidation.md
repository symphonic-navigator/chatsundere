# Memory: early body authoring & hub-reachable consolidation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user author a memory body before the first consolidation ever runs, and trigger consolidation from the persona hub (not only from a chat), whenever ≥1 committed journal entry exists.

**Architecture:** Consolidation is conceptually persona-scoped — `runDreaming`/`callModel` read only the persona + model bundle, never the chat. We split a chat-free args type off `MemoryPipelineArgs`, add a persona-based resolver, rewire `useMemoryActions` to `(personaId, chatId)`, and restructure the memory page so "Consolidate now" lives (always-rendered, disabled-with-reason) in the committed region while "Learn from this chat" stays chat-scoped, and the body editor renders from an empty state.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), React 18, Vitest + @testing-library, TanStack Query, Dexie. No new deps.

## Global Constraints

- **British English** in every artefact (code, comments, copy, commit messages). Spelling: `colour`, `behaviour`, `initialise`.
- **No `!` non-null assertions** — the Biome pre-commit gate bans them (`noNonNullAssertion`). Narrow with a local `const` + guard instead.
- **No Dexie bump** — no schema/store/index change in this work.
- **`strict: true`, `noUncheckedIndexedAccess: true`.** No `any` without an inline justification comment.
- **Not a Larissa path** (client-only; no `auth-service`/`sync-service`/`proxy-service`/`packages/crypto`). Larissa is not summoned.
- **Laura:** spec-pass already done (no hard defects); a pre-squash pass is owed before the squash (handled by the controller, not a task here).
- **SOFT-2 guardrail (folded):** when the committed list is empty, do NOT render committed-implying language ("Committed, awaiting consolidation"); only the neutral always-visible consolidate control shows.
- **SOFT-3 guardrail (folded):** the empty-body placeholder must name the consequence (what you write seeds the next consolidation), invitational, not a warning.
- **Verification commands** (from repo root `/home/chris/workspace/chatsundere`):
  - Run one test file: `pnpm --filter @chatsundere/user-client exec vitest run <path>`
  - Typecheck gate: `pnpm typecheck --force`
  - Full user-client suite baseline is **8** known Node-localStorage failures — expect exactly 8, no regression.

---

### Task 1: Persona-based consolidation args (`pipeline.ts` type split + `resolve-args.ts` resolver)

Introduce a chat-free `MemoryConsolidationArgs` type, narrow the consolidation-path functions to it, and add `resolveMemoryConsolidationArgs(personaId)` that resolves the persona + model bundle directly (no chat lookup), sharing a helper with the existing chat-based resolver.

**Files:**
- Modify: `apps/user-client/src/memory/pipeline.ts` (type + two param types)
- Modify: `apps/user-client/src/memory/resolve-args.ts` (shared helper + new resolver)
- Create: `apps/user-client/tests/memory/resolve-args.test.ts`

**Interfaces:**
- Produces: `MemoryConsolidationArgs = Omit<MemoryPipelineArgs, 'chat'>` (exported from `pipeline.ts`).
- Produces: `resolveMemoryConsolidationArgs(personaId: string, who: string): Promise<MemoryConsolidationArgs>` (exported from `resolve-args.ts`).
- Consumes: existing `resolveBackgroundBundle`, `getProvider`, `getOffering`, `openSecret`, `providerApiKeySlot`, `useSessionStore`, `getClientDataDb`.

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/memory/resolve-args.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';

const personasGet = vi.fn();
const providersGet = vi.fn();
const chatsGet = vi.fn();
vi.mock('../../src/boot/client-data-db.js', () => ({
  getClientDataDb: () => ({
    personas: { get: (...a: unknown[]) => personasGet(...a) },
    providers: { get: (...a: unknown[]) => providersGet(...a) },
    chats: { get: (...a: unknown[]) => chatsGet(...a) },
  }),
}));
const getState = vi.fn();
vi.mock('@chatsundere/ui-shared', () => ({ useSessionStore: { getState: () => getState() } }));
const getProvider = vi.fn();
const getOffering = vi.fn();
vi.mock('@chatsundere/llm-unified', () => ({
  getProvider: (...a: unknown[]) => getProvider(...a),
  getOffering: (...a: unknown[]) => getOffering(...a),
}));
vi.mock('../../src/lib/secrets.js', () => ({ openSecret: vi.fn(async () => 'sk-test') }));
vi.mock('../../src/data/providers.js', () => ({ providerApiKeySlot: () => 'slot' }));
const resolveBackgroundBundle = vi.fn();
vi.mock('../../src/data/resolve-background-offering.js', () => ({
  resolveBackgroundBundle: (...a: unknown[]) => resolveBackgroundBundle(...a),
}));

import { resolveMemoryConsolidationArgs } from '../../src/memory/resolve-args.js';

afterEach(() => vi.clearAllMocks());

describe('resolveMemoryConsolidationArgs', () => {
  it('throws when the master key is unavailable', async () => {
    getState.mockReturnValue({ mk: null });
    await expect(resolveMemoryConsolidationArgs('p1', 'memory-consolidate')).rejects.toThrow(
      /master key/,
    );
  });

  it('throws when the persona does not exist', async () => {
    getState.mockReturnValue({ mk: {} });
    personasGet.mockResolvedValue(undefined);
    await expect(resolveMemoryConsolidationArgs('p1', 'memory-consolidate')).rejects.toThrow(
      /persona not found/,
    );
  });

  it('resolves persona + model bundle from a personaId with no chat lookup', async () => {
    getState.mockReturnValue({ mk: {} });
    personasGet.mockResolvedValue({ id: 'p1', providerId: 'pr1', modelId: 'm1' });
    providersGet.mockResolvedValue({ templateId: 'nano-gpt', apiKey: {} });
    getProvider.mockReturnValue({ templateId: 'nano-gpt', baseUrl: 'https://x', corsHint: 'none' });
    getOffering.mockReturnValue({ id: 'm1' });
    resolveBackgroundBundle.mockResolvedValue({
      provider: { templateId: 'nano-gpt' },
      providerConfig: { baseUrl: 'https://x', routing: { kind: 'direct' } },
      apiKey: 'sk-test',
      offering: { id: 'm1' },
    });
    const args = await resolveMemoryConsolidationArgs('p1', 'memory-consolidate');
    expect(args.persona.id).toBe('p1');
    expect('chat' in args).toBe(false);
    expect(chatsGet).not.toHaveBeenCalled();
    expect(args.offering).toEqual({ id: 'm1' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/memory/resolve-args.test.ts`
Expected: FAIL — `resolveMemoryConsolidationArgs` is not exported from `resolve-args.js`.

- [ ] **Step 3: Add the `MemoryConsolidationArgs` type and narrow the consolidation functions in `pipeline.ts`**

In `apps/user-client/src/memory/pipeline.ts`, immediately after the `MemoryPipelineArgs` interface (ends at line 50), add:

```ts
/** The subset of args a persona-scoped consolidation needs — no chat. Extraction
 *  ("Learn from this chat") is the only path that reads `args.chat`. */
export type MemoryConsolidationArgs = Omit<MemoryPipelineArgs, 'chat'>;
```

Change the `callModel` signature (line 60-67) parameter type from `MemoryPipelineArgs` to `MemoryConsolidationArgs`:

```ts
async function callModel(
  args: MemoryConsolidationArgs,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  timeoutMs: number,
  onRawResponse?: (raw: MemoryRawResponse) => void,
): Promise<string> {
```

Change the `runDreaming` signature (line 163) parameter type from `MemoryPipelineArgs` to `MemoryConsolidationArgs`:

```ts
export async function runDreaming(
  args: MemoryConsolidationArgs,
  opts: {
```

Leave `runExtraction` on `MemoryPipelineArgs` (it reads `args.chat`) and `runMemoryPipeline` unchanged (it builds `MemoryPipelineArgs`, which is assignable to `MemoryConsolidationArgs` at the `runDreaming` call site).

- [ ] **Step 4: Add the shared bundle helper + persona resolver in `resolve-args.ts`**

Replace the entire body of `apps/user-client/src/memory/resolve-args.ts` with:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { getOffering, getProvider } from '@chatsundere/llm-unified';
import { useSessionStore } from '@chatsundere/ui-shared';
import { type PersonaRow, getClientDataDb } from '../boot/client-data-db.js';
import { providerApiKeySlot } from '../data/providers.js';
import { resolveBackgroundBundle } from '../data/resolve-background-offering.js';
import { openSecret } from '../lib/secrets.js';
import type { MemoryConsolidationArgs, MemoryPipelineArgs } from './pipeline.js';

type Db = ReturnType<typeof getClientDataDb>;
type MasterKey = NonNullable<ReturnType<typeof useSessionStore.getState>['mk']>;

/**
 * Resolve the model/credential bundle for a persona's background memory action —
 * provider, offering, decrypted API key, and the background-helper swap. Shared
 * by both the chat-based and persona-based entry points. `who` prefixes errors.
 */
async function resolvePersonaBundle(
  persona: PersonaRow,
  who: string,
  db: Db,
  mk: MasterKey,
): Promise<Omit<MemoryPipelineArgs, 'persona' | 'chat'>> {
  const provider = await db.providers.get(persona.providerId);
  if (!provider) throw new Error(`${who}: provider not found`);

  const providerDef = getProvider(provider.templateId);
  if (!providerDef) throw new Error(`${who}: unknown provider template "${provider.templateId}"`);

  const offering = getOffering(provider.templateId, persona.modelId);
  if (!offering)
    throw new Error(
      `${who}: no offering for "${persona.modelId}" on provider "${provider.templateId}" — re-pick the model`,
    );

  const apiKey = await openSecret(provider.apiKey, mk, providerApiKeySlot(provider));

  // Manual memory runs on the persona's background helper when set + reachable,
  // else the persona's own model (silent fallback — same as the auto pipeline).
  return resolveBackgroundBundle(
    persona,
    {
      provider: providerDef,
      providerConfig: {
        baseUrl: providerDef.baseUrl,
        routing:
          providerDef.corsHint === 'requires-proxy' ? { kind: 'cors-proxy' } : { kind: 'direct' },
      },
      apiKey,
      offering,
    },
    { db, mk },
  );
}

/**
 * Resolve args for a chat-scoped memory action (extraction). Loads the chat to
 * reach its persona, then the persona's model bundle.
 */
export async function resolveMemoryPipelineArgs(
  chatId: string,
  who: string,
): Promise<MemoryPipelineArgs> {
  const db = getClientDataDb();
  const mk = useSessionStore.getState().mk;
  if (!mk) throw new Error(`${who}: master key unavailable — re-authenticate`);

  const chat = await db.chats.get(chatId);
  if (!chat) throw new Error(`${who}: chat not found`);

  const persona = await db.personas.get(chat.personaId);
  if (!persona) throw new Error(`${who}: persona not found`);

  const bundle = await resolvePersonaBundle(persona, who, db, mk);
  return { persona, chat, ...bundle };
}

/**
 * Resolve args for a persona-scoped consolidation (dreaming). Loads the persona
 * directly — no chat needed — so "Consolidate now" is reachable from the hub.
 */
export async function resolveMemoryConsolidationArgs(
  personaId: string,
  who: string,
): Promise<MemoryConsolidationArgs> {
  const db = getClientDataDb();
  const mk = useSessionStore.getState().mk;
  if (!mk) throw new Error(`${who}: master key unavailable — re-authenticate`);

  const persona = await db.personas.get(personaId);
  if (!persona) throw new Error(`${who}: persona not found`);

  const bundle = await resolvePersonaBundle(persona, who, db, mk);
  return { persona, ...bundle };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/memory/resolve-args.test.ts`
Expected: PASS (3/3).

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck --force`
Expected: PASS (14/14). Confirms `MemoryPipelineArgs` is still assignable at the `runDreaming` call in `runMemoryPipeline`, and the `Omit` return types line up.

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/memory/pipeline.ts apps/user-client/src/memory/resolve-args.ts apps/user-client/tests/memory/resolve-args.test.ts
git commit -m "Add persona-scoped memory consolidation args resolver

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 2: Persona-scoped consolidate + hub reachability (`use-memory-actions.ts` + `persona-memory.tsx`)

Rewire the hook to `(personaId, chatId)` so consolidate resolves via the persona (works from the hub), drop `lastAttempted`, and restructure the page so "Consolidate now" lives in the committed region as an always-rendered control (B2 / SOFT-2) with its own error slot, "Learn from this chat" stays chat-scoped with its own slot, and the orient copy is shortened. Body-from-empty is Task 3.

**Files:**
- Modify: `apps/user-client/src/lib/use-memory-actions.ts`
- Modify: `apps/user-client/src/routes/app/persona-memory.tsx`
- Modify: `apps/user-client/tests/lib/use-memory-actions.test.tsx`
- Modify: `apps/user-client/tests/routes/persona-memory.test.tsx`

**Interfaces:**
- Consumes: `resolveMemoryConsolidationArgs`, `resolveMemoryPipelineArgs` (Task 1).
- Produces: `useMemoryActions(personaId: string, chatId: string): { learnState, consolidateState, learnNow, consolidateNow }` (no `lastAttempted`).

- [ ] **Step 1: Update the hook test to the new signature + persona-based consolidate**

In `apps/user-client/tests/lib/use-memory-actions.test.tsx`:

Add a `resolveMemoryConsolidationArgs` mock and expose it from the `resolve-args` module mock (replace lines 5-10):

```ts
const resolveMemoryPipelineArgs = vi.fn();
const resolveMemoryConsolidationArgs = vi.fn();
vi.mock('../../src/memory/resolve-args.js', () => ({
  resolveMemoryPipelineArgs: (...a: unknown[]) => resolveMemoryPipelineArgs(...a),
  resolveMemoryConsolidationArgs: (...a: unknown[]) => resolveMemoryConsolidationArgs(...a),
}));
```

Change every `renderHook(() => useMemoryActions('c1'))` to `renderHook(() => useMemoryActions('p1', 'c1'))` (9 occurrences).

For the **learn** test (currently lines 38-51), keep `resolveMemoryPipelineArgs.mockResolvedValue({ persona: { id: 'p1' } })` and add a resolver assertion:

```ts
  it('learnNow goes pending → idle on success and forces extraction', async () => {
    resolveMemoryPipelineArgs.mockResolvedValue({ persona: { id: 'p1' } });
    tryAcquireMemoryLock.mockReturnValue(true);
    runExtraction.mockResolvedValue(2);
    const { result } = renderHook(() => useMemoryActions('p1', 'c1'));
    await act(async () => {
      await result.current.learnNow();
    });
    expect(resolveMemoryPipelineArgs).toHaveBeenCalledWith('c1', 'memory-learn');
    expect(runExtraction).toHaveBeenCalledWith(
      { persona: { id: 'p1' } },
      { force: true, onRawResponse: expect.any(Function) },
    );
    await waitFor(() => expect(result.current.learnState.status).toBe('idle'));
  });
```

For **every consolidate test** (the ones that call `result.current.consolidateNow()` — currently lines 53-156), change the resolver mock from `resolveMemoryPipelineArgs` to `resolveMemoryConsolidationArgs`. E.g. the resolution-failure test becomes:

```ts
  it('consolidateNow sets error when resolution fails', async () => {
    resolveMemoryConsolidationArgs.mockRejectedValue(new Error('master key unavailable'));
    tryAcquireMemoryLock.mockReturnValue(true);
    const { result } = renderHook(() => useMemoryActions('p1', 'c1'));
    await act(async () => {
      await result.current.consolidateNow();
    });
    await waitFor(() => expect(result.current.consolidateState.status).toBe('error'));
    expect(result.current.consolidateState.error).toBe('no-credentials');
  });
```

Apply the same `resolveMemoryPipelineArgs` → `resolveMemoryConsolidationArgs` swap in the other consolidate tests (the "captures the last model answer", "leaves response undefined", "busy toast", "acquires and releases the mutex", "invalidates per slice", "classifies the failure" tests), each still resolving `{ persona: { id: 'p1' } }`.

Add a resolver assertion to the mutex test:

```ts
  it('acquires and releases the mutex around a successful consolidate', async () => {
    resolveMemoryConsolidationArgs.mockResolvedValue({ persona: { id: 'p1' } });
    tryAcquireMemoryLock.mockReturnValue(true);
    runDreaming.mockResolvedValue(true);
    const { result } = renderHook(() => useMemoryActions('p1', 'c1'));
    await act(async () => {
      await result.current.consolidateNow();
    });
    expect(resolveMemoryConsolidationArgs).toHaveBeenCalledWith('p1', 'memory-consolidate');
    expect(tryAcquireMemoryLock).toHaveBeenCalledWith('p1');
    expect(releaseMemoryLock).toHaveBeenCalledWith('p1');
  });
```

**Delete** the `records lastAttempted for error-slot precedence` test entirely (currently lines 158-168).

- [ ] **Step 2: Run the hook test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/lib/use-memory-actions.test.tsx`
Expected: FAIL — `useMemoryActions` still takes one arg / consolidate still calls `resolveMemoryPipelineArgs` / `lastAttempted` removed usages.

- [ ] **Step 3: Rewrite the hook**

Replace the whole of `apps/user-client/src/lib/use-memory-actions.ts` with:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useState } from 'react';
import { QK } from '../data/queryKeys.js';
import { type MemoryActionError, classifyMemoryActionError } from '../memory/classify-error.js';
import { releaseMemoryLock, tryAcquireMemoryLock } from '../memory/mutex.js';
import { type MemoryRawResponse, runDreaming, runExtraction } from '../memory/pipeline.js';
import {
  resolveMemoryConsolidationArgs,
  resolveMemoryPipelineArgs,
} from '../memory/resolve-args.js';
import { toastStore } from '../state/toast.store.js';
import { queryClient } from './queryClient.js';

export interface MemoryActionState {
  status: 'idle' | 'pending' | 'error';
  error?: MemoryActionError;
  /** Consolidation slices checkpointed before a failure (partial progress). */
  partialSlices?: number;
  /**
   * The raw model answer from the failing call (content + reasoning, split),
   * when one was parsed. Present only on `error` and only when a 2xx body was
   * received — powers the "show the model's answer" debug view. Absent for
   * timeouts and non-2xx failures, which never yield a model message.
   */
  response?: MemoryRawResponse;
}

const IDLE: MemoryActionState = { status: 'idle' };

/** On-demand "learn from this chat" (chat-scoped) / "consolidate now"
 *  (persona-scoped, reachable from the hub) actions for the memory page.
 *  Resolves credentials lazily on click; never on render. Takes the same
 *  per-persona mutex as the background pipeline so the two never interleave.
 *  Each action owns its own error state — no shared slot, so copy + Retry can
 *  never refer to a different action. */
export function useMemoryActions(
  personaId: string,
  chatId: string,
): {
  learnState: MemoryActionState;
  consolidateState: MemoryActionState;
  learnNow: () => Promise<void>;
  consolidateNow: () => Promise<void>;
} {
  const [learnState, setLearnState] = useState<MemoryActionState>(IDLE);
  const [consolidateState, setConsolidateState] = useState<MemoryActionState>(IDLE);

  const run = useCallback(
    async (
      kind: 'learn' | 'consolidate',
      setState: (s: MemoryActionState) => void,
    ): Promise<void> => {
      let lockPersonaId: string | null = null;
      let slices = 0;
      // Last parsed model answer — held so the error path can offer a debug view
      // of what the model actually returned (chiefly: reasoning but no content).
      let lastResponse: MemoryRawResponse | undefined;
      const onRawResponse = (r: MemoryRawResponse): void => {
        lastResponse = r;
      };
      try {
        if (kind === 'learn') {
          const args = await resolveMemoryPipelineArgs(chatId, 'memory-learn');
          lockPersonaId = args.persona.id;
          if (!tryAcquireMemoryLock(lockPersonaId)) {
            toastStore.show({
              message: 'Already working on this — give it a moment.',
              tone: 'info',
              durationMs: 4000,
            });
            return;
          }
          setState({ status: 'pending' });
          try {
            await runExtraction(args, { force: true, onRawResponse });
            setState(IDLE);
          } finally {
            releaseMemoryLock(lockPersonaId);
          }
        } else {
          const args = await resolveMemoryConsolidationArgs(personaId, 'memory-consolidate');
          lockPersonaId = args.persona.id;
          if (!tryAcquireMemoryLock(lockPersonaId)) {
            toastStore.show({
              message: 'Already working on this — give it a moment.',
              tone: 'info',
              durationMs: 4000,
            });
            return;
          }
          setState({ status: 'pending' });
          const id = lockPersonaId;
          try {
            await runDreaming(args, {
              force: true,
              onRawResponse,
              onSlice: () => {
                slices += 1;
                void queryClient.invalidateQueries({ queryKey: QK.memory(id) });
              },
            });
            setState(IDLE);
          } finally {
            releaseMemoryLock(lockPersonaId);
          }
        }
      } catch (e) {
        setState({
          status: 'error',
          error: classifyMemoryActionError(e),
          partialSlices: slices,
          response: lastResponse,
        });
      } finally {
        // Error paths must refresh too: a mid-drain failure has already archived
        // slices, and the committed list must show the true remainder (Laura HARD-1).
        if (lockPersonaId) void queryClient.invalidateQueries({ queryKey: QK.memory(lockPersonaId) });
        void queryClient.invalidateQueries({ queryKey: QK.unextractedCount(chatId) });
      }
    },
    [personaId, chatId],
  );

  const learnNow = useCallback(() => run('learn', setLearnState), [run]);
  const consolidateNow = useCallback(() => run('consolidate', setConsolidateState), [run]);

  return { learnState, consolidateState, learnNow, consolidateNow };
}
```

- [ ] **Step 4: Run the hook test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/lib/use-memory-actions.test.tsx`
Expected: PASS.

- [ ] **Step 5: Update the component test for the new hook + layout**

In `apps/user-client/tests/routes/persona-memory.test.tsx`:

Add `within` to the testing-library import (line 3):

```ts
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
```

Remove `lastAttempted` from the `mockMemoryActions` helper — delete the field from the `overrides` type (line 31) and from the `mockReturnValue` object (line 41). The helper becomes:

```ts
function mockMemoryActions(
  overrides: {
    learnState?: MemoryActionState;
    consolidateState?: MemoryActionState;
    learnNow?: () => Promise<void>;
    consolidateNow?: () => Promise<void>;
  } = {},
) {
  mockedUseMemoryActions.mockReturnValue({
    learnState: overrides.learnState ?? { status: 'idle' },
    consolidateState: overrides.consolidateState ?? { status: 'idle' },
    learnNow: overrides.learnNow ?? vi.fn(),
    consolidateNow: overrides.consolidateNow ?? vi.fn(),
  });
}
```

Delete every `lastAttempted: 'consolidate',` line from the individual `mockMemoryActions({ ... })` calls in the "action error copy" describe block (7 occurrences).

Replace the "omits the actions block…" test (currently lines 213-218) with two tests:

```ts
  it('on the hub path shows no Learn button, the shortened orient line, and a disabled Consolidate control', async () => {
    setup('/app/persona/p1/memory');
    await screen.findByRole('heading', { level: 1, name: /memory/i });
    expect(screen.queryByRole('button', { name: /learn from this chat/i })).not.toBeInTheDocument();
    expect(screen.getByText(/open a chat with fable to learn new memories\./i)).toBeInTheDocument();
    const consolidate = screen.getByRole('button', { name: /consolidate now/i });
    expect(consolidate).toBeInTheDocument();
    expect(consolidate).toBeDisabled();
  });

  it('on the hub path enables Consolidate once a committed entry exists', async () => {
    await addJournalEntries('p1', [
      { content: 'known', category: 'fact', isCorrection: false },
    ]);
    const [row] = await import('../../src/memory/repo.js').then((m) =>
      m.listJournal('p1', 'uncommitted'),
    );
    if (row) await commitEntry(row.id);
    setup('/app/persona/p1/memory');
    await screen.findByRole('heading', { level: 1, name: /memory/i });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /consolidate now/i })).toBeEnabled(),
    );
  });
```

Replace the "error slot and Retry follow the most recently attempted action" test (currently lines 251-270) with an independent-slots test:

```ts
  it('shows learn and consolidate errors in independent slots, each Retry firing its own action', async () => {
    const learnNow = vi.fn();
    const consolidateNow = vi.fn();
    mockMemoryActions({
      learnState: { status: 'error', error: 'failed' },
      consolidateState: { status: 'error', error: 'upstream-busy' },
      learnNow,
      consolidateNow,
    });
    renderPage({ chat: 'c1' });
    // Both copies present, each in its own alert region.
    expect(
      await screen.findByText("That didn't work — but nothing was lost. Try again."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Your AI provider is having trouble right now. Nothing was lost — try again in a few minutes.',
      ),
    ).toBeInTheDocument();
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(2);
    const [learnAlert, consolidateAlert] = alerts;
    if (!learnAlert || !consolidateAlert) throw new Error('expected two error alerts');
    await userEvent.click(within(learnAlert).getByRole('button', { name: 'Retry' }));
    expect(learnNow).toHaveBeenCalled();
    await userEvent.click(within(consolidateAlert).getByRole('button', { name: 'Retry' }));
    expect(consolidateNow).toHaveBeenCalled();
  });
```

Leave the other tests ("shows the actions block on the chat path", the timeout/partial-progress/debug-view/overlay/long-run tests) as-is apart from the `lastAttempted` removals — they render on the chat path where the consolidate control is present, so their assertions still hold.

- [ ] **Step 6: Run the component test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/routes/persona-memory.test.tsx`
Expected: FAIL — the page still passes one arg to `useMemoryActions`, still keeps consolidate inside the chat block, and the orient copy still says "or consolidate".

- [ ] **Step 7: Restructure the page**

In `apps/user-client/src/routes/app/persona-memory.tsx`:

**(a)** Change the hook destructure (lines 82-83) to pass `personaId` and drop `lastAttempted`:

```tsx
  const { learnState, consolidateState, learnNow, consolidateNow } = useMemoryActions(
    personaId,
    chatId,
  );
```

**(b)** Replace the entire chat-actions block (lines 315-384, the `{chatId ? ( … ) : ( … )}` including the `lastAttempted` IIFE) with a learn-only block:

```tsx
        {/* ── Learn from this chat (chat-scoped) ─────────────────────────── */}
        {chatId ? (
          <div className="memory-page-actions">
            <button
              type="button"
              disabled={unextracted < 1 || learnState.status === 'pending'}
              title={unextracted < 1 ? 'Nothing new to learn yet — keep chatting.' : undefined}
              onClick={() => void learnNow()}
            >
              {learnState.status === 'pending' ? 'Learning…' : 'Learn from this chat'}
            </button>
            {learnState.status === 'pending' ? (
              <p className="text-[11px] text-paper-soft">
                This can take a minute or two — you can leave this page; it keeps going.
              </p>
            ) : null}
            {learnState.status === 'error'
              ? (() => {
                  const response = learnState.response;
                  return (
                    <>
                      <div className="memory-page-action-error" role="alert">
                        <span>{memoryErrorCopy(learnState)}</span>
                        <button type="button" onClick={() => void learnNow()}>
                          Retry
                        </button>
                      </div>
                      {response ? (
                        <button
                          type="button"
                          className="memory-page-inspect"
                          onClick={() => setInspecting(response)}
                        >
                          Show the model's answer
                        </button>
                      ) : null}
                    </>
                  );
                })()
              : null}
          </div>
        ) : (
          <p className="memory-page-orient">
            Open a chat with {persona.name} to learn new memories.
          </p>
        )}
```

**(c)** Replace the committed-entries section (lines 400-406, the `{visibleCommitted.length > 0 ? ( … ) : null}` block) with a committed-list-plus-always-rendered-consolidate section:

```tsx
        {/* ── Committed entries + Consolidate (persona-scoped; control always shown, */}
        {/*    committed-state language only when entries exist — Laura SOFT-2) ────── */}
        <div className="memory-page-section">
          {visibleCommitted.length > 0 ? (
            <>
              <h2 className="memory-page-subhead">Committed, awaiting consolidation</h2>
              <ul className="memory-page-list">
                {visibleCommitted.map((e) => renderRow(e, false))}
              </ul>
            </>
          ) : null}
          <div className="memory-page-actions">
            <button
              type="button"
              disabled={committed.length < 1 || consolidateState.status === 'pending'}
              title={committed.length < 1 ? 'No committed memories to consolidate yet.' : undefined}
              onClick={() => void consolidateNow()}
            >
              {consolidateState.status === 'pending' ? 'Consolidating…' : 'Consolidate now'}
            </button>
            {consolidateState.status === 'pending' ? (
              <p className="text-[11px] text-paper-soft">
                This can take a minute or two for a large memory — you can leave this page; it
                keeps going.
              </p>
            ) : null}
            {consolidateState.status === 'error'
              ? (() => {
                  const response = consolidateState.response;
                  return (
                    <>
                      <div className="memory-page-action-error" role="alert">
                        <span>{memoryErrorCopy(consolidateState)}</span>
                        <button type="button" onClick={() => void consolidateNow()}>
                          Retry
                        </button>
                      </div>
                      {response ? (
                        <button
                          type="button"
                          className="memory-page-inspect"
                          onClick={() => setInspecting(response)}
                        >
                          Show the model's answer
                        </button>
                      ) : null}
                    </>
                  );
                })()
              : null}
          </div>
        </div>
```

- [ ] **Step 8: Run the component test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/routes/persona-memory.test.tsx`
Expected: PASS (the body "empty state" test still passes here — it is updated in Task 3).

- [ ] **Step 9: Typecheck**

Run: `pnpm typecheck --force`
Expected: PASS (14/14). Confirms no dangling `lastAttempted` reference remains.

- [ ] **Step 10: Commit**

```bash
git add apps/user-client/src/lib/use-memory-actions.ts apps/user-client/src/routes/app/persona-memory.tsx apps/user-client/tests/lib/use-memory-actions.test.tsx apps/user-client/tests/routes/persona-memory.test.tsx
git commit -m "Make memory consolidation persona-scoped and reachable from the hub

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 3: Body editable from empty (`persona-memory.tsx` body section)

Render the memory-body editor from an empty state (before any version exists) with a consequence-naming placeholder (SOFT-3), instead of the dead "Nothing remembered yet." placeholder.

**Files:**
- Modify: `apps/user-client/src/routes/app/persona-memory.tsx` (the "The memory itself" section)
- Modify: `apps/user-client/tests/routes/persona-memory.test.tsx` (the body describe block)

**Interfaces:**
- Consumes: existing `bodyDraft`/`setBodyDraft`, `saveBodyManual`, `versions`, `currentBody`, `rollback`, `class2`.
- Produces: nothing new.

- [ ] **Step 1: Update the body tests**

In `apps/user-client/tests/routes/persona-memory.test.tsx`, in the `PersonaMemory — body` describe block, replace the "shows an empty state when nothing is remembered yet" test (currently lines 198-201) with:

```ts
  it('renders an empty editable body when nothing is remembered yet', async () => {
    setup('/app/persona/p1/memory');
    const box = await screen.findByLabelText(/memory body/i);
    expect(box).toHaveValue('');
    expect(screen.getByRole('button', { name: /save memory/i })).toBeDisabled();
    expect(screen.queryByText(/nothing remembered yet/i)).not.toBeInTheDocument();
  });

  it('saves a first body authored from empty as v1', async () => {
    setup('/app/persona/p1/memory');
    const box = await screen.findByLabelText(/memory body/i);
    await userEvent.type(box, 'seed memory');
    await userEvent.click(screen.getByRole('button', { name: /save memory/i }));
    await waitFor(() => expect(screen.getByText(/v1 ·/i)).toBeInTheDocument());
  });
```

- [ ] **Step 2: Run the body test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/routes/persona-memory.test.tsx -t "editable body"`
Expected: FAIL — the memory-body textarea is not rendered when `versions.length === 0`.

- [ ] **Step 3: Render the editor from empty**

In `apps/user-client/src/routes/app/persona-memory.tsx`, replace the "The memory itself" section (lines 408-458 — the `{versions.length === 0 ? ( … ) : ( … )}` block) with an always-rendered editor plus a conditional version list:

```tsx
        {/* ── The memory body + version history ─────────────────────────── */}
        <div className="memory-page-section">
          <h2 className="memory-page-subhead">The memory itself</h2>
          <AutoSizeTextarea
            aria-label="Memory body"
            placeholder={`Write what ${persona.name} should remember about you — this becomes the starting point the next consolidation builds on.`}
            minRows={4}
            maxRows={30}
            value={bodyDraft}
            onChange={setBodyDraft}
          />
          <button
            type="button"
            className="memory-page-save-body"
            disabled={
              class2.disabled ||
              bodyDraft.trim() === '' ||
              bodyDraft === (currentBody?.content ?? '')
            }
            title={class2.disabled ? (class2.tooltip ?? undefined) : undefined}
            onClick={() => saveBodyManual.mutate(bodyDraft)}
          >
            Save memory
          </button>
          {versions.length > 0 ? (
            <ul className="memory-page-version-list">
              {versions.map((v) => (
                <li key={v.id}>
                  <span>
                    v{v.version} · {v.source}
                  </span>
                  {v.version !== (currentBody?.version ?? 0) ? (
                    <button
                      type="button"
                      disabled={class2.disabled}
                      title={class2.disabled ? (class2.tooltip ?? undefined) : undefined}
                      onClick={() => rollback.mutate(v.version)}
                    >
                      Restore
                    </button>
                  ) : (
                    <span className="memory-page-version-current">current</span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
```

- [ ] **Step 4: Run the body test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/routes/persona-memory.test.tsx`
Expected: PASS (whole file, including the existing "shows the current body and saves an edit" and "restores an older version" tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck --force`
Expected: PASS (14/14).

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/routes/app/persona-memory.tsx apps/user-client/tests/routes/persona-memory.test.tsx
git commit -m "Allow authoring a memory body before the first consolidation

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- [ ] **Full user-client suite:** `pnpm --filter @chatsundere/user-client test` (or the repo's configured runner). Expect the **8** known Node-localStorage baseline failures, no others.
- [ ] **Typecheck gate:** `pnpm typecheck --force` → 14/14.
- [ ] **Build:** `pnpm run build` → 9/9.
- [ ] **Biome:** clean on all touched files.
- [ ] **Laura pre-squash pass** (controller summons; verifies the built flow honours the spec §4.3 layout + the SOFT-2/SOFT-3 guardrails).
- [ ] **Restart the dev stack** before Chris's manual verification (Vite HMR ignores `packages/*`; a fresh boot loads the new resolver + hook cleanly). Manual steps: spec §8.

## Self-review notes (author)

- **Spec coverage:** Gap 1 → Task 3; Gap 2 args/hook → Tasks 1-2; Gap 2 UI (B2, always-rendered, SOFT-2) → Task 2 step 7(c); orient copy → Task 2 step 7(b); SOFT-3 placeholder → Task 3 step 3; error-slot split + drop `lastAttempted` → Task 2. Tests per §7 → Tasks 1-3. No Dexie bump, no Larissa → constraints. All spec sections map to a task.
- **Type consistency:** `MemoryConsolidationArgs` defined in `pipeline.ts` (Task 1), imported by `resolve-args.ts` (Task 1) and consumed by the hook via `resolveMemoryConsolidationArgs` (Task 2). Hook return type drops `lastAttempted` consistently across hook, page destructure, and both mocks.
- **Placeholder scan:** concrete copy strings, concrete test code, exact paths/line ranges throughout.
