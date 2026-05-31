# Non-destructive Regenerate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Regenerate control so it re-rolls only the last persona answer, never deleting or risking the user's prompt.

**Architecture:** Regenerate is a normal send with two deviations — the user message is reused (no delete/re-insert) and streaming targets the existing last persona message (cleared → `incomplete`) instead of inserting a fresh draft. The stream-manager's streaming core is extracted into an internal `runIntoDraft(...)` shared by `start()` (insert user + draft, then stream) and a new `regenerate()` (clear the last persona message, then stream into it). Persona/provider/secret resolution is extracted into a shared `resolvePersonaContext(...)` used by both `useSendMessage` and the rebuilt `useRegenerate`.

**Tech Stack:** TypeScript (strict), React 18, Zustand, Dexie (IndexedDB), TanStack Query, `@chatsundere/llm-unified`. Tests: Vitest + `@testing-library/react` + `fake-indexeddb`.

**Spec:** `superpowers/specs/2026-05-31-non-destructive-regenerate-design.md`

**Area:** `apps/user-client` only — frontend change, no Larissa audit (no `auth`/`crypto`/`sync`/`proxy` touched). Run `pnpm typecheck` (the CI gate) before the final commit.

---

## File Structure

**Modified:**
- `apps/user-client/src/state/stream-manager.store.ts` — extract `runIntoDraft(...)`; add `regenerate(chatId, args)` to the store interface + implementation.
- `apps/user-client/src/data/send-message.ts` — extract `resolvePersonaContext(...)`; rewrite `useRegenerate` to be non-destructive; reuse the helper in `useSendMessage`.
- `apps/user-client/src/components/chat/ChatStream.tsx` — replace the `onRegenerate` stub with a real callback prop forwarded from ChatPage.
- `apps/user-client/src/routes/app/chat/chat-page.tsx` — wire `useRegenerate` into ChatStream.

**Tests:**
- `apps/user-client/tests/unit/stream-manager-store.test.ts` — add `regenerate()` cases.
- `apps/user-client/tests/unit/use-regenerate.test.tsx` — replace destructive-behaviour tests with non-destructive ones.
- `apps/user-client/tests/unit/chat-route.test.tsx` — add the regenerate chat-route test STATUS flags as missing.

---

## Design contract (read before Task 1)

### New store method shape

`regenerate` reuses `StartArgs` minus `userText` (there is no new user text — the existing last user message supplies it). It takes the `targetMessageId` (the persona message to re-roll into) explicitly so the caller stays in control of which row is reused.

```ts
// in StreamManagerStore interface
regenerate: (args: RegenerateStreamArgs) => Promise<void>;

// new exported type alongside StartArgs
export type RegenerateStreamArgs = Omit<StartStreamArgs, 'signal' | 'onChunk'> & {
  chatId: string;
  targetMessageId: string; // the existing persona MessageRow to re-roll into
};
```

`StartStreamArgs` already carries `priorMessages` and `userMessageText` (see `stream-engine.ts:24-40`). For regenerate the caller sets:
- `priorMessages` = all messages **before** the last user message,
- `userMessageText` = the last user message's text.

This makes the wire payload identical to the original send (system + prior + user), with the old answer absent — exactly the spec's "as if the message were new in the conversation".

### Extracted helper shape (send-message.ts)

```ts
// Resolves persona → provider → ProviderDefinition → Offering and decrypts
// secrets. Throws with a caller-prefixed message on any missing link.
interface PersonaContext {
  chat: ChatRow;
  persona: PersonaRow;
  providerDef: ProviderDefinition;
  providerConfig: ProviderConfig;
  apiKey: string;
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  offering: Offering;
  globalUnlocker: string;
  globalAboutMe: string;
}

async function resolvePersonaContext(chatId: string, who: string): Promise<PersonaContext>;
```

`who` is a short label (`'useSendMessage'` / `'useRegenerate'`) used in error messages so the existing message text is preserved.

---

## Task 1: Extract `runIntoDraft` in the stream-manager (pure refactor)

**Files:**
- Modify: `apps/user-client/src/state/stream-manager.store.ts`
- Test: `apps/user-client/tests/unit/stream-manager-store.test.ts`

This task changes no behaviour — `start()` keeps its exact contract. We extract the handle-lifecycle + engine-run + success/error persistence into one private helper so Task 2 can reuse it. The existing store tests are the safety net.

- [ ] **Step 1: Run the existing store tests to confirm green baseline**

Run: `cd apps/user-client && pnpm vitest run tests/unit/stream-manager-store.test.ts`
Expected: PASS (all existing cases).

- [ ] **Step 2: Introduce `runIntoDraft` and call it from `start()`**

In `stream-manager.store.ts`, add a module-private function below the store and have `start()` delegate to it after the insert transaction. `runIntoDraft` receives the already-created `draftMessageId` plus the full engine args. Move the `controller`/`handle`/`set`/`runStreamEngine(...).then(...).catch(...)` block (currently `stream-manager.store.ts:99-244`) verbatim into it.

