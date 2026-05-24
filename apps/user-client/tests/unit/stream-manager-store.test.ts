// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { nanoGpt } from '../../../../packages/llm-unified/src/providers/nano-gpt';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db';
import * as engine from '../../src/lib/stream-engine';
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
    providerId: 'pr1',
    modelId: nanoGpt.knownModels[0]?.id ?? '',
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
    const model = nanoGpt.knownModels[0];
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
    const model = nanoGpt.knownModels[0];
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

  it('abortDiscard removes the draft, keeps the user message', async () => {
    const { db, chatId, personaId } = await seedChat();
    const persona = await db.personas.get(personaId);
    const model = nanoGpt.knownModels[0];
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

  it('abortAllForPersonaDiscard kicks every stream against a persona', async () => {
    // seedChat sets up persona p1; add a second chat against same persona
    const { db, chatId: c1, personaId } = await seedChat();
    const persona = await db.personas.get(personaId);
    const model = nanoGpt.knownModels[0];
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
    void store.start(baseStartArgs(c1, persona, model) as never);
    void store.start({
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
    await new Promise((r) => setTimeout(r, 20));
    expect(useStreamManagerStore.getState().streams.size).toBe(2);
    await store.abortAllForPersonaDiscard(personaId);
    expect(useStreamManagerStore.getState().streams.size).toBe(0);
  });
});
