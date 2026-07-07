// SPDX-License-Identifier: AGPL-3.0-only

import { useAccountLinkStore, useConnectivityStore, useSessionStore } from '@chatsundere/ui-shared';
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
import { getSyncState } from '../../src/sync/watermark.js';

/**
 * Pre-test analysis #9 — while the first post-link sync is still pending
 * (linked, online, `lastSyncAt === null`), the Entrance Hall must show the calm
 * FirstSyncCard instead of the SetupCard: nudging a freshly recovered/paired
 * user to "create your first companion" while their vault is on its way invites
 * a duplicate persona.
 */

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

async function stampLastSyncAt(value: number | null): Promise<void> {
  await getSyncState();
  await getClientDataDb().syncState.update('state', { lastSyncAt: value });
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  useSessionStore.setState({ session: { username: 'chris151' } as never });
});

afterEach(async () => {
  await _resetClientDataDbForTests();
  useSessionStore.setState({ session: null });
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
});

describe('Entrance Hall first-sync gate (pre-test analysis #9)', () => {
  it('shows the FirstSyncCard instead of the SetupCard while the first sync is pending', async () => {
    useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
    useConnectivityStore.setState({ state: { kind: 'linked_online' } });
    renderHall();
    await waitFor(() => expect(screen.getByText('Syncing your account…')).toBeInTheDocument());
    expect(screen.getByText('Your data is on its way to this device.')).toBeInTheDocument();
    expect(screen.queryByText(/create your first companion/i)).not.toBeInTheDocument();
  });

  it('shows the SetupCard once the first sync has completed', async () => {
    useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
    useConnectivityStore.setState({ state: { kind: 'linked_online' } });
    await stampLastSyncAt(Date.now());
    renderHall();
    await waitFor(() =>
      expect(screen.getByText(/create your first companion/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText('Syncing your account…')).not.toBeInTheDocument();
  });

  it('shows the SetupCard for a local-only user regardless of sync state', async () => {
    useAccountLinkStore.setState({ linkStatus: 'local-only', baseUrl: null });
    renderHall();
    await waitFor(() =>
      expect(screen.getByText(/create your first companion/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText('Syncing your account…')).not.toBeInTheDocument();
  });

  it('falls back to the SetupCard when the server is not reachable (the cue could never resolve)', async () => {
    useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
    useConnectivityStore.setState({ state: { kind: 'server_unreachable' } });
    renderHall();
    await waitFor(() =>
      expect(screen.getByText(/create your first companion/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText('Syncing your account…')).not.toBeInTheDocument();
  });
});
