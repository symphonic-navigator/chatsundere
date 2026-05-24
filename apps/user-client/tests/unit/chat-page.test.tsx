// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db';
import { ChatPage } from '../../src/routes/app/chat/chat-page';
import { useCurrentChatStore } from '../../src/state/current-chat.store';

function makeWrapper(qc: QueryClient, initial: string) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
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
  await _resetClientDataDbForTests({ keepData: false });
  vi.restoreAllMocks();
});

describe('ChatPage', () => {
  it('lazy mode renders PersonaGreeting + auto-opens Interaction Mode with pinned cockpit', async () => {
    const db = await openClientDataDb();
    const personaId = uuidv7();
    await db.personas.add({
      id: personaId,
      name: 'Aurum',
      tagline: '',
      colour: '#c9a84c',
      font: 'serif',
      instructions: '',
      providerId: 'pr',
      modelId: 'deepseek/deepseek-v4-flash',
      mindspaceId: null,
      aboutMeOverride: null,
      textureOverride: null,
      temperature: 0.85,
      adultPersona: false,
      createdAt: 1,
      updatedAt: 1,
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(<ChatPage />, {
      wrapper: makeWrapper(qc, `/app/chat/new?personaId=${personaId}`),
    });
    await waitFor(() => expect(container.querySelector('.persona-greeting')).not.toBeNull());
    expect(container.querySelector('.persona-greeting')?.textContent).toContain('Aurum');
    expect(useCurrentChatStore.getState().isInteractionMode).toBe(true);
    expect(useCurrentChatStore.getState().isPinned).toBe(true);
  });

  it('chat-mode loads messages and renders them', async () => {
    const db = await openClientDataDb();
    const personaId = uuidv7();
    await db.personas.add({
      id: personaId,
      name: 'Aurum',
      tagline: '',
      colour: '#c9a84c',
      font: 'serif',
      instructions: '',
      providerId: 'pr',
      modelId: 'deepseek/deepseek-v4-flash',
      mindspaceId: null,
      aboutMeOverride: null,
      textureOverride: null,
      temperature: 0.85,
      adultPersona: false,
      createdAt: 1,
      updatedAt: 1,
    });
    const chatId = uuidv7();
    const ms = await db.mindspaces.toArray();
    const firstMs = ms[0];
    if (!firstMs) throw new Error('No mindspace seeded — openClientDataDb should always seed one');
    await db.chats.add({
      id: chatId,
      personaId,
      title: null,
      resolvedMindspaceId: firstMs.id,
      createdAt: 1,
      lastMessageAt: 2,
      bookmarkedMessageCount: 0,
      draftInput: '',
    });
    await db.messages.add({
      id: uuidv7(),
      chatId,
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'hello' }],
      createdAt: 2,
      bookmarked: false,
      streamingState: 'complete',
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(<ChatPage />, {
      wrapper: makeWrapper(qc, `/app/chat/${chatId}`),
    });
    await waitFor(() => {
      expect(container.querySelector('.msg.from-user')).not.toBeNull();
    });
    expect(container.querySelector('.msg-text')?.textContent).toContain('hello');
  });
});
