// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { nanoGpt } from '../../../../packages/llm-unified/src/providers/nano-gpt';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db';
import * as engine from '../../src/lib/stream-engine';
import * as titleGen from '../../src/lib/title-generator';
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
    },
    persona,
    provider: nanoGpt,
    providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } as const },
    apiKey: 'k',
    corsProxyUrl: null,
    corsProxyKey: null,
    model,
    priorMessages: [],
    userMessageText: 'Hello',
    reasoning: { mode: 'on' as const },
    globalUnlocker: '',
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
      pillRows: [
        {
          id: 'pill-uuid-1',
          messageId: '',
          kind: 'tool-call',
          positionHint: 'inline',
          status: 'completed',
          payload: { name: 'web_search' },
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
    const { db, chatId, personaId } = await seedChat();
    const persona = await db.personas.get(personaId);
    const model = nanoGpt.offerings[0];
    vi.spyOn(engine, 'runStreamEngine').mockImplementation(
      () =>
        new Promise(() => {
          /* never */
        }),
    );
    const store = useStreamManagerStore.getState();
    void store.start(baseStartArgs(chatId, persona, model) as never);
    await new Promise((r) => setTimeout(r, 20));
    expect(useStreamManagerStore.getState().has(chatId)).toBe(true);
    await store.abortDiscard(chatId);
    const msgs = await db.messages.where('chatId').equals(chatId).toArray();
    expect(msgs.filter((m) => m.role === 'user').length).toBe(1);
    expect(msgs.filter((m) => m.role === 'persona').length).toBe(0);
    expect(useStreamManagerStore.getState().has(chatId)).toBe(false);
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
      },
    } as never);
    expect(useStreamManagerStore.getState().streams.size).toBe(2);
    await store.abortAllForPersonaDiscard(personaId);
    expect(useStreamManagerStore.getState().streams.size).toBe(0);
  });
});
