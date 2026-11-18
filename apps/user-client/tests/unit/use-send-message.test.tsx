// SPDX-License-Identifier: AGPL-3.0-only
import { asMasterKey, getRandomBytes } from '@chatsundere/crypto';
import { useSessionStore } from '@chatsundere/ui-shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nanoGpt } from '../../../../packages/llm-unified/src/providers/nano-gpt';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db';
import { MasterKeyUnavailableError, ProviderKeyLockedError } from '../../src/data/send-errors';
import { assertPersonaKeyUsable, useSendMessage } from '../../src/data/send-message';
import { sealSecret } from '../../src/lib/secrets';
import { useStreamManagerStore } from '../../src/state/stream-manager.store';

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

async function seed() {
  const mk = asMasterKey(getRandomBytes(32));
  useSessionStore.setState({ mk } as never);

  const db = await openClientDataDb();
  const settings = await db.settings.get(1);
  if (!settings) throw new Error('settings missing after openClientDataDb seeding');

  const personaId = uuidv7();
  const providerId = uuidv7();
  const apiKey = await sealSecret('test-key', mk, `provider/${providerId}/api-key`);

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
  if (!offering) throw new Error('nano-gpt has no offerings');

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
    chatsundereTonality: true,
    contextWindow: null,
    libraryIds: [],
    askExpertDefault: false,
    mcpOverrides: {},
    roleplay: false,
    narration: 'first',
    greetingEnabled: false,
    greetingInstructions: '',
    voice: null,
    narratorVoice: null,
    createdAt: 1,
    updatedAt: 1,
  });

  return { db, personaId, providerId, mk };
}

