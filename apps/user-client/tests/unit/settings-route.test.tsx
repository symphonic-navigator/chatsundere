// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { useUpsertProvider } from '../../src/data/providers.js';
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
    // Open the About Me accordion
    const card = await screen.findByText(/about me/i);
    fireEvent.click(card);
    const textarea = await screen.findByPlaceholderText(/tell your circle/i);
    fireEvent.change(textarea, { target: { value: 'A new about me' } });
    // Draft must not have persisted yet
    {
      const db = (await import('../../src/boot/client-data-db.js')).getClientDataDb();
      const row = await db.settings.get(1);
      expect(row?.globalAboutMe).not.toBe('A new about me');
    }
    // Click the bottom SaveBar's "Save Settings" button
    const saveBtn = screen.getByRole('button', { name: /save settings/i });
    fireEvent.click(saveBtn);
    await waitFor(async () => {
      const db = (await import('../../src/boot/client-data-db.js')).getClientDataDb();
      const row = await db.settings.get(1);
      expect(row?.globalAboutMe).toBe('A new about me');
    });
  });
});

describe('Settings route — Providers list', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('renders three built-in provider rows (nano-gpt, Novita AI, Ollama Cloud) with status', async () => {
    wrap(<Settings />);
    // Open the Upstream Providers accordion (no longer defaultOpen)
    const providerHeader = await screen.findByText(/upstream providers/i);
    fireEvent.click(providerHeader);
    await waitFor(() => {
      expect(screen.getByText(/nano-gpt/i)).toBeInTheDocument();
      expect(screen.getByText(/novita ai/i)).toBeInTheDocument();
      expect(screen.getByText(/ollama cloud/i)).toBeInTheDocument();
    });
    expect(screen.getAllByText(/not connected/i).length).toBe(3);
  });

  it('counts connected providers in the card meta line', async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const Inner = () => {
      const upsert = useUpsertProvider();
      const seeded = useRef(false);
      useEffect(() => {
        if (seeded.current) return;
        seeded.current = true;
        void upsert.mutateAsync({
          templateId: 'nano-gpt',
          apiKey: { ciphertext: new Uint8Array([1]), nonce: new Uint8Array([2]), version: 1 },
          enabled: true,
        });
      }, [upsert.mutateAsync]);
      return <Settings />;
    };
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <Inner />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText(/1 of 3 connected/i)).toBeInTheDocument());
  });
});
