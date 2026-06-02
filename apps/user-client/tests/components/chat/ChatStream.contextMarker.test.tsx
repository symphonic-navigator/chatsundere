// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { expect, it } from 'vitest';
import type { MessageRow, PersonaRow } from '../../../src/boot/client-data-db.js';
import { ChatStream } from '../../../src/components/chat/ChatStream.js';

function renderWithQuery(element: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{element}</QueryClientProvider>);
}

function msg(id: string, createdAt: number, text: string): MessageRow {
  return {
    id,
    chatId: 'c',
    role: 'user',
    contentBlocks: [{ type: 'text', text }],
    createdAt,
    bookmarked: false,
    streamingState: 'complete',
  };
}

it('shows the memory marker when oldest messages fall out of the window', () => {
  // three ~50-token messages, budget 120, system 40 -> only newest ~1 fits
  const messages = [
    msg('a', 1, 'x'.repeat(200)),
    msg('b', 2, 'x'.repeat(200)),
    msg('c', 3, 'x'.repeat(200)),
  ];
  renderWithQuery(
    <ChatStream
      chatId="c"
      messages={messages}
      pills={[]}
      persona={{ name: 'A', colour: '#fff', font: 'serif' } as unknown as PersonaRow}
      displayName="Chris"
      streamHandle={null}
      contextBudget={120}
      systemTokens={40}
    />,
  );
  expect(screen.getByText(/out of the model's memory/i)).toBeInTheDocument();
});

it('shows no marker when everything fits', () => {
  const messages = [msg('a', 1, 'hi'), msg('b', 2, 'there')];
  renderWithQuery(
    <ChatStream
      chatId="c"
      messages={messages}
      pills={[]}
      persona={{ name: 'A', colour: '#fff', font: 'serif' } as unknown as PersonaRow}
      displayName="Chris"
      streamHandle={null}
      contextBudget={100_000}
      systemTokens={10}
    />,
  );
  expect(screen.queryByText(/out of the model's memory/i)).not.toBeInTheDocument();
});
