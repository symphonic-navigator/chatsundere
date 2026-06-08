// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { nanoGpt } from '../../../../packages/llm-unified/src/providers/nano-gpt';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db';
import * as engine from '../../src/lib/stream-engine';
import * as titleGen from '../../src/lib/title-generator';
import * as toolLoop from '../../src/lib/tool-loop';
import { useStreamManagerStore } from '../../src/state/stream-manager.store';

async function seedChat() {
  const db = await openClientDataDb();
  const personaId = 'p1';
  await db.personas.add({
    id: personaId,
    name: 'Aurum',
    tagline: '',
    colour: '#c9a84c',
    font: 'serif',
    instructions: 'You are Aurum.',
    canonicalId: null,
    providerId: 'pr1',
    modelId: nanoGpt.offerings[0]?.upstreamSlug ?? '',
    mindspaceId: null,
    aboutMeOverride: null,
    textureOverride: null,
    temperature: 0.85,
    adultPersona: false,
    chatsundereTonality: true,
    contextWindow: null,
    libraryIds: [],
    askExpertDefault: false,
    mcpOverrides: {},
    createdAt: 1,
    updatedAt: 1,
  });
  await db.providers.add({
    id: 'pr1',
    templateId: 'nano-gpt',
    displayName: 'nano-gpt',
    baseUrl: nanoGpt.baseUrl,
    apiKey: { iv: new Uint8Array(), ciphertext: new Uint8Array() } as never,
    routing: { kind: 'direct' },
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  });
  const chatId = 'c1';
  await db.chats.add({
    id: chatId,
    personaId,
    title: null,
    resolvedMindspaceId: 'm1',
    createdAt: 1,
    lastMessageAt: 1,
    bookmarkedMessageCount: 0,
    draftInput: '',
    libraryIds: [],
  });
  return { db, personaId, chatId };
}

function baseStartArgs(chatId: string, persona: unknown, model: unknown) {
  return {
    chatId,
    userText: 'Hello',
    chat: {
      id: chatId,
      personaId: 'p1',
      title: null,
      resolvedMindspaceId: 'm1',
      createdAt: 1,
      lastMessageAt: 1,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    },
    persona,
    provider: nanoGpt,
    providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } as const },
    apiKey: 'k',
    corsProxyUrl: null,
    corsProxyKey: null,
    offering: model,
    priorMessages: [],
    userMessageText: 'Hello',
    reasoning: { mode: 'on' as const },
    globalInstructions: '',
    globalAboutMe: '',
  };
}

