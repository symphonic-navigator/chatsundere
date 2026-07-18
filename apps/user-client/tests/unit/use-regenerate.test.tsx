// SPDX-License-Identifier: AGPL-3.0-only
import { asMasterKey, getRandomBytes } from '@chatsundere/crypto';
import { useSessionStore } from '@chatsundere/ui-shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { nanoGpt } from '../../../../packages/llm-unified/src/providers/nano-gpt';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db';
import { useRegenerate } from '../../src/data/send-message';
import { sealSecret } from '../../src/lib/secrets';
import { useStreamManagerStore } from '../../src/state/stream-manager.store';

async function seedChatWithProvider() {
  const mk = asMasterKey(getRandomBytes(32));
  useSessionStore.setState({ mk } as never);
  const db = await openClientDataDb();
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
    greetingEnabled: true,
    greetingInstructions: '',
    voice: null,
    narratorVoice: null,
    createdAt: 1,
    updatedAt: 1,
  });
  return { db, personaId, providerId, mk };
}

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

async function seedChatWithExchange() {
  const mk = asMasterKey(getRandomBytes(32));
  useSessionStore.setState({ mk } as never);
  const db = await openClientDataDb();
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
  const chatId = uuidv7();
  await db.chats.add({
    id: chatId,
    personaId,
    title: null,
    resolvedMindspaceId: 'm1',
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 4,
    bookmarkedMessageCount: 0,
    draftInput: '',
    libraryIds: [],
  });
  const userMsgId = uuidv7();
  await db.messages.add({
    id: userMsgId,
    chatId,
    role: 'user',
    contentBlocks: [{ type: 'text', text: 'tell me a joke' }],
    createdAt: 2,
    updatedAt: 2,
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
    updatedAt: 3,
    bookmarked: false,
    streamingState: 'complete',
  });
  return { db, chatId, personaId, userMsgId, personaMsgId };
}

describe('useRegenerate (non-destructive)', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests({ keepData: false });
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
    // The prior user turn's id must travel so the stream manager can re-inject
    // that turn's attachments (images), not just its text (spec §9 fix).
    expect(arg.userMessageId).toBe(userMsgId);
    expect(arg.priorMessages).toEqual([]);

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
            reusedDraft: false,
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
      updatedAt: 1,
      lastMessageAt: 1,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useRegenerate(), { wrapper: wrapper(qc) });
    await expect(result.current.mutateAsync({ chatId, reasoning: { kind: 'on' } })).rejects.toThrow(
      /no last persona message|no prior user-message|nothing to regenerate/,
    );
  });

  it('opener-only chat (complete): calls regenerateOpener instead of throwing no-prior-user-message', async () => {
    const { db, personaId } = await seedChatWithProvider();
    const chatId = uuidv7();
    await db.chats.add({
      id: chatId,
      personaId,
      title: null,
      resolvedMindspaceId: 'm1',
      createdAt: 1,
      updatedAt: 1,
      lastMessageAt: 2,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });
    const openerId = uuidv7();
    await db.messages.add({
      id: openerId,
      chatId,
      role: 'persona',
      kind: 'opener',
      contentBlocks: [{ type: 'text', text: 'Hello there!' }],
      createdAt: 2,
      updatedAt: 2,
      bookmarked: false,
      streamingState: 'complete',
    });

    const regenOpenerSpy = vi
      .spyOn(useStreamManagerStore.getState(), 'regenerateOpener')
      .mockResolvedValue(undefined);
    const regenSpy = vi
      .spyOn(useStreamManagerStore.getState(), 'regenerate')
      .mockResolvedValue(undefined);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useRegenerate(), { wrapper: wrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync({ chatId, reasoning: { kind: 'on' } });
    });

    expect(regenOpenerSpy).toHaveBeenCalledTimes(1);
    expect(regenSpy).not.toHaveBeenCalled();
    const arg = regenOpenerSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg.chatId).toBe(chatId);
    expect(arg.targetMessageId).toBe(openerId);
  });

  it('opener-only chat (incomplete): calls regenerateOpener instead of throwing no-prior-user-message', async () => {
    const { db, personaId } = await seedChatWithProvider();
    const chatId = uuidv7();
    await db.chats.add({
      id: chatId,
      personaId,
      title: null,
      resolvedMindspaceId: 'm1',
      createdAt: 1,
      updatedAt: 1,
      lastMessageAt: 2,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });
    const openerId = uuidv7();
    await db.messages.add({
      id: openerId,
      chatId,
      role: 'persona',
      kind: 'opener',
      contentBlocks: [],
      createdAt: 2,
      updatedAt: 2,
      bookmarked: false,
      streamingState: 'incomplete',
    });

    const regenOpenerSpy = vi
      .spyOn(useStreamManagerStore.getState(), 'regenerateOpener')
      .mockResolvedValue(undefined);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useRegenerate(), { wrapper: wrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync({ chatId, reasoning: { kind: 'on' } });
    });

    expect(regenOpenerSpy).toHaveBeenCalledTimes(1);
    const arg = regenOpenerSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg.targetMessageId).toBe(openerId);
  });

  it('normal chat with opener: ignores opener row when locating the regenerate target', async () => {
    // Seed: [opener(persona), user, reply(persona)] — target must be reply, not opener.
    const { db, personaId } = await seedChatWithProvider();
    const chatId = uuidv7();
    await db.chats.add({
      id: chatId,
      personaId,
      title: null,
      resolvedMindspaceId: 'm1',
      createdAt: 1,
      updatedAt: 1,
      lastMessageAt: 4,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });
    const openerId = uuidv7();
    await db.messages.add({
      id: openerId,
      chatId,
      role: 'persona',
      kind: 'opener',
      contentBlocks: [{ type: 'text', text: 'Hello!' }],
      createdAt: 2,
      updatedAt: 2,
      bookmarked: false,
      streamingState: 'complete',
    });
    const userMsgId = uuidv7();
    await db.messages.add({
      id: userMsgId,
      chatId,
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'tell me a joke' }],
      createdAt: 3,
      updatedAt: 3,
      bookmarked: false,
      streamingState: 'complete',
    });
    const replyId = uuidv7();
    await db.messages.add({
      id: replyId,
      chatId,
      role: 'persona',
      contentBlocks: [{ type: 'text', text: 'Why did the chicken' }],
      createdAt: 4,
      updatedAt: 4,
      bookmarked: false,
      streamingState: 'complete',
    });

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
    // Must target the reply, not the opener.
    expect(arg.targetMessageId).toBe(replyId);
    // Must replay the user turn.
    expect(arg.userMessageText).toBe('tell me a joke');
  });
});
