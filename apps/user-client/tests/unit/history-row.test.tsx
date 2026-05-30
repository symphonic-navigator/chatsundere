// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
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
  createdAt: 0,
  updatedAt: 0,
};
const chat: ChatRow = {
  id: 'c1',
  personaId: 'p1',
  title: 'Topic here',
  resolvedMindspaceId: 'm1',
  createdAt: new Date('2026-05-26T10:00:00').getTime(),
  lastMessageAt: new Date('2026-05-26T11:55:00').getTime(),
  bookmarkedMessageCount: 0,
  draftInput: '',
};

function wrap(ui: React.ReactElement) {
  return (
    <MemoryRouter initialEntries={['/app/history']}>
      <Routes>
        <Route path="/app/history" element={ui} />
        <Route path="/app/chat/:id" element={<div data-testid="chat-mounted" />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('HistoryRow', () => {
  it('renders the title, persona name, and a relative time', () => {
    const { container } = render(
      wrap(<HistoryRow chat={chat} persona={persona} onRename={vi.fn()} onDelete={vi.fn()} />),
    );
    expect(container.textContent).toContain('Topic here');
    expect(container.textContent).toContain('Aurum');
    expect(container.querySelector('.history-row-meta')?.textContent ?? '').not.toBe('');
  });

  it('tapping the row body navigates to the chat', () => {
    const { container, getByTestId } = render(
      wrap(<HistoryRow chat={chat} persona={persona} onRename={vi.fn()} onDelete={vi.fn()} />),
    );
    // biome-ignore lint/style/noNonNullAssertion: selector is guaranteed present when row renders
    fireEvent.click(container.querySelector('[data-row-body]')!);
    expect(getByTestId('chat-mounted')).not.toBeNull();
  });

  it('🖎 tap enters rename mode; Enter commits via onRename', () => {
    const onRename = vi.fn();
    const { container } = render(
      wrap(<HistoryRow chat={chat} persona={persona} onRename={onRename} onDelete={vi.fn()} />),
    );
    // biome-ignore lint/style/noNonNullAssertion: selector is guaranteed present when row renders
    fireEvent.click(container.querySelector('[data-rename-btn]')!);
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'New title' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith('New title');
  });

  it('🗑 tap reveals the confirm tray; Delete fires onDelete', () => {
    const onDelete = vi.fn();
    const { container } = render(
      wrap(<HistoryRow chat={chat} persona={persona} onRename={vi.fn()} onDelete={onDelete} />),
    );
    // biome-ignore lint/style/noNonNullAssertion: selector is guaranteed present when row renders
    fireEvent.click(container.querySelector('[data-delete-btn]')!);
    // biome-ignore lint/style/noNonNullAssertion: confirm button is present after delete-btn click
    fireEvent.click(container.querySelector('[data-confirm]')!);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('Cancel in the tray dismisses without firing onDelete', () => {
    const onDelete = vi.fn();
    const { container } = render(
      wrap(<HistoryRow chat={chat} persona={persona} onRename={vi.fn()} onDelete={onDelete} />),
    );
    // biome-ignore lint/style/noNonNullAssertion: selector is guaranteed present when row renders
    fireEvent.click(container.querySelector('[data-delete-btn]')!);
    // biome-ignore lint/style/noNonNullAssertion: cancel button is present after delete-btn click
    fireEvent.click(container.querySelector('[data-cancel]')!);
    expect(onDelete).not.toHaveBeenCalled();
    expect(container.querySelector('[data-confirm]')).toBeNull();
  });

  it('row body tap is suppressed while the action icons are tapped', () => {
    const { container, queryByTestId } = render(
      wrap(<HistoryRow chat={chat} persona={persona} onRename={vi.fn()} onDelete={vi.fn()} />),
    );
    // biome-ignore lint/style/noNonNullAssertion: selector is guaranteed present when row renders
    fireEvent.click(container.querySelector('[data-rename-btn]')!);
    expect(queryByTestId('chat-mounted')).toBeNull();
  });
});

describe('HistoryRow streaming orb', () => {
  beforeEach(() => {
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
          },
        ],
      ]),
    });
    const { container } = render(
      wrap(<HistoryRow chat={chat} persona={persona} onRename={vi.fn()} onDelete={vi.fn()} />),
    );
    expect(container.querySelector('[data-streaming-orb]')).not.toBeNull();
  });

  it('does NOT show the orb when no live stream', () => {
    const { container } = render(
      wrap(<HistoryRow chat={chat} persona={persona} onRename={vi.fn()} onDelete={vi.fn()} />),
    );
    expect(container.querySelector('[data-streaming-orb]')).toBeNull();
  });
});
