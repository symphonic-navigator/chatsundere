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
import { useSendMessage } from '../../src/data/send-message';
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

  const model = nanoGpt.knownModels[0];
  if (!model) throw new Error('nano-gpt has no known models');

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
        reasoning: { mode: 'on' },
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
    // No CORS proxy configured — globalUnlocker should be the empty default
    expect(callArg.globalUnlocker).toBe('');
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
      lastMessageAt: 1,
      bookmarkedMessageCount: 0,
      draftInput: '',
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
        reasoning: { mode: 'on' },
      });
    });

    expect(chatId).toBe(existing);
    expect(startSpy).toHaveBeenCalledTimes(1);

    // Confirm no extra chat row was created
    const allChats = await db.chats.toArray();
    expect(allChats).toHaveLength(1);
  });
});
