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
import { useStartOpener } from '../../src/data/send-message';
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
    greetingEnabled: true,
    greetingInstructions: 'Say hello warmly.',
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
    resolvedMindspaceId: settings.defaultMindspaceId ?? 'm1',
    createdAt: 1,
    lastMessageAt: 1,
    bookmarkedMessageCount: 0,
    draftInput: '',
    libraryIds: [],
    openerPending: true,
  });

  return { db, chatId, personaId, providerId, mk };
}

describe('useStartOpener', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests({ keepData: false });
  });

  afterEach(async () => {
    await _resetClientDataDbForTests({ keepData: false });
    vi.restoreAllMocks();
    useStreamManagerStore.setState({ streams: new Map() });
    useSessionStore.setState({ mk: null, session: null });
  });

  it('resolves the persona context and calls stream-manager.startOpener with the full chain', async () => {
    const { chatId } = await seed();

    const startOpenerSpy = vi
      .spyOn(useStreamManagerStore.getState(), 'startOpener')
      .mockResolvedValue(undefined);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useStartOpener(), { wrapper: wrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync({ chatId, reasoning: { kind: 'on' } });
    });

    expect(startOpenerSpy).toHaveBeenCalledTimes(1);

    const arg = startOpenerSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg.chatId).toBe(chatId);
    expect(arg.apiKey).toBe('test-key');

    // Persona, provider and offering must all be forwarded from resolvePersonaContext.
    expect(arg.persona).toBeDefined();
    expect((arg.persona as { name: string }).name).toBe('Aurum');
    expect(arg.provider).toBeDefined();
    expect(arg.offering).toBeDefined();

    // Reasoning forwarded from args.
    expect(arg.reasoning).toEqual({ kind: 'on' });

    // Global instructions default to empty string.
    expect(arg.globalInstructions).toBe('');
  });
});