describe('useSendMessage', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests({ keepData: false });
  });

  afterEach(async () => {
    await _resetClientDataDbForTests({ keepData: false });
    vi.restoreAllMocks();
    useStreamManagerStore.setState({ streams: new Map() });
    useSessionStore.setState({ mk: null, session: null });
  });

  it('lazy: creates ChatRow + invokes stream-manager.start with composed args', async () => {
    const { db, personaId } = await seed();

    const startSpy = vi
      .spyOn(useStreamManagerStore.getState(), 'start')
      .mockResolvedValue(undefined);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSendMessage(), { wrapper: wrapper(qc) });

    let chatId = '';
    await act(async () => {
      chatId = await result.current.mutateAsync({
        chatId: null,
        personaId,
        text: 'Hello',
        reasoning: { kind: 'on' },
      });
    });

    expect(chatId).toBeTruthy();

    const row = await db.chats.get(chatId);
    expect(row?.personaId).toBe(personaId);
    expect(row?.draftInput).toBe('');

    expect(startSpy).toHaveBeenCalledTimes(1);

    const callArg = startSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArg.chatId).toBe(chatId);
    expect(callArg.userText).toBe('Hello');
    expect(callArg.apiKey).toBe('test-key');
    // No CORS proxy configured — globalInstructions should be the empty default
    expect(callArg.globalInstructions).toBe('');
  });

  it('passes a knowledge context built from the persona/chat libraryIds', async () => {
    const { db, personaId } = await seed();

    // Assign an existing library to the persona so the effective set is non-empty.
    const libraryId = uuidv7();
    await db.libraries.add({
      id: libraryId,
      name: 'Lore',
      description: 'World lore',
      nsfw: false,
      createdAt: 1,
      updatedAt: 1,
    });
    await db.personas.update(personaId, { libraryIds: [libraryId] });

    const startSpy = vi
      .spyOn(useStreamManagerStore.getState(), 'start')
      .mockResolvedValue(undefined);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSendMessage(), { wrapper: wrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync({
        chatId: null,
        personaId,
        text: 'Hello',
        reasoning: { kind: 'on' },
      });
    });

    expect(startSpy).toHaveBeenCalledTimes(1);
    const callArg = startSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    const knowledge = callArg.knowledge as { libraries: { id: string }[] } | null;
    expect(knowledge).not.toBeNull();
    expect(knowledge?.libraries.map((l) => l.id)).toContain(libraryId);
  });

  it('passes a null knowledge context when no libraries are assigned', async () => {
    const { personaId } = await seed();

    const startSpy = vi
      .spyOn(useStreamManagerStore.getState(), 'start')
      .mockResolvedValue(undefined);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSendMessage(), { wrapper: wrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync({
        chatId: null,
        personaId,
        text: 'Hello',
        reasoning: { kind: 'on' },
      });
    });

    const callArg = startSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArg.knowledge).toBeNull();
  });

  it('chat-mode: reuses existing ChatRow and does not create a new one', async () => {
    const { db, personaId } = await seed();

    const existing = uuidv7();
    const settings = await db.settings.get(1);
    await db.chats.add({
      id: existing,
      personaId,
      title: null,
      resolvedMindspaceId: settings?.defaultMindspaceId ?? 'm1',
      createdAt: 1,
      updatedAt: 1,
      lastMessageAt: 1,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });

    const startSpy = vi
      .spyOn(useStreamManagerStore.getState(), 'start')
      .mockResolvedValue(undefined);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSendMessage(), { wrapper: wrapper(qc) });

    let chatId = '';
    await act(async () => {
      chatId = await result.current.mutateAsync({
        chatId: existing,
        personaId,
        text: 'Hi',
        reasoning: { kind: 'on' },
      });
    });

    expect(chatId).toBe(existing);
    expect(startSpy).toHaveBeenCalledTimes(1);

    // Confirm no extra chat row was created
    const allChats = await db.chats.toArray();
    expect(allChats).toHaveLength(1);
  });

  // ── Typed stops (spec 0.5.0 papercuts, item 7) ─────────────────────────────

  async function lockKey(db: Awaited<ReturnType<typeof seed>>['db'], providerId: string) {
    // Re-seal under a different master key: the session's key can no longer open it.
    const other = asMasterKey(getRandomBytes(32));
    const apiKey = await sealSecret('test-key', other, `provider/${providerId}/api-key`);
    await db.providers.update(providerId, { apiKey });
  }

  it('throws MasterKeyUnavailableError without a master key, and creates no chat row', async () => {
    const { db, personaId } = await seed();
    useSessionStore.setState({ mk: null } as never);
    const startSpy = vi.spyOn(useStreamManagerStore.getState(), 'start');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSendMessage(), { wrapper: wrapper(qc) });

    let err: unknown;
    await act(async () => {
      err = await result.current
        .mutateAsync({ chatId: null, personaId, text: 'Hello', reasoning: { kind: 'on' } })
        .catch((e: unknown) => e);
    });
    expect(err).toBeInstanceOf(MasterKeyUnavailableError);
    expect(startSpy).not.toHaveBeenCalled();
    expect(await db.chats.count()).toBe(0);
  });

  it('throws ProviderKeyLockedError for a key sealed under another master key; no chat row is left', async () => {
    const { db, personaId, providerId } = await seed();
    await lockKey(db, providerId);
    const startSpy = vi.spyOn(useStreamManagerStore.getState(), 'start');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSendMessage(), { wrapper: wrapper(qc) });

    let err: unknown;
    await act(async () => {
      err = await result.current
        .mutateAsync({ chatId: null, personaId, text: 'Hello', reasoning: { kind: 'on' } })
        .catch((e: unknown) => e);
    });
    expect(err).toBeInstanceOf(ProviderKeyLockedError);
    expect(err).toMatchObject({ templateId: 'nano-gpt', providerName: nanoGpt.displayName });
    // Carries no key material or WebCrypto internals.
    expect((err as Error).cause).toBeUndefined();
    expect(JSON.stringify(err)).not.toContain('test-key');
    expect(startSpy).not.toHaveBeenCalled();
    expect(await db.chats.count()).toBe(0);
    expect(await db.syncOutbox.count()).toBe(0);
  });

  it('keeps plain errors for everything else (a missing persona is not a typed stop)', async () => {
    await seed();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSendMessage(), { wrapper: wrapper(qc) });
    let err: unknown;
    await act(async () => {
      err = await result.current
        .mutateAsync({ chatId: null, personaId: 'nope', text: 'x', reasoning: { kind: 'on' } })
        .catch((e: unknown) => e);
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ProviderKeyLockedError);
    expect(err).not.toBeInstanceOf(MasterKeyUnavailableError);
    expect((err as Error).message).toBe('useSendMessage: persona not found');
  });

  it('wire unchanged: a successful lazy send hands start() the same inputs as a stored chat', async () => {
    // Resolving the context before the row exists must not change what the
    // request is built from: the chat the stream manager gets is the stored row,
    // the prior messages are read after it exists, and the argument set is fixed.
    const { db, personaId } = await seed();
    const startSpy = vi
      .spyOn(useStreamManagerStore.getState(), 'start')
      .mockResolvedValue(undefined);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSendMessage(), { wrapper: wrapper(qc) });

    let chatId = '';
    await act(async () => {
      chatId = await result.current.mutateAsync({
        chatId: null,
        personaId,
        text: 'Hello',
        reasoning: { kind: 'on' },
      });
    });
    const lazyArg = startSpy.mock.calls[0]?.[0] as unknown as Record<string, unknown>;
    expect(lazyArg.chat).toEqual(await db.chats.get(chatId));
    expect(lazyArg.priorMessages).toEqual([]);

    // The same chat, now stored: a second send resolves it from the table.
    await act(async () => {
      await result.current.mutateAsync({
        chatId,
        personaId,
        text: 'Hello',
        reasoning: { kind: 'on' },
      });
    });
    const storedArg = startSpy.mock.calls[1]?.[0] as unknown as Record<string, unknown>;

    const KEYS = [
      'apiKey',
      'artefactExpert',
      'background',
      'chat',
      'chatId',
      'expertBase',
      'expertModelLabel',
      'expertReasoning',
      'expertWeb',
      'globalAboutMe',
      'globalInstructions',
      'images',
      'knowledge',
      'lore',
      'loreContext',
      'mcp',
      'offering',
      'persona',
      'priorMessages',
      'provider',
      'providerConfig',
      'reasoning',
      'screenEffectsEnabled',
      'substituteOneShotBase',
      'substituteVisionModel',
      'userMessageText',
      'userText',
      'webInterfacing',
    ];
    expect(Object.keys(lazyArg).sort()).toEqual(KEYS);
    expect(Object.keys(storedArg).sort()).toEqual(KEYS);
    for (const k of [
      'apiKey',
      'chat',
      'chatId',
      'offering',
      'persona',
      'provider',
      'providerConfig',
      'globalInstructions',
      'globalAboutMe',
      'webInterfacing',
      'userMessageText',
      'artefactExpert',
      'loreContext',
    ]) {
      expect(storedArg[k], k).toEqual(lazyArg[k]);
    }
    expect(lazyArg.apiKey).toBe('test-key');
    expect(lazyArg.providerConfig).toEqual({
      baseUrl: nanoGpt.baseUrl,
      routing: { kind: 'direct' },
    });
  });

  describe('assertPersonaKeyUsable', () => {
    async function seedStoredChat(db: Awaited<ReturnType<typeof seed>>['db'], personaId: string) {
      const chatId = uuidv7();
      await db.chats.add({
        id: chatId,
        personaId,
        title: null,
        resolvedMindspaceId: 'm1',
        createdAt: 1,
        updatedAt: 1,
        lastMessageAt: 1,
        bookmarkedMessageCount: 0,
        draftInput: '',
        libraryIds: [],
      });
      return chatId;
    }

    it('resolves when the key opens', async () => {
      const { db, personaId } = await seed();
      const chatId = await seedStoredChat(db, personaId);
      await expect(assertPersonaKeyUsable(chatId)).resolves.toBeUndefined();
    });

    it('throws ProviderKeyLockedError for a locked key', async () => {
      const { db, personaId, providerId } = await seed();
      const chatId = await seedStoredChat(db, personaId);
      await lockKey(db, providerId);
      await expect(assertPersonaKeyUsable(chatId)).rejects.toBeInstanceOf(ProviderKeyLockedError);
    });

    it('throws MasterKeyUnavailableError without a master key', async () => {
      const { db, personaId } = await seed();
      const chatId = await seedStoredChat(db, personaId);
      useSessionStore.setState({ mk: null } as never);
      await expect(assertPersonaKeyUsable(chatId)).rejects.toBeInstanceOf(
        MasterKeyUnavailableError,
      );
    });
  });
});
