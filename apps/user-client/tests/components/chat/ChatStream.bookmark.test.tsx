// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../../src/boot/client-data-db.js';
import { ChatStream } from '../../../src/components/chat/ChatStream.js';
import { useCurrentChatStore } from '../../../src/state/current-chat.store.js';

beforeEach(async () => {
  useCurrentChatStore.getState().reset();
  await openClientDataDb();
  const db = getClientDataDb();
  await db.messages.clear();
  await db.chats.clear();
  await db.chats.add({
    id: 'c1',
    personaId: 'p1',
    title: null,
    resolvedMindspaceId: 'm1',
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
    bookmarkedMessageCount: 0,
    draftInput: '',
    libraryIds: [],
  });
  await db.messages.add({
    id: 'u1',
    chatId: 'c1',
    role: 'user',
    contentBlocks: [{ type: 'text', text: 'hi' }],
    createdAt: 1,
    updatedAt: 1,
    bookmarked: false,
    streamingState: 'complete',
  });
});

afterEach(async () => {
  await _resetClientDataDbForTests();
});

describe('ChatStream bookmark wiring', () => {
  it('toggles the message bookmark via the message control', async () => {
    const qc = new QueryClient();
    const db = getClientDataDb();
    const messages = await db.messages.where('chatId').equals('c1').toArray();
    render(
      <QueryClientProvider client={qc}>
        <ChatStream
          chatId="c1"
          messages={messages}
          pills={[]}
          persona={null}
          displayName="Me"
          streamHandle={null}
        />
      </QueryClientProvider>,
    );
    useCurrentChatStore.getState().toggleExpanded('u1');
    fireEvent.click(await screen.findByText(/Bookmark/));
    await waitFor(async () => {
      expect((await db.messages.get('u1'))?.bookmarked).toBe(true);
    });
  });
});