```ts
/**
 * Stream one turn into an already-persisted draft persona-message
 * (`draftMessageId`), mirroring tokens into a live handle and persisting the
 * final/partial content on success/failure. Shared by `start` (fresh send)
 * and `regenerate` (re-roll of the last answer). Does NOT insert any rows —
 * the caller owns row creation/clearing.
 */
function runIntoDraft(
  args: StartArgs,
  draftMessageId: string,
  set: (fn: (s: StreamManagerStore) => Partial<StreamManagerStore>) => void,
  get: () => StreamManagerStore,
): void {
  const db = getClientDataDb();
  const now = Date.now();
  const controller = new AbortController();
  const handle: StreamHandle = {
    chatId: args.chatId,
    personaId: args.persona.id,
    draftMessageId,
    controller,
    status: 'streaming',
    contentBuffer: [],
    pillBuffer: [],
    startedAt: now,
  };

  set((s) => {
    const m = new Map(s.streams);
    m.set(args.chatId, handle);
    return { streams: m };
  });

  runStreamEngine({
    ...args,
    signal: controller.signal,
    onChunk: (chunk) => {
      if (chunk.type !== 'token' && chunk.type !== 'reasoning') return;
      set((s) => {
        const live = s.streams.get(args.chatId);
        if (!live) return s;
        const nextBuf = [...live.contentBuffer];
        appendStreamChunk(nextBuf, {
          kind: chunk.type === 'reasoning' ? 'reasoning' : 'text',
          text: chunk.text,
        });
        const nextHandle = { ...live, contentBuffer: nextBuf };
        const m = new Map(s.streams);
        m.set(args.chatId, nextHandle);
        return { streams: m };
      });
    },
  })
    .then(async (result) => {
      const current = get().streams.get(args.chatId);
      if (!current) return;

      set((s) => {
        const live = s.streams.get(args.chatId);
        if (!live) return s;
        const m = new Map(s.streams);
        m.set(args.chatId, { ...live, status: 'finalising' });
        return { streams: m };
      });

      const pillsWithMessageId = result.pillRows.map((p) => ({
        ...p,
        messageId: draftMessageId,
      }));

      await db.transaction('rw', db.messages, db.pills, db.chats, async () => {
        await db.messages.update(draftMessageId, {
          contentBlocks: result.finalContentBlocks,
          streamingState: 'complete',
        });
        if (pillsWithMessageId.length) await db.pills.bulkAdd(pillsWithMessageId);
        await db.chats.update(args.chatId, { lastMessageAt: Date.now() });
      });

      void queryClient.invalidateQueries({ queryKey: ['chats', args.chatId] });
      void queryClient.invalidateQueries({ queryKey: ['chats'] });

      const chatAfter = await db.chats.get(args.chatId);
      if (chatAfter && chatAfter.title === null) {
        const personaMsgCount = await db.messages
          .where('chatId')
          .equals(args.chatId)
          .filter((m) => m.role === 'persona' && m.streamingState === 'complete')
          .count();
        if (personaMsgCount === 1) {
          void fireTitleGen(args, result.finalContentBlocks);
        }
      }

      set((s) => {
        const live = s.streams.get(args.chatId);
        if (!live) return s;
        const m = new Map(s.streams);
        m.set(args.chatId, { ...live, status: 'done' });
        return { streams: m };
      });

      setTimeout(() => {
        set((s) => {
          const m = new Map(s.streams);
          m.delete(args.chatId);
          return { streams: m };
        });
      }, 200);
    })
    .catch(async (err) => {
      const current = get().streams.get(args.chatId);
      if (!current) return;

      console.error('[stream-manager] stream failed for chat', args.chatId, err);

      await db.messages.update(draftMessageId, {
        contentBlocks: current.contentBuffer,
        streamingState: 'incomplete',
      });
      void queryClient.invalidateQueries({ queryKey: ['chats', args.chatId] });

      set((s) => {
        const m = new Map(s.streams);
        m.delete(args.chatId);
        return { streams: m };
      });

      toastStore.show({
        message: `${args.persona.name} couldn't reach the model — retry from the chat`,
        tone: 'warn',
        durationMs: 6000,
      });
    });
}
```

Then shrink `start()` to: build ids → insert-transaction (unchanged, `stream-manager.store.ts:71-97`) → `runIntoDraft(args, draftMessageId, set, get)`.

```ts
  start: async (args) => {
    const db = getClientDataDb();
    const now = Date.now();
    const userMessageId = uuidv7();
    const draftMessageId = uuidv7();

    await db.transaction('rw', db.messages, db.chats, async () => {
      await db.messages.add({
        id: userMessageId,
        chatId: args.chatId,
        role: 'user',
        contentBlocks: [{ type: 'text', text: args.userText }],
        createdAt: now,
        bookmarked: false,
        streamingState: 'complete',
      });
      await db.messages.add({
        id: draftMessageId,
        chatId: args.chatId,
        role: 'persona',
        contentBlocks: [],
        createdAt: now + 1,
        bookmarked: false,
        streamingState: 'incomplete',
      });
      await db.chats.update(args.chatId, { lastMessageAt: now + 1, draftInput: '' });
    });

    runIntoDraft(args, draftMessageId, set, get);
  },
