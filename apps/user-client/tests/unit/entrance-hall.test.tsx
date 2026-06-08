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
import { APP_VERSION } from '../../src/lib/version.js';
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
          <Route path="/app/history" element={<div data-testid="history" />} />
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

  it('renders the greeting + the room tiles', async () => {
    wrap('/app');
    await waitFor(() => {
      expect(screen.getByText(/welcome back/i)).toBeInTheDocument();
      expect(screen.getByText('My Circle')).toBeInTheDocument();
      expect(screen.getByText('My Projects')).toBeInTheDocument();
      expect(screen.getByText('My History')).toBeInTheDocument();
      expect(screen.getByText('My Treasury')).toBeInTheDocument();
      expect(screen.getByText('My Knowledge')).toBeInTheDocument();
      expect(screen.getByText('My Integrations')).toBeInTheDocument();
      expect(screen.getByText('My Settings')).toBeInTheDocument();
    });
  });

  it('renders Integrations as a disabled stub and Knowledge as a live tile', async () => {
    wrap('/app');
    const integrations = await screen.findByText('My Integrations');
    expect(integrations.closest('[aria-disabled="true"]')).not.toBeNull();
    const knowledge = await screen.findByText('My Knowledge');
    expect(knowledge.closest('[aria-disabled="true"]')).toBeNull();
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

  it('renders the disabled Projects stub (not History or Treasury)', async () => {
    wrap('/app');
    const projectsTile = await screen.findByText('My Projects');
    expect(projectsTile.closest('[aria-disabled="true"]')).not.toBeNull();
    // History and Treasury are live (not disabled) in the zero-state.
    for (const label of ['My History', 'My Treasury']) {
      const tile = await screen.findByText(label);
      expect(tile.closest('[aria-disabled="true"]')).toBeNull();
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
      canonicalId: null,
      providerId: 'pv',
      modelId: 'm',
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
      draftInput: '',
      libraryIds: [],
    });
    wrap('/app');
    await waitFor(() => {
      expect(screen.getByText(/continue chat/i)).toBeInTheDocument();
    });
  });

  it('activates My History tile when chats exist', async () => {
    const db = getClientDataDb();
    const now = Date.now();
    const aurum = await db.mindspaces.where('displayName').equals('Aurum').first();

    // Seed a persona
    await db.personas.add({
      id: 'p1',
      name: 'Aurum',
      tagline: '',
      colour: '#c9a84c',
      font: 'serif',
      instructions: 'i',
      canonicalId: null,
      providerId: 'pv',
      modelId: 'm',
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
      createdAt: now,
      updatedAt: now,
    });

    // Seed 2 chats
    await db.chats.add({
      id: 'c1',
      personaId: 'p1',
      title: 'Test chat 1',
      resolvedMindspaceId: aurum?.id ?? 'aurum',
      createdAt: now,
      lastMessageAt: now,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });
    await db.chats.add({
      id: 'c2',
      personaId: 'p1',
      title: 'Test chat 2',
      resolvedMindspaceId: aurum?.id ?? 'aurum',
      createdAt: now + 1000,
      lastMessageAt: now + 1000,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });

    wrap('/app');

    // Wait for the My History tile to render and the chat count to appear
    const metaText = await screen.findByText('2 chats');
    expect(metaText).toBeInTheDocument();

    const historyTile = screen.getByText('My History');
    const card = historyTile.closest('[role="button"]');

    // Assert it is NOT disabled
    expect(card).not.toHaveAttribute('aria-disabled', 'true');

    // Assert clicking navigates to /app/history
    fireEvent.click(historyTile);
    await waitFor(() => expect(screen.getByTestId('history')).toBeInTheDocument());
  });

  it('renders the version footer with the current pre-version + sha', async () => {
    await _resetClientDataDbForTests();
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/app']}>
          <EntranceHall />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const footer = document.querySelector('footer');
    expect(footer).not.toBeNull();
    expect(footer?.textContent).toContain(`v${APP_VERSION.version}`);
    expect(footer?.textContent).toContain(`sha ${APP_VERSION.sha}`);
  });
});
