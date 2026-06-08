// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { uuidv7 } from 'uuidv7';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db';
import { nsfwPanic } from '../../src/lib/nsfw-panic';
import { useCurrentChatStore } from '../../src/state/current-chat.store';
import { useStreamManagerStore } from '../../src/state/stream-manager.store';
import { toastStore } from '../../src/state/toast.store';

beforeEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
  // Ensure the DB handle is always open before each test — the no-op
  // case calls nsfwPanic without seeding, so we must open it explicitly.
  await openClientDataDb();
  useStreamManagerStore.setState({ streams: new Map() });
  useCurrentChatStore.getState().reset();
  toastStore.clear();
});

afterEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
  vi.restoreAllMocks();
});

async function seedAdultPersona(): Promise<{ personaId: string; chatId: string }> {
  const db = await openClientDataDb();
  const personaId = uuidv7();
  await db.personas.add({
    id: personaId,
    name: 'X',
    tagline: '',
    colour: '#fff',
    font: 'serif',
    instructions: '',
    canonicalId: null,
    providerId: 'pr',
    modelId: 'm',
    mindspaceId: null,
    aboutMeOverride: null,
    textureOverride: null,
    temperature: 0.85,
    adultPersona: true,
    chatsundereTonality: true,
    contextWindow: null,
    libraryIds: [],
    askExpertDefault: false,
    createdAt: 1,
    updatedAt: 1,
  });
  const ms = await db.mindspaces.toArray();
  const first = ms[0];
  if (!first) throw new Error('mindspaces unseeded');
  const chatId = uuidv7();
  await db.chats.add({
    id: chatId,
    personaId,
    title: null,
    resolvedMindspaceId: first.id,
    createdAt: 1,
    lastMessageAt: 2,
    bookmarkedMessageCount: 0,
    draftInput: '',
    libraryIds: [],
  });
  return { personaId, chatId };
}

function plantStream(chatId: string, personaId: string): void {
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
          startedAt: Date.now(),
          reusedDraft: false,
        },
      ],
    ]),
  });
}

describe('nsfwPanic', () => {
  it('no-op when no adult personas exist', async () => {
    const navigate = vi.fn();
    await nsfwPanic({ navigate });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('aborts streams against adult personas (discard semantics)', async () => {
    const { personaId, chatId } = await seedAdultPersona();
    plantStream(chatId, personaId);
    const navigate = vi.fn();
    await nsfwPanic({ navigate });
    expect(useStreamManagerStore.getState().streams.size).toBe(0);
  });

  it('does not navigate when no active chat is one of the adult personas', async () => {
    const { personaId, chatId } = await seedAdultPersona();
    plantStream(chatId, personaId);
    // active chat is something else
    useCurrentChatStore.getState().setChatId('some-other-chat');
    const navigate = vi.fn();
    await nsfwPanic({ navigate });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('navigates to /app and fires toast when active chat is an adult persona', async () => {
    const { personaId, chatId } = await seedAdultPersona();
    plantStream(chatId, personaId);
    useCurrentChatStore.getState().setChatId(chatId);
    const showSpy = vi.spyOn(toastStore, 'show');
    const navigate = vi.fn();
    await nsfwPanic({ navigate });
    expect(navigate).toHaveBeenCalledWith('/app');
    await Promise.resolve();
    expect(showSpy).toHaveBeenCalledWith(
      expect.objectContaining({ tone: 'warn', message: expect.stringContaining('Adult mode') }),
    );
  });

  it('preserves the draft persona-message of an aborted adult-persona stream', async () => {
    const { personaId, chatId } = await seedAdultPersona();
    const db = await openClientDataDb();
    const draftMsgId = uuidv7();
    await db.messages.add({
      id: draftMsgId,
      chatId,
      role: 'persona',
      contentBlocks: [{ type: 'text', text: 'partial …' }],
      createdAt: 100,
      bookmarked: false,
      // Seed as 'complete' (the only non-'incomplete' value the schema permits)
      // so the post-condition `streamingState === 'incomplete'` meaningfully
      // proves the preserve method wrote to Dexie — a no-op implementation
      // would leave the row as 'complete' and fail the assertion.
      streamingState: 'complete',
    });

    // Seed a live stream-handle so panic has something to abort.
    useStreamManagerStore.setState({
      streams: new Map([
        [
          chatId,
          {
            chatId,
            personaId,
            draftMessageId: draftMsgId,
            controller: new AbortController(),
            status: 'streaming' as const,
            contentBuffer: [{ type: 'text', text: 'partial …' }],
            pillBuffer: [],
            startedAt: Date.now(),
            reusedDraft: false,
          },
        ],
      ]),
    });

    await nsfwPanic({ navigate: () => {} });

    const row = await db.messages.get(draftMsgId);
    expect(row).toBeDefined();
    expect(row?.streamingState).toBe('incomplete');
    expect(useStreamManagerStore.getState().streams.has(chatId)).toBe(false);
  });

  it('preserves user-message rows on aborted streams', async () => {
    const { personaId, chatId } = await seedAdultPersona();
    const db = await openClientDataDb();
    // Pretend a user-msg already exists in the chat (no draft persona, no stream yet)
    await db.messages.add({
      id: 'um1',
      chatId,
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'hi' }],
      createdAt: 100,
      bookmarked: false,
      streamingState: 'complete',
    });
    plantStream(chatId, personaId);
    await nsfwPanic({ navigate: vi.fn() });
    const msgs = await db.messages.where('chatId').equals(chatId).toArray();
    expect(msgs.length).toBe(1);
    expect(msgs[0]?.role).toBe('user');
  });
});
