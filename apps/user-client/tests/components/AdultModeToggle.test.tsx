// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { AdultModeToggle } from '../../src/components/AdultModeToggle.js';
import { useCurrentChatStore } from '../../src/state/current-chat.store.js';

function renderToggle() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AdultModeToggle />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AdultModeToggle', () => {
  beforeEach(async () => {
    useCurrentChatStore.getState().reset();
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    useCurrentChatStore.getState().reset();
    await _resetClientDataDbForTests();
  });

  it('shows NSFW label and nsfw class by default', async () => {
    renderToggle();
    const btn = await screen.findByRole('button', { name: /adult mode: nsfw/i });
    expect(btn.textContent).toContain('NSFW');
    expect(btn.className).toContain('adult-mode-toggle-nsfw');
  });

  it('shows SFW label and sfw class after toggling', async () => {
    await getClientDataDb().settings.update(1, { adultMode: 'sfw' });
    renderToggle();
    const btn = await screen.findByRole('button', { name: /adult mode: sfw/i });
    expect(btn.textContent).toContain('SFW');
    expect(btn.className).toContain('adult-mode-toggle-sfw');
  });

  it('renders a ⇄ glyph as discoverability hint', async () => {
    renderToggle();
    await screen.findByRole('button');
    expect(screen.getByText('⇄')).toBeInTheDocument();
  });

  it('click toggles the persisted mode', async () => {
    renderToggle();
    const btn = await screen.findByRole('button', { name: /adult mode: nsfw/i });
    fireEvent.click(btn);
    await waitFor(async () => {
      const settings = await getClientDataDb().settings.get(1);
      expect(settings?.adultMode).toBe('sfw');
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /adult mode: sfw/i })).toBeInTheDocument();
    });
  });

  it('hides itself in a chat with a SFW persona (chatPersonaIsAdult === false)', async () => {
    useCurrentChatStore.getState().setChatPersonaIsAdult(false);
    const { container } = renderToggle();
    // Render nothing at all — the pill is removed, not merely greyed.
    await waitFor(() => {
      expect(container.querySelector('.adult-mode-toggle')).toBeNull();
    });
    expect(screen.queryByRole('button', { name: /adult mode/i })).toBeNull();
  });

  it('stays visible in a chat with an adult persona (chatPersonaIsAdult === true)', async () => {
    useCurrentChatStore.getState().setChatPersonaIsAdult(true);
    renderToggle();
    expect(await screen.findByRole('button', { name: /adult mode/i })).toBeInTheDocument();
  });
});
