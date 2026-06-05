// SPDX-License-Identifier: AGPL-3.0-only
// Routing smoke-test for ChatPage — verifies the component mounts under both
// lazy and chat-mode routes without throwing. Detailed behaviour is covered
// by chat-page.test.tsx.
import { asMasterKey, getRandomBytes } from '@chatsundere/crypto';
import { useSessionStore } from '@chatsundere/ui-shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nanoGpt } from '../../../../packages/llm-unified/src/providers/nano-gpt';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db';
import { sealSecret } from '../../src/lib/secrets';
import { runStreamEngine } from '../../src/lib/stream-engine';
import { ChatPage } from '../../src/routes/app/chat/chat-page';
import { useCurrentChatStore } from '../../src/state/current-chat.store';
import { useStreamManagerStore } from '../../src/state/stream-manager.store';

vi.mock('../../src/lib/stream-engine', () => ({ runStreamEngine: vi.fn() }));

function wrap(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/app/chat/new" element={children} />
          <Route path="/app/chat/:chatId" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
  useCurrentChatStore.getState().reset();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await _resetClientDataDbForTests({ keepData: false });
  useStreamManagerStore.setState({ streams: new Map() });
  useSessionStore.setState({ mk: null, session: null } as never);
  useCurrentChatStore.getState().reset();
});

describe('ChatPage routing', () => {
  it('lazy mode mounts without error', () => {
    const { container } = render(<ChatPage />, {
      wrapper: wrap('/app/chat/new?personaId=p1'),
    });
    expect(container.querySelector('.chat-page')).not.toBeNull();
  });

  it('chat-mode mounts without error', () => {
    const { container } = render(<ChatPage />, {
      wrapper: wrap('/app/chat/c1'),
    });
    expect(container.querySelector('.chat-page')).not.toBeNull();
  });
});

describe('ChatPage regenerate wiring', () => {
  afterEach(() => {
    useStreamManagerStore.setState({ streams: new Map() });
    useSessionStore.setState({ mk: null, session: null } as never);
    vi.clearAllMocks();
  });

  it('regenerate re-rolls the last answer, keeping the user message', async () => {
    const db = await openClientDataDb();
    const mk = asMasterKey(getRandomBytes(32));
    useSessionStore.setState({ mk } as never);

    const providerId = uuidv7();
    const apiKey = await sealSecret('k', mk, `provider/${providerId}/api-key`);
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
    if (!offering) throw new Error('no offering');
    const personaId = uuidv7();
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
      createdAt: 1,
      updatedAt: 1,
    });
    const chatId = uuidv7();
    await db.chats.add({
      id: chatId,
      personaId,
      title: 'kept',
      resolvedMindspaceId: 'm1',
      createdAt: 1,
      lastMessageAt: 3,
      bookmarkedMessageCount: 0,
      draftInput: '',
    });
    const userMsgId = uuidv7();
    await db.messages.add({
      id: userMsgId,
      chatId,
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'tell me a joke' }],
      createdAt: 2,
      bookmarked: false,
      streamingState: 'complete',
    });
    const personaMsgId = uuidv7();
    await db.messages.add({
      id: personaMsgId,
      chatId,
      role: 'persona',
      contentBlocks: [{ type: 'text', text: 'old answer' }],
      createdAt: 3,
      bookmarked: false,
      streamingState: 'complete',
    });

    vi.mocked(runStreamEngine).mockImplementation((async (a: {
      onChunk: (c: unknown) => void;
    }) => {
      a.onChunk({ type: 'token', text: 'fresh answer' });
      return {
        finalContentBlocks: [{ type: 'text', text: 'fresh answer' }],
        pillRows: [],
        finishReason: 'stop',
      };
    }) as never);

    render(<ChatPage />, { wrapper: wrap(`/app/chat/${chatId}`) });

    // Wait for the persona message to appear in the DOM.
    await waitFor(() => expect(screen.getByText('old answer')).toBeInTheDocument());

    // Tap the .msg element to expand it — that reveals MessageControls.
    const msgEl = screen.getByText('old answer').closest('.msg') as HTMLElement;
    fireEvent.click(msgEl);

    // Now the ↻ Regenerate button should be visible.
    const regenBtn = await screen.findByText('↻ Regenerate');
    fireEvent.click(regenBtn);

    await waitFor(async () => {
      const persona = await db.messages.get(personaMsgId);
      expect(persona?.contentBlocks).toEqual([{ type: 'text', text: 'fresh answer' }]);
      expect(persona?.streamingState).toBe('complete');
    });
    const user = await db.messages.get(userMsgId);
    expect(user?.contentBlocks).toEqual([{ type: 'text', text: 'tell me a joke' }]);
    expect(await db.messages.where('chatId').equals(chatId).count()).toBe(2);
  });
});