```

Note: `runIntoDraft` takes `StartArgs`. `RegenerateStreamArgs` (Task 2) carries `userText` too — set it to the replayed user text so `fireTitleGen`'s `args.userText` stays correct.

- [ ] **Step 3: Run the store tests — behaviour must be unchanged**

Run: `cd apps/user-client && pnpm vitest run tests/unit/stream-manager-store.test.ts`
Expected: PASS (same cases as Step 1, no diff in outcomes).

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/state/stream-manager.store.ts
git commit -m "Extract runIntoDraft from stream-manager.start (no behaviour change)"
```

---

## Task 2: Add `regenerate()` to the stream-manager store

**Files:**
- Modify: `apps/user-client/src/state/stream-manager.store.ts`
- Test: `apps/user-client/tests/unit/stream-manager-store.test.ts`

`regenerate` clears the target persona message (empty content, `incomplete`) in a transaction, then streams into it via `runIntoDraft`. No row insertion, no user-message touch.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/stream-manager-store.test.ts`. Reuse the file's existing `seedChat()` + `baseStartArgs(chatId, persona, model)` helpers and the file's `vi.spyOn(engine, 'runStreamEngine')` mock pattern (the file imports `* as engine`). Seed a complete exchange (and set the chat title to a non-null value so the success path's first-response title-gen branch does **not** fire — `generateTitleAsync` is not mocked in this case), then regenerate into the persona row and assert the user row is untouched and the persona row gets the new content.

```ts
  it('regenerate re-rolls into the target persona message, leaving the user row intact', async () => {
    const { db, chatId, personaId } = await seedChat();
    await db.chats.update(chatId, { title: 'kept' }); // suppress first-response title-gen
    const persona = await db.personas.get(personaId);
    const model = nanoGpt.offerings[0];
    const userId = 'u1';
    const personaMsgId = 'pm1';
    await db.messages.add({
      id: userId,
      chatId,
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'tell me a joke' }],
      createdAt: 2,
      bookmarked: false,
      streamingState: 'complete',
    });
    await db.messages.add({
      id: personaMsgId,
      chatId,
      role: 'persona',
      contentBlocks: [{ type: 'text', text: 'old answer' }],
      createdAt: 3,
      bookmarked: false,
      streamingState: 'complete',
    });

    vi.spyOn(engine, 'runStreamEngine').mockImplementation((async (a: {
      onChunk: (c: unknown) => void;
    }) => {
      a.onChunk({ type: 'token', text: 'new answer' });
      return {
        finalContentBlocks: [{ type: 'text', text: 'new answer' }],
        pillRows: [],
        finishReason: 'stop',
      };
    }) as never);

    const store = useStreamManagerStore.getState();
    await store.regenerate({
      ...baseStartArgs(chatId, persona, model),
      userMessageText: 'tell me a joke',
      priorMessages: [],
      targetMessageId: personaMsgId,
    } as never);
    await new Promise((r) => setTimeout(r, 50));

    const personaRow = await db.messages.get(personaMsgId);
    expect(personaRow?.streamingState).toBe('complete');
    expect(personaRow?.contentBlocks).toEqual([{ type: 'text', text: 'new answer' }]);
    // User row never touched: same id, same content, still present.
    const user = await db.messages.get(userId);
    expect(user?.contentBlocks).toEqual([{ type: 'text', text: 'tell me a joke' }]);
    const count = await db.messages.where('chatId').equals(chatId).count();
    expect(count).toBe(2);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/unit/stream-manager-store.test.ts -t "re-rolls into the target"`
Expected: FAIL — `regenerate is not a function` (method not yet on the store).

- [ ] **Step 3: Add `regenerate` to the interface and implementation**

In the `StreamManagerStore` interface (`stream-manager.store.ts:26-34`) add:

```ts
  regenerate: (args: RegenerateStreamArgs) => Promise<void>;
```

Add the exported type next to `StartArgs` (`stream-manager.store.ts:21-24`):

```ts
export type RegenerateStreamArgs = StartArgs & {
  /** Existing persona MessageRow to re-roll into (cleared, then streamed). */
  targetMessageId: string;
};
```

Add the implementation in the store object (after `start`):

```ts
  regenerate: async (args) => {
    const db = getClientDataDb();
    const now = Date.now();

    // Clear the target persona message so it renders as a fresh draft, then
    // reuse it as the stream target. The user message is never touched.
    await db.transaction('rw', db.messages, db.chats, async () => {
      await db.messages.update(args.targetMessageId, {
        contentBlocks: [],
        streamingState: 'incomplete',
      });
      await db.chats.update(args.chatId, { lastMessageAt: now });
    });

    runIntoDraft(args, args.targetMessageId, set, get);
  },
