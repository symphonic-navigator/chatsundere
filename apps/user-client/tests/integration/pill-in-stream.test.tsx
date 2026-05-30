// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { uuidv7 } from 'uuidv7';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db';
import { ChatPage } from '../../src/routes/app/chat/chat-page';
import { useCurrentChatStore } from '../../src/state/current-chat.store';
import { useStreamManagerStore } from '../../src/state/stream-manager.store';

function makeWrapper(qc: QueryClient, initial: string) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/app/chat/:chatId" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
  useStreamManagerStore.setState({ streams: new Map() });
  useCurrentChatStore.getState().reset();
});

afterEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
  vi.restoreAllMocks();
});

describe('Pill rendering integration', () => {
  it('a persisted PillRow renders as inline Pill inside MessageBlock', async () => {
    const db = await openClientDataDb();
    const personaId = uuidv7();
    await db.personas.add({
      id: personaId,
      name: 'Aurum',
      tagline: '',
      colour: '#c9a84c',
      font: 'serif',
      instructions: 'inst',
      canonicalId: null,
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
    const ms = await db.mindspaces.toArray();
    const chatId = uuidv7();
    await db.chats.add({
      id: chatId,
      personaId,
      title: null,
      resolvedMindspaceId: ms[0]?.id ?? '',
      createdAt: 1,
      lastMessageAt: 3,
      bookmarkedMessageCount: 0,
      draftInput: '',
    });
    const personaMsgId = uuidv7();
    const pillId = uuidv7();
    // Plant a persona-message with a text+pill+text contentBlocks sequence.
    await db.messages.add({
      id: personaMsgId,
      chatId,
      role: 'persona',
      contentBlocks: [
        { type: 'text', text: 'I asked ' },
        { type: 'pill', pillId },
        { type: 'text', text: ' for confirmation.' },
      ],
      createdAt: 3,
      bookmarked: false,
      streamingState: 'complete',
    });
    await db.pills.add({
      id: pillId,
      messageId: personaMsgId,
      kind: 'tool-call',
      positionHint: 'inline',
      status: 'completed',
      payload: { name: 'web_search', argumentsJson: '{}', toolCallId: 't1' },
      createdAt: 3,
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(<ChatPage />, { wrapper: makeWrapper(qc, `/app/chat/${chatId}`) });

    await waitFor(() => {
      const block = container.querySelector(`[data-msg-id="${personaMsgId}"]`);
      expect(block).not.toBeNull();
    });

    const block = container.querySelector(`[data-msg-id="${personaMsgId}"]`);
    const pill = block?.querySelector('.pill') as HTMLElement | null;
    expect(pill).not.toBeNull();
    expect(pill?.getAttribute('data-pill-kind')).toBe('tool-call');
    expect(pill?.textContent).toContain('web_search');
    // Ordering: text-before contains "I asked", text-after contains "for confirmation"
    const txt = block?.querySelector('.msg-text')?.textContent ?? '';
    const i1 = txt.indexOf('I asked');
    const iPill = txt.indexOf('web_search');
    const i2 = txt.indexOf('for confirmation');
    expect(i1).toBeLessThan(iPill);
    expect(iPill).toBeLessThan(i2);
  });
});
