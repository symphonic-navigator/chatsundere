// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { EntranceHall } from '../../src/routes/app/entrance-hall.js';

function wrap(initial: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/app" element={<EntranceHall />} />
          <Route path="/app/circle" element={<div data-testid="circle" />} />
          <Route path="/app/settings" element={<div data-testid="settings" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EntranceHall', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('renders the greeting + five room tiles', async () => {
    wrap('/app');
    await waitFor(() => {
      expect(screen.getByText(/welcome back/i)).toBeInTheDocument();
      expect(screen.getByText('My Circle')).toBeInTheDocument();
      expect(screen.getByText('My Projects')).toBeInTheDocument();
      expect(screen.getByText('My History')).toBeInTheDocument();
      expect(screen.getByText('My Treasury')).toBeInTheDocument();
      expect(screen.getByText('My Settings')).toBeInTheDocument();
    });
  });

  it('does NOT render a "My Bookmarks" tile', async () => {
    wrap('/app');
    await waitFor(() => {
      expect(screen.queryByText('My Bookmarks')).toBeNull();
    });
  });

  it('hides the Continue-Card in the zero-state', async () => {
    wrap('/app');
    await waitFor(() => {
      expect(screen.queryByText(/continue chat/i)).toBeNull();
    });
  });

  it('renders disabled-stubs for Projects / History / Treasury', async () => {
    wrap('/app');
    for (const label of ['My Projects', 'My History', 'My Treasury']) {
      const tile = await screen.findByText(label);
      const card = tile.closest('[aria-disabled="true"]');
      expect(card).not.toBeNull();
    }
  });

  it('navigates to /app/circle when My Circle is tapped', async () => {
    wrap('/app');
    fireEvent.click(await screen.findByText('My Circle'));
    await waitFor(() => expect(screen.getByTestId('circle')).toBeInTheDocument());
  });

  it('navigates to /app/settings when My Settings is tapped', async () => {
    wrap('/app');
    fireEvent.click(await screen.findByText('My Settings'));
    await waitFor(() => expect(screen.getByTestId('settings')).toBeInTheDocument());
  });

  it('renders the Continue-Card when at least one chat exists', async () => {
    const db = getClientDataDb();
    const now = Date.now();
    const aurum = await db.mindspaces.where('displayName').equals('Aurum').first();
    await db.personas.add({
      id: 'p1',
      name: 'Aurum',
      tagline: '',
      colour: '#c9a84c',
      font: 'serif',
      instructions: 'i',
      providerId: 'pv',
      modelId: 'm',
      mindspaceId: null,
      aboutMeOverride: null,
      textureOverride: null,
      temperature: 0.85,
      adultPersona: false,
      createdAt: now,
      updatedAt: now,
    });
    await db.chats.add({
      id: 'c1',
      personaId: 'p1',
      title: 'Test chat',
      resolvedMindspaceId: aurum?.id ?? 'aurum',
      createdAt: now,
      lastMessageAt: now,
      bookmarkedMessageCount: 0,
    });
    wrap('/app');
    await waitFor(() => {
      expect(screen.getByText(/continue chat/i)).toBeInTheDocument();
    });
  });
});