```

Note: `RegenerateStreamArgs extends StartArgs`, which already includes the `userText` field `runIntoDraft`/`fireTitleGen` read. The caller (Task 3) supplies the replayed user text there.

- [ ] **Step 4: Run it to verify it passes**

Run: `cd apps/user-client && pnpm vitest run tests/unit/stream-manager-store.test.ts -t "re-rolls into the target"`
Expected: PASS.

- [ ] **Step 5: Add the failure-path test**

Append this case — on engine failure the target stays `incomplete` (footer state) and the user row is still intact.

```ts
  it('regenerate leaves target incomplete and user row intact on engine failure', async () => {
    const { db, chatId, personaId } = await seedChat();
    await db.chats.update(chatId, { title: 'kept' });
    const persona = await db.personas.get(personaId);
    const model = nanoGpt.offerings[0];
    const userId = 'u1';
    const personaMsgId = 'pm1';
    await db.messages.add({
      id: userId,
      chatId,
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'q' }],
      createdAt: 2,
      bookmarked: false,
      streamingState: 'complete',
    });
    await db.messages.add({
      id: personaMsgId,
      chatId,
      role: 'persona',
      contentBlocks: [{ type: 'text', text: 'old answer' }],
      createdAt: 3,
      bookmarked: false,
      streamingState: 'complete',
    });

    vi.spyOn(engine, 'runStreamEngine').mockRejectedValue(new Error('upstream down'));

    const store = useStreamManagerStore.getState();
    await store.regenerate({
      ...baseStartArgs(chatId, persona, model),
      userMessageText: 'q',
      priorMessages: [],
      targetMessageId: personaMsgId,
    } as never);
    await new Promise((r) => setTimeout(r, 50));

    const personaRow = await db.messages.get(personaMsgId);
    expect(personaRow?.streamingState).toBe('incomplete');
    const user = await db.messages.get(userId);
    expect(user?.contentBlocks).toEqual([{ type: 'text', text: 'q' }]);
    const count = await db.messages.where('chatId').equals(chatId).count();
    expect(count).toBe(2);
  });
```

- [ ] **Step 6: Run the full store test file**

Run: `cd apps/user-client && pnpm vitest run tests/unit/stream-manager-store.test.ts`
Expected: PASS (all cases, old + 2 new).

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/state/stream-manager.store.ts apps/user-client/tests/unit/stream-manager-store.test.ts
git commit -m "Add non-destructive regenerate() to stream-manager store"
```

---

## Task 3: Extract `resolvePersonaContext` and rewrite `useRegenerate`

**Files:**
- Modify: `apps/user-client/src/data/send-message.ts`
- Test: `apps/user-client/tests/unit/use-regenerate.test.tsx` (replace), `apps/user-client/tests/unit/use-send-message.test.tsx` (must stay green)

- [ ] **Step 1: Replace the destructive `useRegenerate` test with non-destructive ones**

Overwrite `tests/unit/use-regenerate.test.tsx`. Keep the existing `seedChatWithExchange` helper (it already seeds a user msg at `createdAt:2` and a persona msg at `createdAt:3`). Capture the seeded ids so the assertions can target them. Replace the three `it(...)` blocks with these:

```ts
// (keep the imports + wrapper + seedChatWithExchange from the existing file,
//  but have seedChatWithExchange also return the two message ids — see Step 1b)

describe('useRegenerate (non-destructive)', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests({ keepData: false });
    const mk = asMasterKey(getRandomBytes(32));
    useSessionStore.setState({ mk } as never);
  });

  afterEach(async () => {
    await _resetClientDataDbForTests({ keepData: false });
    vi.restoreAllMocks();
    useStreamManagerStore.setState({ streams: new Map() });
    useSessionStore.setState({ mk: null, session: null });
  });

  it('reuses the user message and re-rolls into the last persona message', async () => {
    const { db, chatId, userMsgId, personaMsgId } = await seedChatWithExchange();
    const regenSpy = vi
      .spyOn(useStreamManagerStore.getState(), 'regenerate')
      .mockResolvedValue(undefined);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useRegenerate(), { wrapper: wrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync({ chatId, reasoning: { kind: 'on' } });
    });

    expect(regenSpy).toHaveBeenCalledTimes(1);
    const arg = regenSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg.targetMessageId).toBe(personaMsgId);
    expect(arg.userMessageText).toBe('tell me a joke');
    // priorMessages excludes the last user message and the old answer.
    expect(arg.priorMessages).toEqual([]);

    // No deletions happened — both rows still present (clearing is the store's job, mocked here).
    const remaining = await db.messages.where('chatId').equals(chatId).count();
    expect(remaining).toBe(2);
    const userStill = await db.messages.get(userMsgId);
    expect(userStill?.contentBlocks).toEqual([{ type: 'text', text: 'tell me a joke' }]);
  });

  it('aborts an in-flight stream before regenerating', async () => {
    const { chatId, personaId } = await seedChatWithExchange();
    useStreamManagerStore.setState({
      streams: new Map([
        [
          chatId,
          {
            chatId,
            personaId,
            draftMessageId: 'd1',
            controller: new AbortController(),
            status: 'streaming' as const,
            contentBuffer: [],
            pillBuffer: [],
            startedAt: 1,
          },
        ],
      ]),
    });
    const abortSpy = vi
      .spyOn(useStreamManagerStore.getState(), 'abortDiscard')
      .mockResolvedValue(undefined);
    vi.spyOn(useStreamManagerStore.getState(), 'regenerate').mockResolvedValue(undefined);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useRegenerate(), { wrapper: wrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync({ chatId, reasoning: { kind: 'on' } });
    });
    expect(abortSpy).toHaveBeenCalledWith(chatId);
  });

  it('throws if there is no prior user message', async () => {
    const db = await openClientDataDb();
    const chatId = uuidv7();
    await db.chats.add({
      id: chatId,
      personaId: 'p',
      title: null,
      resolvedMindspaceId: 'm1',
      createdAt: 1,
      lastMessageAt: 1,
      bookmarkedMessageCount: 0,
      draftInput: '',
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useRegenerate(), { wrapper: wrapper(qc) });
    await expect(
      result.current.mutateAsync({ chatId, reasoning: { kind: 'on' } }),
    ).rejects.toThrow(/no last persona message|no prior user-message/);
  });
});
```

