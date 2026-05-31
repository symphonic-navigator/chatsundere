// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { Settings } from '../../src/routes/app/settings.js';

function wrap(node: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Settings route — About Me', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('renders the three accordion card headers', async () => {
    wrap(<Settings />);
    await waitFor(() => {
      expect(screen.getByText(/about me/i)).toBeInTheDocument();
      expect(screen.getByText(/global system prompt/i)).toBeInTheDocument();
      expect(screen.getByText(/upstream providers/i)).toBeInTheDocument();
    });
  });

  it('persists about-me textarea edits after Save is clicked', async () => {
    wrap(<Settings />);
    const card = await screen.findByText(/about me/i);
    fireEvent.click(card);
    const textarea = await screen.findByPlaceholderText(/tell your circle/i);
    fireEvent.change(textarea, { target: { value: 'A new about me' } });
    {
      const db = (await import('../../src/boot/client-data-db.js')).getClientDataDb();
      const row = await db.settings.get(1);
      expect(row?.globalAboutMe).not.toBe('A new about me');
    }
    const saveBtn = screen.getByRole('button', { name: /save settings/i });
    fireEvent.click(saveBtn);
    await waitFor(async () => {
      const db = (await import('../../src/boot/client-data-db.js')).getClientDataDb();
      const row = await db.settings.get(1);
      expect(row?.globalAboutMe).toBe('A new about me');
    });
  });
});

// The Upstream Providers section now lists only *configured* providers (no more
// hard-coded eight-row list). A freshly-seeded device has none, so the section
// shows its warm empty state; the card meta counts configured providers.
describe('Settings route — Upstream Providers', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('shows the warm empty state when no provider is configured', async () => {
    wrap(<Settings />);
    fireEvent.click(await screen.findByText(/upstream providers/i));
    expect(await screen.findByText(/no voice yet/i)).toBeInTheDocument();
  });

  // Configured-only listing + meta counting is unit-tested with mocked data in
  // settings.providers.test.tsx. Here we assert the integration renders the
  // global proxy block and the add affordance through the real Settings page.
  it('renders the global proxy block and an add-provider affordance', async () => {
    wrap(<Settings />);
    fireEvent.click(await screen.findByText(/upstream providers/i));
    expect(await screen.findByText(/server connection at beta/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add provider/i })).toBeInTheDocument();
  });
});
