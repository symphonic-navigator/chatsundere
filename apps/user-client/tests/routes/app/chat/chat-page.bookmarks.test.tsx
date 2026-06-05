// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../../../src/boot/client-data-db.js';
import { ChatPage } from '../../../../src/routes/app/chat/chat-page.js';
import { useCurrentChatStore } from '../../../../src/state/current-chat.store.js';

beforeEach(async () => {
  await openClientDataDb();
  useCurrentChatStore.getState().reset();
  const db = getClientDataDb();
  await db.messages.clear();
  await db.chats.clear();
  await db.chats.add({
    id: 'c1',
    personaId: 'p1',
    title: 'T',
    resolvedMindspaceId: 'm1',
    createdAt: 1,
    lastMessageAt: 2,
    bookmarkedMessageCount: 0,
    draftInput: '',
  });
  await db.messages.bulkAdd([
    {
      id: 'u1',
      chatId: 'c1',
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'first q' }],
      createdAt: 1,
      bookmarked: false,
      streamingState: 'complete',
    },
    {
      id: 'u2',
      chatId: 'c1',
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'second q' }],
      createdAt: 2,
      bookmarked: false,
      streamingState: 'complete',
    },
  ]);
});

afterEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
});

function renderChat() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/app/chat/c1']}>
        <Routes>
          <Route path="/app/chat/:chatId" element={<ChatPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ChatPage bookmarks integration', () => {
  it('opens the ToC from the reading tool-strip and lists user messages', async () => {
    renderChat();
    useCurrentChatStore.getState().setInteractionMode(false);
    fireEvent.click(await screen.findByRole('button', { name: /show tools/i }));
    fireEvent.click(screen.getByRole('button', { name: /bookmarks and contents/i }));
    // Scope to the ToC sheet region — the message bodies also render in the
    // chat stream, so a global getByText would match multiple elements.
    const sheet = await screen.findByRole('complementary', { name: /bookmarks and contents/i });
    await waitFor(() => {
      expect(within(sheet).getByText('first q')).toBeTruthy();
      expect(within(sheet).getByText('second q')).toBeTruthy();
    });
  });
});