- [ ] **Step 1b: Update `seedChatWithExchange` to return the message ids**

In the same test file, change the two `db.messages.add({ id: uuidv7(), ... })` calls to capture ids, and return them:

```ts
  const userMsgId = uuidv7();
  await db.messages.add({
    id: userMsgId,
    chatId,
    role: 'user',
    contentBlocks: [{ type: 'text', text: 'tell me a joke' }],
    createdAt: 2,
    bookmarked: false,
    streamingState: 'complete',
  });
  const personaMsgId = uuidv7();
  await db.messages.add({
    id: personaMsgId,
    chatId,
    role: 'persona',
    contentBlocks: [{ type: 'text', text: 'why did the chicken' }],
    createdAt: 3,
    bookmarked: false,
    streamingState: 'complete',
  });
  return { db, chatId, personaId, userMsgId, personaMsgId };
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/unit/use-regenerate.test.tsx`
Expected: FAIL — `regenerate` is not spied/used yet (old `useRegenerate` calls `start` + deletes), and `targetMessageId` assertion fails.

- [ ] **Step 3: Extract `resolvePersonaContext` in `send-message.ts`**

Add the imports needed for the return type at the top of `send-message.ts`:

```ts
import type {
  Offering,
  ProviderConfig,
  ProviderDefinition,
} from '@chatsundere/llm-unified';
import type { ChatRow, PersonaRow } from '../boot/client-data-db.js';
```

Add the helper above `useSendMessage`:

```ts
interface PersonaContext {
  chat: ChatRow;
  persona: PersonaRow;
  providerDef: ProviderDefinition;
  providerConfig: ProviderConfig;
  apiKey: string;
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  offering: Offering;
  globalUnlocker: string;
  globalAboutMe: string;
}

/**
 * Resolve the persona → provider → ProviderDefinition → Offering chain for a
 * chat and decrypt its api-key + (optional) CORS-proxy key via the master key.
 * Shared by useSendMessage and useRegenerate. `who` prefixes error messages so
 * the originating hook is identifiable.
 */
async function resolvePersonaContext(chatId: string, who: string): Promise<PersonaContext> {
  const db = getClientDataDb();
  const mk = useSessionStore.getState().mk;
  if (!mk) throw new Error(`${who}: master key unavailable — re-authenticate`);

  const chat = await db.chats.get(chatId);
  if (!chat) throw new Error(`${who}: chat not found`);

  const persona = await db.personas.get(chat.personaId);
  if (!persona) throw new Error(`${who}: persona not found`);

  const provider = await db.providers.get(persona.providerId);
  if (!provider) throw new Error(`${who}: provider not found`);

  const settings = await db.settings.get(1);
  if (!settings) throw new Error(`${who}: settings row missing`);

  const providerDef = getProvider(provider.templateId);
  if (!providerDef)
    throw new Error(`${who}: unknown provider template "${provider.templateId}"`);

  const offering = getOffering(provider.templateId, persona.modelId);
  if (!offering)
    throw new Error(
      `${who}: no offering for "${persona.modelId}" on provider "${provider.templateId}" — re-pick the model`,
    );

  const apiKey = await openSecret(provider.apiKey, mk, `provider/${provider.id}/api-key`);
  const corsProxyUrl = settings.corsProxy?.url ?? null;
  const corsProxyKey = settings.corsProxy
    ? await openSecret(settings.corsProxy.sharedKey, mk, 'cors-proxy/shared-key')
    : null;

  return {
    chat,
    persona,
    providerDef,
    providerConfig: {
      baseUrl: providerDef.baseUrl,
      routing:
        providerDef.corsHint === 'requires-proxy' ? { kind: 'cors-proxy' } : { kind: 'direct' },
    },
    apiKey,
    corsProxyUrl,
    corsProxyKey,
    offering,
    globalUnlocker: settings.globalUnlockerPrompt,
    globalAboutMe: settings.globalAboutMe,
  };
}
```

- [ ] **Step 4: Reuse the helper inside `useSendMessage`**

