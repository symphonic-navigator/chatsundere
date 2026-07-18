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
import { useEditAndReplace } from '../../src/data/message-edit';
import { sealSecret } from '../../src/lib/secrets';
import * as engine from '../../src/lib/stream-engine';
import { useStreamManagerStore } from '../../src/state/stream-manager.store';

/**
 * Seed a chat that ends on a user message whose trailing persona reply is
 * INCOMPLETE (the user Stopped it, or generation failed) — the exact shape the
 * old heuristic skipped. An earlier complete user+persona pair sits before it.
 */
async function seedStalledTrailingReply() {
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
  const lastUserId = uuidv7();
  await db.chats.add({
    id: chatId,
    personaId,
    // Non-null title so the re-roll never triggers a live title-gen network call.
    title: 'kept',
    resolvedMindspaceId: 'm1',
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 5,
    bookmarkedMessageCount: 0,
    draftInput: '',
    libraryIds: [],
    editingMessageId: lastUserId,
  });
  const earlyUserId = uuidv7();
  const earlyPersonaId = uuidv7();
  const stalledReplyId = uuidv7();
  await db.messages.bulkAdd([
    {
      id: earlyUserId,
      chatId,
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'first q' }],
      createdAt: 2,
      updatedAt: 2,
      bookmarked: false,
      streamingState: 'complete',
    },
    {
      id: earlyPersonaId,
      chatId,
      role: 'persona',
      contentBlocks: [{ type: 'text', text: 'first answer' }],
      createdAt: 3,
      updatedAt: 3,
      bookmarked: false,
      streamingState: 'complete',
    },
    {
      id: lastUserId,
      chatId,
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'second q' }],
      createdAt: 4,
      updatedAt: 4,
      bookmarked: false,
      streamingState: 'complete',
    },
    {
      // The trailing reply to the last user message — INCOMPLETE (Stopped/failed).
      id: stalledReplyId,
      chatId,
      role: 'persona',
      contentBlocks: [{ type: 'text', text: 'half-written…' }],
      createdAt: 5,
      updatedAt: 5,
      bookmarked: false,
      streamingState: 'incomplete',
    },
  ]);
  return { db, chatId, earlyPersonaId, lastUserId, stalledReplyId };
}

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('useEditAndReplace — real regenerate target selection (I1)', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests({ keepData: false });
  });
  afterEach(async () => {
    await _resetClientDataDbForTests({ keepData: false });
    vi.restoreAllMocks();
    useStreamManagerStore.setState({ streams: new Map() });
    useSessionStore.setState({ mk: null, session: null } as never);
  });

  it('resets the INCOMPLETE trailing reply, not the earlier complete one', async () => {
    const { db, chatId, earlyPersonaId, lastUserId, stalledReplyId } =
      await seedStalledTrailingReply();

    // Mock ONLY the stream engine — useRegenerate's real target selection runs.
    vi.spyOn(engine, 'runStreamEngine').mockImplementation((async (a: {
      onChunk: (c: unknown) => void;
    }) => {
      a.onChunk({ type: 'token', text: 'fresh reply' });
      return {
        finalContentBlocks: [{ type: 'text', text: 'fresh reply' }],
        pillRows: [],
        finishReason: 'stop',
        usedTokens: 0,
      };
    }) as never);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useEditAndReplace(), { wrapper: wrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync({
        chatId,
        messageId: lastUserId,
        text: 'second edited',
        stagedRemovals: [],
        reasoning: { kind: 'on' },
      });
    });
    // Let the store's fire-and-forget resolution chain persist the final row.
    await new Promise((r) => setTimeout(r, 60));

    // The edited user message carries the new text.
    const lastUser = await db.messages.get(lastUserId);
    expect(lastUser?.contentBlocks).toEqual([{ type: 'text', text: 'second edited' }]);

    // The INCOMPLETE trailing reply is the one that got reset + refilled.
    const stalled = await db.messages.get(stalledReplyId);
    expect(stalled?.streamingState).toBe('complete');
    expect(stalled?.contentBlocks).toEqual([{ type: 'text', text: 'fresh reply' }]);

    // The EARLIER complete persona reply is untouched (pre-fix would re-roll THIS).
    const early = await db.messages.get(earlyPersonaId);
    expect(early?.streamingState).toBe('complete');
    expect(early?.contentBlocks).toEqual([{ type: 'text', text: 'first answer' }]);
  });
});
