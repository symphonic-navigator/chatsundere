// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MessageRow } from '../../../src/boot/client-data-db.js';
import {
  MessageControls,
  type ReadDisabledReason,
} from '../../../src/components/chat/MessageControls.js';
import { useCurrentChatStore } from '../../../src/state/current-chat.store.js';

// The Read note carries the same repair link as the cockpit's voice note
// (spec 0.5.0 papercuts, item 2), so it is reachable on touch.

const msg: MessageRow = {
  id: 'm1',
  chatId: 'c1',
  role: 'persona',
  contentBlocks: [{ type: 'text', text: 'hi' }],
  createdAt: 1,
  updatedAt: 1,
  bookmarked: false,
  streamingState: 'complete',
};

const CHAT = '/app/chat/c1';
const enc = encodeURIComponent(CHAT);

function Where(): JSX.Element {
  const l = useLocation();
  return <div data-testid="where">{`${l.pathname}${l.search}`}</div>;
}

function tapRead(reason: ReadDisabledReason) {
  render(
    <MemoryRouter initialEntries={[CHAT]}>
      <Routes>
        <Route
          path="/app/chat/:chatId"
          element={
            <MessageControls
              message={msg}
              onCopy={() => {}}
              onBookmark={() => {}}
              onReadAloud={() => {}}
              readDisabledReason={reason}
            />
          }
        />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: /Read/ }));
}

beforeEach(() => {
  useCurrentChatStore
    .getState()
    .setChatHeader({ personaId: 'p1', name: 'Fable', colour: '#fff', title: '' });
});

afterEach(() => {
  useCurrentChatStore.getState().setChatHeader(null);
});

describe('MessageControls Read note — repair link', () => {
  it("no-voice links to the persona's Font & Voice page, returning to the chat", () => {
    tapRead('no-voice');
    fireEvent.click(screen.getByRole('link', { name: 'Choose a voice' }));
    expect(screen.getByTestId('where').textContent).toBe(
      `/app/persona/p1/font-voice?return=${enc}`,
    );
  });

  it('no-provider links to Settings → Voice, returning to the chat', () => {
    tapRead('no-provider');
    expect(screen.getByText(/set up a voice provider/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Set up voice' }));
    expect(screen.getByTestId('where').textContent).toBe(`/app/settings/voice?return=${enc}`);
  });

  it('nothing-to-read offers no link', () => {
    tapRead('nothing');
    expect(screen.getByText('Nothing to read aloud in this message')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('outside a router the note still shows, without a link', () => {
    render(
      <MessageControls
        message={msg}
        onCopy={() => {}}
        onBookmark={() => {}}
        onReadAloud={() => {}}
        readDisabledReason="no-voice"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Read/ }));
    expect(screen.getByText(/Font & Voice page/)).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