Replace Steps 2–3 of `useSendMessage` (`send-message.ts:68-97`, the resolve+decrypt block) so that after lazy-chat creation it calls the helper. The lazy-chat block (`send-message.ts:44-66`) is unchanged; the `start(...)` call (`send-message.ts:102-125`) now reads fields from `ctx`:

```ts
      // ── Step 2+3: Resolve persona chain + decrypt secrets ───────────────
      const ctx = await resolvePersonaContext(chatId, 'useSendMessage');

      // ── Step 4: Fetch prior messages and hand off to stream-manager ──────
      const priorMessages = await db.messages.where('chatId').equals(chatId).sortBy('createdAt');

      await useStreamManagerStore.getState().start({
        chatId,
        userText: args.text,
        chat: ctx.chat,
        persona: ctx.persona,
        provider: ctx.providerDef,
        providerConfig: ctx.providerConfig,
        apiKey: ctx.apiKey,
        corsProxyUrl: ctx.corsProxyUrl,
        corsProxyKey: ctx.corsProxyKey,
        offering: ctx.offering,
        priorMessages,
        userMessageText: args.text,
        reasoning: args.reasoning,
        globalUnlocker: ctx.globalUnlocker,
        globalAboutMe: ctx.globalAboutMe,
      });

      return chatId;
```

Keep `const db = getClientDataDb();` and the master-key guard removal: the early `if (!mk) throw` at `send-message.ts:41-42` can stay (it gives the lazy-chat path a clear early error) — `resolvePersonaContext` re-checks anyway. Leave the `db` const; it's still used for the lazy-chat block and `priorMessages`.

- [ ] **Step 5: Rewrite `useRegenerate` non-destructively**

Replace the entire `useRegenerate` block (`send-message.ts:138-253`) with:

```ts
// ─────────────────────────────────────────────────────────────────────────────
// useRegenerate — non-destructive re-roll of the last persona answer
// ─────────────────────────────────────────────────────────────────────────────

export interface RegenerateArgs {
  chatId: string;
  reasoning: ReasoningState;
}

/**
 * Re-roll the last persona response without touching the user message:
 *
 * 1. Abort any live stream for the chat (discard its draft).
 * 2. Find the last complete persona message `T` (the answer to re-roll) and the
 *    last user message before it (the prompt to replay). No `T` → no-op.
 * 3. Build the wire context: priorMessages = everything before that user
 *    message; userMessageText = that user message's text. The old answer `T`
 *    is excluded, so the model answers as if the prompt were new.
 * 4. Delegate to `stream-manager.regenerate`, which clears `T` and streams the
 *    fresh answer into it. On failure `T` stays incomplete → the existing
 *    StreamInterruptedFooter offers Retry. The user message is never at risk.
 */
export function useRegenerate() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (args: RegenerateArgs): Promise<void> => {
      const db = getClientDataDb();

      // ── Step 1: Abort any live stream for this chat ──────────────────────
      const mgr = useStreamManagerStore.getState();
      if (mgr.has(args.chatId)) await mgr.abortDiscard(args.chatId);

      // ── Step 2: Locate the answer to re-roll + the prompt to replay ──────
      const msgs = await db.messages.where('chatId').equals(args.chatId).sortBy('createdAt');
      const target = [...msgs]
        .reverse()
        .find((m) => m.role === 'persona' && m.streamingState === 'complete');
      if (!target) throw new Error('useRegenerate: no last persona message');

      const lastUser = [...msgs]
        .reverse()
        .find((m) => m.role === 'user' && m.createdAt < target.createdAt);
      if (!lastUser) throw new Error('useRegenerate: no prior user-message');
      const userMessageText = lastUser.contentBlocks
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('');

      // ── Step 3: Prior context excludes that user message and everything after ─
      const priorMessages = msgs.filter((m) => m.createdAt < lastUser.createdAt);

      // ── Step 4: Resolve persona chain + decrypt, then re-roll ────────────
      const ctx = await resolvePersonaContext(args.chatId, 'useRegenerate');

      await useStreamManagerStore.getState().regenerate({
        chatId: args.chatId,
        targetMessageId: target.id,
        userText: userMessageText,
        chat: ctx.chat,
        persona: ctx.persona,
        provider: ctx.providerDef,
        providerConfig: ctx.providerConfig,
        apiKey: ctx.apiKey,
        corsProxyUrl: ctx.corsProxyUrl,
        corsProxyKey: ctx.corsProxyKey,
        offering: ctx.offering,
        priorMessages,
        userMessageText,
        reasoning: args.reasoning,
        globalUnlocker: ctx.globalUnlocker,
        globalAboutMe: ctx.globalAboutMe,
      });
    },

    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['chats', vars.chatId] });
    },
  });
}
```

- [ ] **Step 6: Run the regenerate + send-message tests**