describe('stream-manager.store', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests({ keepData: false });
  });
  afterEach(async () => {
    await _resetClientDataDbForTests({ keepData: false });
    vi.restoreAllMocks();
  });

  it('start inserts user-msg + draft, engine resolve persists final', async () => {
    const { db, chatId, personaId } = await seedChat();
    const persona = await db.personas.get(personaId);
    const model = nanoGpt.offerings[0];
    vi.spyOn(engine, 'runStreamEngine').mockResolvedValue({
      finalContentBlocks: [{ type: 'text', text: 'Hi' }],
      pillRows: [],
      finishReason: 'stop',
    });
    const store = useStreamManagerStore.getState();
    await store.start(baseStartArgs(chatId, persona, model) as never);
    // give the .then chain a tick to run
    await new Promise((r) => setTimeout(r, 50));
    const msgs = await db.messages.where('chatId').equals(chatId).sortBy('createdAt');
    expect(msgs.length).toBe(2);
    expect(msgs[0]?.role).toBe('user');
    expect(msgs[1]?.role).toBe('persona');
    expect(msgs[1]?.streamingState).toBe('complete');
    expect(msgs[1]?.contentBlocks).toEqual([{ type: 'text', text: 'Hi' }]);
  });

  it('start persists pills with the right messageId', async () => {
    const { db, chatId, personaId } = await seedChat();
    const persona = await db.personas.get(personaId);
    const model = nanoGpt.offerings[0];
    vi.spyOn(engine, 'runStreamEngine').mockResolvedValue({
      finalContentBlocks: [{ type: 'pill', pillId: 'pill-uuid-1' }],
      // A non-tool-call pill: this test exercises the pill-persistence wiring
      // (messageId assignment), not tool execution — a tool-call pill would now
      // drive the tool loop. Tool execution is covered in tool-loop.test.ts.
      pillRows: [
        {
          id: 'pill-uuid-1',
          messageId: '',
          kind: 'image-result',
          positionHint: 'inline',
          status: 'completed',
          payload: {},
          createdAt: 1,
        },
      ],
      finishReason: 'stop',
    });
    const store = useStreamManagerStore.getState();
    await store.start(baseStartArgs(chatId, persona, model) as never);
    await new Promise((r) => setTimeout(r, 50));
    const msgs = await db.messages.where('chatId').equals(chatId).sortBy('createdAt');
    const personaMsgId = msgs.find((m) => m.role === 'persona')?.id;
    const pills = await db.pills.toArray();
    expect(pills.length).toBe(1);
    expect(pills[0]?.messageId).toBe(personaMsgId);
  });

  it('live contentBuffer pushes each token as its own text block (no coalescing)', async () => {
    // Each upstream chunk should become its own text-block so the renderer's
    // `.token-fade` keyframe plays once per chunk (only newly-mounted spans
    // animate). Coalescing here would collapse all tokens into one ever-
    // growing span and the fade would never re-fire on later chunks.
    const { db, chatId, personaId } = await seedChat();
    const persona = await db.personas.get(personaId);
    const model = nanoGpt.offerings[0];
    type OnChunk = (c: { type: 'token'; text: string }) => void;
    let captured: OnChunk | null = null;
    vi.spyOn(engine, 'runStreamEngine').mockImplementation(((args: { onChunk: OnChunk }) => {
      captured = args.onChunk;
      // Never resolves — we only want to observe mid-stream buffer state.
      return new Promise(() => {
        /* never */
      });
    }) as never);
    const store = useStreamManagerStore.getState();
    void store.start(baseStartArgs(chatId, persona, model) as never);
    await new Promise((r) => setTimeout(r, 20));
    expect(captured).not.toBeNull();
    const fire = captured as unknown as OnChunk;
    fire({ type: 'token', text: 'Hi' });
    fire({ type: 'token', text: ' there' });
    fire({ type: 'token', text: ', friend' });
    const handle = useStreamManagerStore.getState().streams.get(chatId);
    expect(handle).toBeDefined();
    expect(handle?.contentBuffer).toEqual([
      { type: 'text', text: 'Hi' },
      { type: 'text', text: ' there' },
      { type: 'text', text: ', friend' },
    ]);
    await store.abortDiscard(chatId);
  });

  it('mirrors reasoning chunks into the live content buffer as reasoning blocks', async () => {
    // Phase 4: reasoning chunks must mirror into the live buffer just like
    // token chunks — each one its own sub-block so the ReasoningPill body
    // benefits from the same per-chunk fade-in as the token stream.
    //
    // We deliberately use a unique chatId here (and in the two sibling
    // tests below) because earlier tests in this file leak setTimeout(...,
    // 200ms) closures that `m.delete('c1')` from the live streams Map
    // after their success chain runs. A shared chatId would race with
    // those leaks and intermittently wipe our freshly-started handle.
    const { db, chatId, personaId } = await seedChat();
    const persona = await db.personas.get(personaId);
    const model = nanoGpt.offerings[0];
    const myChatId = 'c-mirror-reasoning';
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
    type OnChunk = (c: { type: 'token' | 'reasoning'; text: string }) => void;
    let captured: OnChunk | null = null;
    vi.spyOn(engine, 'runStreamEngine').mockImplementation(((args: { onChunk: OnChunk }) => {
      captured = args.onChunk;
      return new Promise(() => {
        /* never */
      });
    }) as never);
    const store = useStreamManagerStore.getState();
    void store.start({ ...baseStartArgs(chatId, persona, model), chatId: myChatId } as never);
    await new Promise((r) => setTimeout(r, 20));
    expect(captured).not.toBeNull();
    const fire = captured as unknown as OnChunk;
    fire({ type: 'reasoning', text: 'planning' });
    const handle = useStreamManagerStore.getState().streams.get(myChatId);
    expect(handle).toBeDefined();
    expect(handle?.contentBuffer).toEqual([{ type: 'reasoning', text: 'planning' }]);
    await store.abortDiscard(myChatId);
  });

  it('preserves non-coalescing for reasoning (token-fade compat)', async () => {
    // Same contract as the token-chunk non-coalescing test: each reasoning
    // delta must land as its own block so the .token-fade keyframe replays
    // on fresh-mounted spans inside the open ReasoningPill body.
    const { db, chatId, personaId } = await seedChat();
    const persona = await db.personas.get(personaId);
    const model = nanoGpt.offerings[0];
    type OnChunk = (c: { type: 'token' | 'reasoning'; text: string }) => void;
    let captured: OnChunk | null = null;
    vi.spyOn(engine, 'runStreamEngine').mockImplementation(((args: { onChunk: OnChunk }) => {
      captured = args.onChunk;
      return new Promise(() => {
        /* never */
      });
    }) as never);
    const myChatId = 'c-preserve-reasoning';
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
    const store = useStreamManagerStore.getState();
    void store.start({ ...baseStartArgs(chatId, persona, model), chatId: myChatId } as never);
    await new Promise((r) => setTimeout(r, 20));
    expect(captured).not.toBeNull();
    const fire = captured as unknown as OnChunk;
    fire({ type: 'reasoning', text: 'aa' });
    fire({ type: 'reasoning', text: 'bb' });
    const handle = useStreamManagerStore.getState().streams.get(myChatId);
    expect(handle?.contentBuffer).toEqual([
      { type: 'reasoning', text: 'aa' },
      { type: 'reasoning', text: 'bb' },
    ]);
    await store.abortDiscard(myChatId);
  });

  it('rotates the handle reference on every reasoning chunk', async () => {
    // Same handle-rotation guarantee as for token chunks — a zustand
    // selector returning `streams.get(chatId)` must see a fresh reference
    // after every reasoning delta, otherwise ReasoningPill won't re-render.
    const { db, chatId, personaId } = await seedChat();
    const persona = await db.personas.get(personaId);
    const model = nanoGpt.offerings[0];
    type OnChunk = (c: { type: 'token' | 'reasoning'; text: string }) => void;
    let captured: OnChunk | null = null;
    vi.spyOn(engine, 'runStreamEngine').mockImplementation(((args: { onChunk: OnChunk }) => {
      captured = args.onChunk;
      return new Promise(() => {
        /* never */
      });
    }) as never);
    const myChatId = 'c-rotate-reasoning';
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
    const store = useStreamManagerStore.getState();
    void store.start({ ...baseStartArgs(chatId, persona, model), chatId: myChatId } as never);
    await new Promise((r) => setTimeout(r, 20));
    expect(captured).not.toBeNull();
    const fire = captured as unknown as OnChunk;
    const h0 = useStreamManagerStore.getState().streams.get(myChatId);
    expect(h0).toBeDefined();
    fire({ type: 'reasoning', text: 'a' });
    const h1 = useStreamManagerStore.getState().streams.get(myChatId);
    fire({ type: 'reasoning', text: 'b' });
    const h2 = useStreamManagerStore.getState().streams.get(myChatId);
    expect(h1).toBeDefined();
    expect(h2).toBeDefined();
    expect(h1).not.toBe(h0);
    expect(h2).not.toBe(h1);
    await store.abortDiscard(myChatId);
  });

  it('abortDiscard removes the draft, keeps the user message', async () => {
    // Use a unique chatId to prevent a 200ms cleanup timer from an earlier
    // resolved stream (sharing chatId 'c1') from racing against this handle.
    const { db, personaId } = await seedChat();
    const myChatId = 'c-abort-discard';
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
          /* never */
        }),
    );
    const store = useStreamManagerStore.getState();
    void store.start({ ...baseStartArgs(myChatId, persona, model), chatId: myChatId } as never);
    await new Promise((r) => setTimeout(r, 20));
    expect(useStreamManagerStore.getState().has(myChatId)).toBe(true);
    await store.abortDiscard(myChatId);
    const msgs = await db.messages.where('chatId').equals(myChatId).toArray();
    expect(msgs.filter((m) => m.role === 'user').length).toBe(1);
    expect(msgs.filter((m) => m.role === 'persona').length).toBe(0);
    expect(useStreamManagerStore.getState().has(myChatId)).toBe(false);
  });

  it('fires title-gen after the first persona response (no-await)', async () => {
    const { db, chatId, personaId } = await seedChat();
    const persona = await db.personas.get(personaId);
    const model = nanoGpt.offerings[0];
    const titleSpy = vi.spyOn(titleGen, 'generateTitleAsync').mockResolvedValue();
    vi.spyOn(engine, 'runStreamEngine').mockResolvedValue({
      finalContentBlocks: [{ type: 'text', text: 'Hi there' }],
      pillRows: [],
      finishReason: 'stop',
    });
    const store = useStreamManagerStore.getState();
    await store.start(baseStartArgs(chatId, persona, model) as never);
    // Small delay for the fire-and-forget title-gen to resolve.
    await new Promise((r) => setTimeout(r, 80));
    expect(titleSpy).toHaveBeenCalled();
    const callArg = titleSpy.mock.calls[0]?.[0] as {
      firstPersonaResponse: string;
      firstUserMessage: string;
    };
    expect(callArg.firstPersonaResponse).toBe('Hi there');
    expect(callArg.firstUserMessage).toBe('Hello');
  });

  it('does not fire title-gen for subsequent persona responses', async () => {
    const { db, chatId, personaId } = await seedChat();
    const persona = await db.personas.get(personaId);
    const model = nanoGpt.offerings[0];
    // Plant a prior completed persona message so this is the "second" response.
    await db.messages.add({
      id: 'prior-p',
      chatId,
      role: 'persona',
      contentBlocks: [{ type: 'text', text: 'earlier' }],
      createdAt: 50,
      bookmarked: false,
      streamingState: 'complete',
    });
    const titleSpy = vi.spyOn(titleGen, 'generateTitleAsync').mockResolvedValue();
    vi.spyOn(engine, 'runStreamEngine').mockResolvedValue({
      finalContentBlocks: [{ type: 'text', text: 'second' }],
      pillRows: [],
      finishReason: 'stop',
    });
    const store = useStreamManagerStore.getState();
    await store.start(baseStartArgs(chatId, persona, model) as never);
    await new Promise((r) => setTimeout(r, 80));
    expect(titleSpy).not.toHaveBeenCalled();
  });

  it('does not fire title-gen if chat.title is already set', async () => {
    const { db, chatId, personaId } = await seedChat();
    await db.chats.update(chatId, { title: 'pre-set title' });
    const persona = await db.personas.get(personaId);
    const model = nanoGpt.offerings[0];
    const titleSpy = vi.spyOn(titleGen, 'generateTitleAsync').mockResolvedValue();
    vi.spyOn(engine, 'runStreamEngine').mockResolvedValue({
      finalContentBlocks: [{ type: 'text', text: 'whatever' }],
      pillRows: [],
      finishReason: 'stop',
    });
    const store = useStreamManagerStore.getState();
    await store.start(baseStartArgs(chatId, persona, model) as never);
    await new Promise((r) => setTimeout(r, 80));
    expect(titleSpy).not.toHaveBeenCalled();
  });

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

  it('abortDiscard preserves a regenerate target as incomplete (not deleted)', async () => {
    // Use a unique chatId to avoid racing against the 200ms setTimeout cleanup
    // closures that prior tests leave behind on the shared 'c1' slot.
    const { db, personaId } = await seedChat();
    const myChatId = 'c-abort-regen';
    await db.chats.add({
      id: myChatId,
      personaId,
      title: 'kept',
      resolvedMindspaceId: 'm1',
      createdAt: 1,
      lastMessageAt: 1,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });
    const persona = await db.personas.get(personaId);
    const model = nanoGpt.offerings[0];
    const userId = 'u1';
    const personaMsgId = 'pm1';
    await db.messages.add({
      id: userId,
      chatId: myChatId,
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'q' }],
      createdAt: 2,
      bookmarked: false,
      streamingState: 'complete',
    });
    await db.messages.add({
      id: personaMsgId,
      chatId: myChatId,
      role: 'persona',
      contentBlocks: [{ type: 'text', text: 'old answer' }],
      createdAt: 3,
      bookmarked: false,
      streamingState: 'complete',
    });

    // Never-resolving engine so the stream stays live until we abort.
    vi.spyOn(engine, 'runStreamEngine').mockImplementation(
      (() =>
        new Promise(() => {
          /* never */
        })) as never,
    );

    const store = useStreamManagerStore.getState();
    await store.regenerate({
      ...baseStartArgs(myChatId, persona, model),
      userMessageText: 'q',
      priorMessages: [],
      targetMessageId: personaMsgId,
    } as never);
    await new Promise((r) => setTimeout(r, 20));
    expect(useStreamManagerStore.getState().has(myChatId)).toBe(true);

    await store.abortDiscard(myChatId);

    // The target message must STILL EXIST, marked incomplete — not deleted.
    const personaRow = await db.messages.get(personaMsgId);
    expect(personaRow).toBeDefined();
    expect(personaRow?.streamingState).toBe('incomplete');
    const count = await db.messages.where('chatId').equals(myChatId).count();
    expect(count).toBe(2);
    expect(useStreamManagerStore.getState().has(myChatId)).toBe(false);
  });

  it('abortAllForPersonaDiscard kicks every stream against a persona', async () => {
    // seedChat sets up persona p1; add a second chat against same persona
    const { db, chatId: c1, personaId } = await seedChat();
    const persona = await db.personas.get(personaId);
    const model = nanoGpt.offerings[0];
    const c2 = 'c2';
    await db.chats.add({
      id: c2,
      personaId,
      title: null,
      resolvedMindspaceId: 'm1',
      createdAt: 2,
      lastMessageAt: 2,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });
    vi.spyOn(engine, 'runStreamEngine').mockImplementation(
      () =>
        new Promise(() => {
          /* never */
        }),
    );
    const store = useStreamManagerStore.getState();
    await store.start(baseStartArgs(c1, persona, model) as never);
    await store.start({
      ...baseStartArgs(c1, persona, model),
      chatId: c2,
      chat: {
        id: c2,
        personaId,
        title: null,
        resolvedMindspaceId: 'm1',
        createdAt: 2,
        lastMessageAt: 2,
        bookmarkedMessageCount: 0,
        draftInput: '',
        libraryIds: [],
      },
    } as never);
    expect(useStreamManagerStore.getState().streams.size).toBe(2);
    await store.abortAllForPersonaDiscard(personaId);
    expect(useStreamManagerStore.getState().streams.size).toBe(0);
  });

  it('offers query_knowledgebase and awareness when knowledge libraries are present', async () => {
    // Kept last in the file: the abortAllForPersonaDiscard test above asserts an
    // exact streams.size, so it must not race a lingering handle from here.
    const { db, personaId } = await seedChat();
    const persona = await db.personas.get(personaId);
    const model = nanoGpt.offerings[0];
    const myChatId = 'c-knowledge';
    await db.chats.add({
      id: myChatId,
      personaId,
      title: 'kept',
      resolvedMindspaceId: 'm1',
      createdAt: 1,
      lastMessageAt: 1,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });

    // Capture the tool defs handed to the tool loop and the args handed to the
    // stream engine. The model offering must declare tool-call support so the
    // store resolves the active tool set rather than short-circuiting to [].
    // The loop drives one stream round (so runStreamEngine receives its args)
    // then never resolves — we abortDiscard at the end rather than letting the
    // success chain leak a 200ms cleanup timer.
    let capturedToolDefs: { name: string }[] = [];
    let capturedStreamArgs: { knowledgeLibrariesContext?: string } = {};
    vi.spyOn(toolLoop, 'runToolLoop').mockImplementation(((args: {
      toolDefs: { name: string }[];
      streamOnce: (toolExchange: unknown, tools: unknown) => Promise<unknown>;
    }) => {
      capturedToolDefs = args.toolDefs;
      void args.streamOnce({}, []);
      return new Promise(() => {
        /* never */
      });
    }) as never);

    vi.spyOn(engine, 'runStreamEngine').mockImplementation(((args: {
      knowledgeLibrariesContext?: string;
    }) => {
      capturedStreamArgs = args;
      return new Promise(() => {
        /* never */
      });
    }) as never);

    const knowledge = {
      libraries: [{ id: 'a', name: 'Farblehre', description: 'colour' }],
      retrieve: async () => [],
    };

    const store = useStreamManagerStore.getState();
    await store.start({
      ...baseStartArgs(myChatId, persona, model),
      chatId: myChatId,
      offering: { ...(model as object), profile: { toolCalls: { supported: true } } },
      knowledge,
    } as never);
    await new Promise((r) => setTimeout(r, 50));

    expect(capturedToolDefs.some((d) => d.name === 'query_knowledgebase')).toBe(true);
    expect(capturedStreamArgs.knowledgeLibrariesContext).toContain('Farblehre');
    await store.abortDiscard(myChatId);
  });

  it('offers ask_expert tool when expertBase is provided and tool calls supported', async () => {
    const { db, personaId } = await seedChat();
    const persona = await db.personas.get(personaId);
    const model = nanoGpt.offerings[0];
    const myChatId = 'c-ask-expert-on';
    await db.chats.add({
      id: myChatId,
      personaId,
      title: 'kept',
      resolvedMindspaceId: 'm1',
      createdAt: 1,
      lastMessageAt: 1,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });

    let capturedToolDefs: { name: string }[] = [];
    vi.spyOn(toolLoop, 'runToolLoop').mockImplementation(((args: {
      toolDefs: { name: string }[];
      streamOnce: (toolExchange: unknown, tools: unknown) => Promise<unknown>;
    }) => {
      capturedToolDefs = args.toolDefs;
      void args.streamOnce({}, []);
      return new Promise(() => {
        /* never */
      });
    }) as never);

    vi.spyOn(engine, 'runStreamEngine').mockImplementation(
      (() =>
        new Promise(() => {
          /* never */
        })) as never,
    );

    // Minimal ExpertBase — only shape matters; no real crypto or network call.
    const expertBase = {
      provider: nanoGpt,
      providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' as const } },
      apiKey: 'expert-key',
      corsProxyUrl: null,
      corsProxyKey: null,
      target: { slug: nanoGpt.offerings[0]?.upstreamSlug ?? '', bodyExtras: {} },
    };

    const store = useStreamManagerStore.getState();
    await store.start({
      ...baseStartArgs(myChatId, persona, model),
      chatId: myChatId,
      offering: { ...(model as object), profile: { toolCalls: { supported: true } } },
      expertBase,
      expertModelLabel: 'Test Expert',
      expertReasoning: { enabled: true },
    } as never);
    await new Promise((r) => setTimeout(r, 50));

    expect(capturedToolDefs.some((d) => d.name === 'ask_expert')).toBe(true);
    await store.abortDiscard(myChatId);
  });

  it('does not offer ask_expert when no expertBase is provided', async () => {
    const { db, personaId } = await seedChat();
    const persona = await db.personas.get(personaId);
    const model = nanoGpt.offerings[0];
    const myChatId = 'c-ask-expert-off';
    await db.chats.add({
      id: myChatId,
      personaId,
      title: 'kept',
      resolvedMindspaceId: 'm1',
      createdAt: 1,
      lastMessageAt: 1,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });

    let capturedToolDefs: { name: string }[] = [];
    vi.spyOn(toolLoop, 'runToolLoop').mockImplementation(((args: {
      toolDefs: { name: string }[];
      streamOnce: (toolExchange: unknown, tools: unknown) => Promise<unknown>;
    }) => {
      capturedToolDefs = args.toolDefs;
      void args.streamOnce({}, []);
      return new Promise(() => {
        /* never */
      });
    }) as never);

    vi.spyOn(engine, 'runStreamEngine').mockImplementation(
      (() =>
        new Promise(() => {
          /* never */
        })) as never,
    );

    const store = useStreamManagerStore.getState();
    await store.start({
      ...baseStartArgs(myChatId, persona, model),
      chatId: myChatId,
      offering: { ...(model as object), profile: { toolCalls: { supported: true } } },
      // no expertBase
    } as never);
    await new Promise((r) => setTimeout(r, 50));

    expect(capturedToolDefs.some((d) => d.name === 'ask_expert')).toBe(false);
    await store.abortDiscard(myChatId);
  });

  it('gating: knowledge awareness stays empty when tool calls unsupported', async () => {
    // Kept last in the file: the abortAllForPersonaDiscard test above asserts an
    // exact streams.size, so it must not race a lingering handle from here.
    const { db, personaId } = await seedChat();
    const persona = await db.personas.get(personaId);
    const model = nanoGpt.offerings[0];
    const myChatId = 'c-no-tools';
    await db.chats.add({
      id: myChatId,
      personaId,
      title: 'kept',
      resolvedMindspaceId: 'm1',
      createdAt: 1,
      lastMessageAt: 1,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });

    // Model offering has toolCalls.supported: false, so even with knowledge libraries
    // present, the awareness must be empty (and no query_knowledgebase tool offered).
    let capturedToolDefs: { name: string }[] = [];
    let capturedStreamArgs: { knowledgeLibrariesContext?: string } = {};
    vi.spyOn(toolLoop, 'runToolLoop').mockImplementation(((args: {
      toolDefs: { name: string }[];
      streamOnce: (toolExchange: unknown, tools: unknown) => Promise<unknown>;
    }) => {
      capturedToolDefs = args.toolDefs;
      void args.streamOnce({}, []);
      return new Promise(() => {
        /* never */
      });
    }) as never);

    vi.spyOn(engine, 'runStreamEngine').mockImplementation(((args: {
      knowledgeLibrariesContext?: string;
    }) => {
      capturedStreamArgs = args;
      return new Promise(() => {
        /* never */
      });
    }) as never);

    const knowledge = {
      libraries: [{ id: 'a', name: 'Farblehre', description: 'colour' }],
      retrieve: async () => [],
    };

    const store = useStreamManagerStore.getState();
    await store.start({
      ...baseStartArgs(myChatId, persona, model),
      chatId: myChatId,
      offering: { ...(model as object), profile: { toolCalls: { supported: false } } },
      knowledge,
    } as never);
    await new Promise((r) => setTimeout(r, 50));

    expect(capturedToolDefs.some((d) => d.name === 'query_knowledgebase')).toBe(false);
    expect(capturedStreamArgs.knowledgeLibrariesContext).toBe('');
    await store.abortDiscard(myChatId);
  });

  it('persists a kb-injection pill above the answer when lore fired', async () => {
    const { db, chatId, personaId } = await seedChat();
    const persona = await db.personas.get(personaId);
    const model = nanoGpt.offerings[0];

    const lore = {
      entries: [
        {
          documentId: 'some-id',
          libraryName: 'Story',
          documentTitle: 'Red Dragon',
          injectedText: 'X.',
        },
      ],
      omittedCount: 0,
      truncatedCount: 0,
    };

    vi.spyOn(engine, 'runStreamEngine').mockResolvedValue({
      finalContentBlocks: [{ type: 'text', text: 'Answer' }],
      pillRows: [],
      finishReason: 'stop',
    });

    const store = useStreamManagerStore.getState();
    await store.start({
      ...baseStartArgs(chatId, persona, model),
      loreContext: 'LORE',
      lore,
    } as never);
    await new Promise((r) => setTimeout(r, 50));

    const pills = await db.pills.toArray();
    const kb = pills.find((p) => p.kind === 'kb-injection');
    expect(kb).toBeDefined();
    expect((kb?.payload as { entries: unknown[] }).entries).toHaveLength(1);

    const msgs = await db.messages.where('chatId').equals(chatId).sortBy('createdAt');
    const msg = msgs.find((m) => m.role === 'persona');
    const firstBlock = msg?.contentBlocks[0];
    expect(firstBlock).toEqual({ type: 'pill', pillId: kb?.id });
  });

  it('persists the kb-injection pill row when the stream FAILS with lore fired (no dangling pointer)', async () => {
    // Regression: the .catch path used to persist contentBuffer (which includes
    // the lore pill block) to db.messages without writing the pill row to db.pills,
    // leaving a dangling pillId that the renderer could not resolve on reload.
    const { db, personaId } = await seedChat();
    const persona = await db.personas.get(personaId);
    const model = nanoGpt.offerings[0];
    // Use a unique chatId to avoid timer-leak races with earlier success-path tests.
    const myChatId = 'c-lore-fail';
    await db.chats.add({
      id: myChatId,
      personaId,
      title: 'kept',
      resolvedMindspaceId: 'm1',
      createdAt: 1,
      lastMessageAt: 1,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });

    const lore = {
      entries: [
        {
          documentId: 'some-id',
          libraryName: 'Lore',
          documentTitle: 'Chapter 1',
          injectedText: 'Y.',
        },
      ],
      omittedCount: 0,
      truncatedCount: 0,
    };

    // Drive a genuine stream failure — the tool loop propagates the rejection
    // straight into the .catch handler, which is exactly the bug site.
    vi.spyOn(engine, 'runStreamEngine').mockRejectedValue(new Error('upstream down'));

    const store = useStreamManagerStore.getState();
    await store.start({
      ...baseStartArgs(myChatId, persona, model),
      chatId: myChatId,
      chat: {
        id: myChatId,
        personaId,
        title: 'kept',
        resolvedMindspaceId: 'm1',
        createdAt: 1,
        lastMessageAt: 1,
        bookmarkedMessageCount: 0,
        draftInput: '',
        libraryIds: [],
      },
      loreContext: 'LORE',
      lore,
    } as never);
    await new Promise((r) => setTimeout(r, 50));

    // The pill row MUST exist in db.pills so the pill block in the
    // incomplete persona message doesn't dangle on reload.
    const pills = await db.pills.toArray();
    const kb = pills.find((p) => p.kind === 'kb-injection');
    expect(kb).toBeDefined();

    // The incomplete persona message's first contentBlock must reference that pill.
    const msgs = await db.messages.where('chatId').equals(myChatId).sortBy('createdAt');
    const personaMsg = msgs.find((m) => m.role === 'persona');
    expect(personaMsg?.streamingState).toBe('incomplete');
    const firstBlock = personaMsg?.contentBlocks[0];
    expect(firstBlock).toEqual({ type: 'pill', pillId: kb?.id });
  });
});
