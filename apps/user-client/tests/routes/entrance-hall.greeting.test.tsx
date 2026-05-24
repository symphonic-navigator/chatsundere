// SPDX-License-Identifier: AGPL-3.0-only

import { useSessionStore } from '@chatsundere/ui-shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { EntranceHall } from '../../src/routes/app/entrance-hall.js';

function renderHall() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <EntranceHall />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Entrance Hall greeting', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
    useSessionStore.setState({ session: null });
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
    useSessionStore.setState({ session: null });
  });

  it('shows the display name when set', async () => {
    useSessionStore.setState({ session: { username: 'chris151' } as never });
    await getClientDataDb().settings.update(1, { displayName: 'Chris Tidesson' });
    renderHall();
    await waitFor(() => expect(screen.getByText('Chris Tidesson')).toBeInTheDocument());
    expect(screen.getByText(/welcome back/i)).toBeInTheDocument();
  });

  it('falls back to the username when display name is empty', async () => {
    useSessionStore.setState({ session: { username: 'chris151' } as never });
    renderHall();
    await waitFor(() => expect(screen.getByText('chris151')).toBeInTheDocument());
  });
});