Run: `cd apps/user-client && pnpm vitest run tests/unit/use-regenerate.test.tsx tests/unit/use-send-message.test.tsx`
Expected: PASS (new regenerate cases + unchanged send-message case).

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/data/send-message.ts apps/user-client/tests/unit/use-regenerate.test.tsx
git commit -m "Rebuild useRegenerate non-destructively via shared persona-context resolver"
```

---

## Task 4: Wire the button through ChatStream → ChatPage

**Files:**
- Modify: `apps/user-client/src/components/chat/ChatStream.tsx`, `apps/user-client/src/routes/app/chat/chat-page.tsx`
- Test: `apps/user-client/tests/unit/chat-stream.test.tsx` (keep green), `apps/user-client/tests/unit/chat-route.test.tsx` (add case)

- [ ] **Step 1: Add an `onRegenerate` prop to ChatStream**

In `ChatStream.tsx`, extend `ChatStreamProps` (`ChatStream.tsx:49-56`):

```ts
export interface ChatStreamProps {
  chatId: string;
  messages: MessageRow[];
  pills: PillRow[];
  persona: PersonaRow | null;
  displayName: string;
  streamHandle: StreamHandle | null;
  /** Re-roll the last persona answer. Wired only to the last persona message. */
  onRegenerate?: () => void;
}
```

Replace the stub (`ChatStream.tsx:172-178`) with the forwarded prop:

```ts
                onRegenerate={isLastPersona ? p.onRegenerate : undefined}
```

- [ ] **Step 2: Wire `useRegenerate` in ChatPage**

In `chat-page.tsx`, import the hook (extend the existing import at `chat-page.tsx:15`):

```ts
import { useRegenerate, useSendMessage } from '../../../data/send-message.js';
```

Instantiate it near `sendMessage` (`chat-page.tsx:38`):

```ts
  const regenerate = useRegenerate();
```

Add an `onRegenerate` handler beside `onSend` (after `chat-page.tsx:226`):

```ts
  const onRegenerate = (): void => {
    if (!activeChatId) return;
    void regenerate.mutateAsync({ chatId: activeChatId, reasoning });
  };
```

Pass it to ChatStream (`chat-page.tsx:258-265`):

```ts
        <ChatStream
          chatId={activeChatId}
          messages={messages}
          pills={pills}
          persona={effectivePersona}
          displayName={displayName}
          streamHandle={streamHandle}
          onRegenerate={onRegenerate}
        />
```

- [ ] **Step 3: Run the chat-stream + chat-page tests to confirm no regression**

Run: `cd apps/user-client && pnpm vitest run tests/unit/chat-stream.test.tsx tests/unit/chat-page.test.tsx`
Expected: PASS.

- [ ] **Step 4: Add the chat-route regenerate test (the one STATUS flags as missing)**

Append to `tests/unit/chat-route.test.tsx`. This renders the real ChatPage at `/app/chat/:chatId` with a seeded complete exchange, mocks `runStreamEngine` to emit a new answer, expands the last persona message, clicks `↻ Regenerate`, and asserts the user row is unchanged while the persona answer is replaced.

Add this mock at the top of the file (after the imports, matching the recovery-footer pattern):

```ts
import { runStreamEngine } from '../../src/lib/stream-engine';
vi.mock('../../src/lib/stream-engine', () => ({ runStreamEngine: vi.fn() }));
```

Add a seeding + provider import (top of file):

```ts
import { nanoGpt } from '../../../../packages/llm-unified/src/providers/nano-gpt';
import { sealSecret } from '../../src/lib/secrets';
import { fireEvent } from '@testing-library/react';
```

Then the test:

```ts
  it('regenerate re-rolls the last answer, keeping the user message', async () => {
    const db = await openClientDataDb();
    const mk = asMasterKey(getRandomBytes(32));
    useSessionStore.setState({ mk } as never);

    const providerId = uuidv7();
    const apiKey = await sealSecret('k', mk, `provider/${providerId}/api-key`);
    await db.providers.add({
      id: providerId,
      templateId: 'nano-gpt',
      displayName: 'nano-gpt',
      baseUrl: nanoGpt.baseUrl,
      apiKey,
      routing: { kind: 'direct' },
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    });
    const offering = nanoGpt.offerings[0];
    if (!offering) throw new Error('no offering');
    const personaId = uuidv7();
    await db.personas.add({
      id: personaId,
      name: 'Aurum',
      tagline: '',
      colour: '#c9a84c',
      font: 'serif',
      instructions: 'instr',
      canonicalId: null,
      providerId,
      modelId: offering.upstreamSlug,
      mindspaceId: null,
      aboutMeOverride: null,
      textureOverride: null,
      temperature: 0.85,
      adultPersona: false,
      createdAt: 1,
      updatedAt: 1,
    });
    const chatId = uuidv7();
    await db.chats.add({
      id: chatId,
      personaId,
      title: 'kept',
      resolvedMindspaceId: 'm1',
      createdAt: 1,
      lastMessageAt: 3,
      bookmarkedMessageCount: 0,
      draftInput: '',
    });
    const userMsgId = uuidv7();
    await db.messages.add({
      id: userMsgId,
      chatId,
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'tell me a joke' }],
      createdAt: 2,
      bookmarked: false,
      streamingState: 'complete',
    });
    const personaMsgId = uuidv7();
    await db.messages.add({
      id: personaMsgId,
      chatId,
      role: 'persona',
      contentBlocks: [{ type: 'text', text: 'old answer' }],
      createdAt: 3,
      bookmarked: false,
      streamingState: 'complete',
    });

    vi.mocked(runStreamEngine).mockImplementation(async (a: never) => {
      (a as { onChunk: (c: unknown) => void }).onChunk({ type: 'token', text: 'fresh answer' });
      return {
        finalContentBlocks: [{ type: 'text', text: 'fresh answer' }],
        pillRows: [],
        finishReason: 'stop',
      };
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Cmp = wrapper(qc, `/app/chat/${chatId}`);
    render(<Cmp />);

    // Expand the last persona message to reveal its controls.
    await waitFor(() => expect(screen.getByText('old answer')).toBeInTheDocument());
    fireEvent.click(screen.getByText('old answer'));

    const regenBtn = await screen.findByText('↻ Regenerate');
    fireEvent.click(regenBtn);

    await waitFor(async () => {
      const persona = await db.messages.get(personaMsgId);
      expect(persona?.contentBlocks).toEqual([{ type: 'text', text: 'fresh answer' }]);
      expect(persona?.streamingState).toBe('complete');
    });
    // User message untouched, no new rows.
    const user = await db.messages.get(userMsgId);
    expect(user?.contentBlocks).toEqual([{ type: 'text', text: 'tell me a joke' }]);
    expect(await db.messages.where('chatId').equals(chatId).count()).toBe(2);
  });
