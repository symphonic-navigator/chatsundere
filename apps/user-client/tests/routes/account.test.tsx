// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@chatsundere/crypto', () => ({
  CryptoError: class CryptoError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  changeUsername: vi.fn(),
  deleteLocalAccount: vi.fn(),
  getLocalAccount: vi.fn(async () => ({ username: 'liz', created_at: new Date('2026-01-01') })),
  listLocalBiometric: vi.fn(async () => []),
  regenerateRecoveryKey: vi.fn(),
  deletePasskeyCredential: vi.fn(),
}));

vi.mock('@chatsundere/ui-shared', async () => {
  return {
    ConfirmTyped: () => null,
    InlineMarker: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    useSessionStore: Object.assign(
      vi.fn(() => ({ mk: new Uint8Array(32) })),
      {
        getState: () => ({ mk: new Uint8Array(32), closeAndForget: vi.fn() }),
      },
    ),
  };
});

vi.mock('../../src/boot/open-db.js', () => ({
  getDb: () => ({}),
}));

vi.mock('../../src/lib/webauthn-availability.js', () => ({
  isWebAuthnAvailable: () => true,
}));

vi.mock('../../src/lib/webauthn.js', () => ({
  registerLocalBiometric: vi.fn(),
  PrfRequiredError: class extends Error {},
}));

vi.mock('../../src/lib/passkey-management.js', () => ({
  renamePasskey: vi.fn(),
}));

vi.mock('../../src/version.js', () => ({ APP_VERSION: '0.0.0-test' }));

import { AccountPage } from '../../src/routes/app/account.js';

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AccountPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AccountPage', () => {
  it('renders the accordion sections in the expected order', () => {
    setup();
    const headers = Array.from(
      document.querySelectorAll('[data-accordion-card] [data-accordion-label]'),
    ).map((n) => n.textContent?.trim() ?? '');
    // Developer tools is dev-only (import.meta.env.DEV); vitest sets DEV=true
    // so it appears here. Production builds strip it.
    expect(headers).toEqual([
      'Account',
      'Auth Methods',
      'Server Linking',
      'About',
      'Developer tools',
    ]);
  });

  it('renders the EditorTopbar with "My Account" title and a Save & Back button (disabled until dirty)', () => {
    setup();
    expect(screen.getByText('My Account')).toBeInTheDocument();
    const saveBtn = screen.getByRole('button', { name: /save & back/i });
    expect(saveBtn).toBeDisabled();
  });
});
