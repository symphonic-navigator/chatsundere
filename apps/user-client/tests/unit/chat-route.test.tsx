// SPDX-License-Identifier: AGPL-3.0-only
// Routing smoke-test for ChatPage — verifies the component mounts under both
// lazy and chat-mode routes without throwing. Detailed behaviour is covered
// by chat-page.test.tsx.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests } from '../../src/boot/client-data-db';
import { ChatPage } from '../../src/routes/app/chat/chat-page';
import { useCurrentChatStore } from '../../src/state/current-chat.store';

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