```

Note: ChatPage opens Interaction Mode only in lazy mode; in chat-mode the message is tap-to-expand (`MessageBlock` `onClick={p.onToggleExpand}`), which is what the `fireEvent.click(screen.getByText('old answer'))` triggers. If the controls do not appear because the click lands on a child span, click the enclosing `[data-msg-id]` element instead: `fireEvent.click(screen.getByText('old answer').closest('[data-msg-id]')!)`.

- [ ] **Step 5: Run the chat-route test**

Run: `cd apps/user-client && pnpm vitest run tests/unit/chat-route.test.tsx`
Expected: PASS (existing greeting case + new regenerate case).

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/chat/ChatStream.tsx apps/user-client/src/routes/app/chat/chat-page.tsx apps/user-client/tests/unit/chat-route.test.tsx
git commit -m "Wire non-destructive Regenerate button through ChatStream and ChatPage"
```

---

## Task 5: Full verification + STATUS update

**Files:**
- Modify: `obsidian/STATUS-CLIENT-ONLY.md`

- [ ] **Step 1: Run the full user-client test suite**

Run: `cd apps/user-client && pnpm vitest run`
Expected: PASS (whole suite green).

- [ ] **Step 2: Run the CI gate (typecheck) from the repo root**

Run: `cd /home/chris/workspace/chatsundere && pnpm typecheck`
Expected: PASS — no type errors. (Per the project rule, `typecheck` — not just `build` — is the gate after type/schema changes.)

- [ ] **Step 3: Update STATUS-CLIENT-ONLY.md**

Move the "#5 Regenerate wired then REVERTED" item out of the deferred list into Done: regenerate rebuilt non-destructively (reuse user message + re-roll into the last persona message via `stream-manager.regenerate`), with store + hook + chat-route tests. Refresh the "Next session" block and the `Last updated:` line.

- [ ] **Step 4: Commit the STATUS update**

```bash
git add obsidian/STATUS-CLIENT-ONLY.md
git commit -m "STATUS: non-destructive Regenerate landed [skip ci]"
```

---

## Manual verification (Chris, on device)

1. Open a chat with one exchange (one prompt, one answer). Tap the answer to expand → tap `↻ Regenerate`. The prompt stays; the answer re-rolls in place.
2. Regenerate a single-exchange chat repeatedly — the chat is never emptied, the title is kept.
3. Turn off the network, then Regenerate. The answer area shows the StreamInterruptedFooter with Retry; the prompt is still there. Re-enable the network and Retry → it completes.
4. In a longer chat, switch the model in the Cockpit, then Regenerate the last answer — the new answer comes from the newly-selected model.
5. Confirm `↻ Regenerate` only appears on the last persona message, not on earlier ones.

---

## Self-review notes

- **Spec coverage:** Decision 1 (replace in-place) → Task 2 `regenerate` updates the target row. Decision 2 (current persona live) → Task 3 resolves context fresh at click time; Task 4 reads `reasoning` from the store. Decision 3 (last answer only) → Task 4 forwards `onRegenerate` only when `isLastPersona`; Task 3 selects the last complete persona message. Decision 4 (interrupted footer) → Task 2 failure path leaves `incomplete`; the existing footer in `chat-page.tsx:268-320` already renders for that state. §6 shared resolver → Task 3. §8 chat-route test → Task 4 Step 4.
- **Type consistency:** `regenerate`/`RegenerateStreamArgs`/`targetMessageId`/`runIntoDraft`/`resolvePersonaContext`/`PersonaContext` are used identically across tasks. `RegenerateStreamArgs extends StartArgs`, so `runIntoDraft(args, ...)` accepts both.
- **No placeholders:** every code step shows the full code; every run step shows the command + expected outcome.
