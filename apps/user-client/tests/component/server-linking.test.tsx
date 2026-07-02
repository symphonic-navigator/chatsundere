// SPDX-License-Identifier: AGPL-3.0-only
import { useAccountLinkStore } from '@chatsundere/ui-shared';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The linked branch reads linked_at once from the crypto IDB. Stub the DB
// handle and the read so the component can resolve it without a real IDB.
vi.mock('../../src/boot/open-db.js', () => ({
  getDb: vi.fn(() => ({}) as IDBDatabase),
}));

vi.mock('@chatsundere/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatsundere/crypto')>();
  return {
    ...actual,
    getLinkedAccount: vi.fn(async () => ({
      server_user_id: 'user-1',
      base_url: 'https://chatsune.me',
      issuer_label: 'chatsune.me',
      role: 'user' as const,
      linked_at: new Date('2026-01-02T00:00:00Z'),
    })),
  };
});

import { ServerLinkingPage } from '../../src/routes/app/account/server-linking.js';

describe('ServerLinkingPage', () => {
  beforeEach(() => {
    useAccountLinkStore.setState({
      linkStatus: 'local-only',
      baseUrl: null,
      issuerLabel: null,
      role: null,
    });
  });

  it('shows local-only state with the link CTA', () => {
    render(
      <MemoryRouter>
        <ServerLinkingPage />
      </MemoryRouter>,
    );
    expect(screen.getByText('Local-only mode')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Link to server' })).toBeDefined();
  });

  it('shows the linked state with server details', () => {
    useAccountLinkStore.setState({
      linkStatus: 'linked',
      baseUrl: 'https://chatsune.me',
      issuerLabel: 'chatsune.me',
      role: 'user',
    });
    render(
      <MemoryRouter>
        <ServerLinkingPage />
      </MemoryRouter>,
    );
    expect(screen.getByText('Linked to https://chatsune.me')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Link to server' })).toBeNull();
  });
});
