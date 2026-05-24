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
  const model = nanoGpt.knownModels[0];
  if (!model) throw new Error('no model');
  await db.personas.add({
    id: personaId,
    name: 'Aurum',
    tagline: '',
    colour: '#c9a84c',
    font: 'serif',
    instructions: 'instr',
    providerId,
    modelId: model.id,
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
    title: null,
    resolvedMindspaceId: 'm1',
    createdAt: 1,
    lastMessageAt: 4,
    bookmarkedMessageCount: 0,
    draftInput: '',
  });
  await db.messages.add({
    id: uuidv7(),
    chatId,
    role: 'user',
    contentBlocks: [{ type: 'text', text: 'tell me a joke' }],
    createdAt: 2,
    bookmarked: false,
    streamingState: 'complete',
  });
  await db.messages.add({
    id: uuidv7(),
    chatId,
    role: 'persona',
    contentBlocks: [{ type: 'text', text: 'why did the chicken' }],
    createdAt: 3,
    bookmarked: false,
    streamingState: 'complete',
  });
  return { db, chatId, personaId };
}

describe('useRegenerate', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests({ keepData: false });
  });

  afterEach(async () => {
    await _resetClientDataDbForTests({ keepData: false });
    vi.restoreAllMocks();
    useStreamManagerStore.setState({ streams: new Map() });
    useSessionStore.setState({ mk: null, session: null });
  });

  it('deletes last persona + user, re-sends with prior user-text', async () => {
    const { db, chatId } = await seedChatWithExchange();
    const startSpy = vi
      .spyOn(useStreamManagerStore.getState(), 'start')
      .mockResolvedValue(undefined);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useRegenerate(), { wrapper: wrapper(qc) });
    await act(async () => {
      await result.current.mutateAsync({ chatId, reasoning: { mode: 'on' } });
    });
    // After regenerate, the old user + persona messages are gone; stream-manager.start re-inserts them.
    expect(startSpy).toHaveBeenCalledTimes(1);
    const callArg = startSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArg.userText).toBe('tell me a joke');
    const remaining = await db.messages.where('chatId').equals(chatId).count();
    // Pre-regenerate the chat had 2 msgs. After deletion: 0. start() inserts 2 (user + draft persona).
    // The mock didn't actually run start(), so we expect 0 messages (deletion only).
    expect(remaining).toBe(0);
  });

  it('aborts an in-flight stream before regenerating', async () => {
    const { chatId, personaId } = await seedChatWithExchange();
    // Plant a live handle
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
          },
        ],
      ]),
    });
    const abortSpy = vi
      .spyOn(useStreamManagerStore.getState(), 'abortDiscard')
      .mockResolvedValue(undefined);
    vi.spyOn(useStreamManagerStore.getState(), 'start').mockResolvedValue(undefined);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useRegenerate(), { wrapper: wrapper(qc) });
    await act(async () => {
      await result.current.mutateAsync({ chatId, reasoning: { mode: 'on' } });
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
    await expect(result.current.mutateAsync({ chatId, reasoning: { mode: 'on' } })).rejects.toThrow(
      /prior user-message/,
    );
  });
});
