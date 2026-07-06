// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatRow, PersonaRow } from '../../src/boot/client-data-db';
import { HistoryRow } from '../../src/components/history/HistoryRow';
import { useStreamManagerStore } from '../../src/state/stream-manager.store';

const persona: PersonaRow = {
  id: 'p1',
  name: 'Aurum',
  tagline: '',
  colour: '#c9a84c',
  font: 'serif',
  instructions: '',
  canonicalId: null,
  providerId: '',
  modelId: '',
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
  createdAt: 0,
  updatedAt: 0,
};
const chat: ChatRow = {
  id: 'c1',
  personaId: 'p1',
  title: 'Topic here',
  resolvedMindspaceId: 'm1',
  createdAt: new Date('2026-05-26T10:00:00').getTime(),
  updatedAt: new Date('2026-05-26T10:00:00').getTime(),
  lastMessageAt: new Date('2026-05-26T11:55:00').getTime(),
  bookmarkedMessageCount: 0,
  draftInput: '',
  libraryIds: [],
};

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/app/history']}>
        <Routes>
          <Route path="/app/history" element={ui} />
          <Route path="/app/chat/:chatId" element={<div data-testid="route-chat">chat</div>} />
          <Route path="/app/chat/new" element={<div data-testid="route-new">new</div>} />
          <Route path="/app/persona/:id" element={<div data-testid="route-persona">persona</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('HistoryRow', () => {
  it('renders the persona avatar and the chat title', () => {
    render(
      wrap(<HistoryRow chat={chat} persona={persona} onRename={() => {}} onDelete={() => {}} />),
    );
    expect(screen.getByLabelText('Aurum avatar')).toBeTruthy();
    expect(screen.getByText('Topic here')).toBeTruthy();
  });

  it('shows the NSFW badge only for an adult persona', () => {
    const { rerender } = render(
      wrap(<HistoryRow chat={chat} persona={persona} onRename={() => {}} onDelete={() => {}} />),
    );
    expect(screen.queryByText('NSFW')).toBeNull();
    rerender(
      wrap(
        <HistoryRow
          chat={chat}
          persona={{ ...persona, adultPersona: true }}
          onRename={() => {}}
          onDelete={() => {}}
        />,
      ),
    );
    expect(screen.getByText('NSFW')).toBeTruthy();
  });

  it('opens the chat when the row body is tapped', () => {
    render(
      wrap(<HistoryRow chat={chat} persona={persona} onRename={() => {}} onDelete={() => {}} />),
    );
    fireEvent.click(screen.getByText('Topic here'));
    expect(screen.getByTestId('route-chat')).toBeTruthy();
  });

  it('lists the four actions in the overflow menu', () => {
    render(
      wrap(<HistoryRow chat={chat} persona={persona} onRename={() => {}} onDelete={() => {}} />),
    );
    fireEvent.click(screen.getByLabelText('Chat actions'));
    expect(screen.getByText('Rename')).toBeTruthy();
    expect(screen.getByText('New chat with this persona')).toBeTruthy();
    expect(screen.getByText('Go to persona')).toBeTruthy();
    expect(screen.getByText('Delete')).toBeTruthy();
  });

  it('enters inline rename mode from the menu', () => {
    render(
      wrap(<HistoryRow chat={chat} persona={persona} onRename={() => {}} onDelete={() => {}} />),
    );
    fireEvent.click(screen.getByLabelText('Chat actions'));
    fireEvent.click(screen.getByText('Rename'));
    expect(screen.getByDisplayValue('Topic here')).toBeTruthy();
  });

  it('opens a confirm dialog from the menu and deletes on confirm', () => {
    const onDelete = vi.fn();
    render(
      wrap(<HistoryRow chat={chat} persona={persona} onRename={() => {}} onDelete={onDelete} />),
    );
    fireEvent.click(screen.getByLabelText('Chat actions'));
    fireEvent.click(screen.getByText('Delete'));
    expect(screen.getByText('Delete this chat?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});

describe('HistoryRow streaming orb', () => {
  afterEach(() => {
    useStreamManagerStore.setState({ streams: new Map() });
  });

  it("shows the streaming orb when the row's persona has a live stream", () => {
    useStreamManagerStore.setState({
      streams: new Map([
        [
          'cX',
          {
            chatId: 'cX',
            personaId: 'p1',
            draftMessageId: 'd1',
            controller: new AbortController(),
            status: 'streaming',
            contentBuffer: [],
            pillBuffer: [],
            startedAt: 0,
            reusedDraft: false,
          },
        ],
      ]),
    });
    const { container } = render(
      wrap(<HistoryRow chat={chat} persona={persona} onRename={() => {}} onDelete={() => {}} />),
    );
    expect(container.querySelector('[data-streaming-orb]')).not.toBeNull();
  });
});
