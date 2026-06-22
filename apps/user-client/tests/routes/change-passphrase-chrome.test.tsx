// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// ─── Module mocks ─────────────────────────────────────────────────────────────
// Must come before the dynamic import of the component below.

vi.mock('@chatsundere/crypto', () => ({
  CryptoError: class CryptoError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'CryptoError';
    }
  },
  changePassphraseLocalOnly: vi.fn(async () => undefined),
  changePassphraseLinkedOnline: vi.fn(async () => undefined),
  deriveIntegrityKey: vi.fn(async () => undefined),
  deriveOpaqueAmk: vi.fn(async () => undefined),
  addIntegrityHmac: vi.fn(async () => undefined),
  aeadEncrypt: vi.fn(async () => undefined),
  opaqueRegistrationStart: vi.fn(async () => undefined),
  opaqueRegistrationFinish: vi.fn(async () => undefined),
  toBase64Url: vi.fn(() => ''),
  getLinkedAccount: vi.fn(async () => null),
  getLocalAccount: vi.fn(async () => null),
}));

vi.mock('../../src/boot/open-db.js', () => ({ getDb: () => ({}) }));

vi.mock('@chatsundere/ui-shared', () => ({
  useConnectivityStore: Object.assign(
    vi.fn((selector: (s: { state: { kind: string } }) => unknown) =>
      selector({ state: { kind: 'local_online' } }),
    ),
    { getState: () => ({ state: { kind: 'local_online' } }) },
  ),
  useSessionStore: Object.assign(
    vi.fn((selector: (s: { session: { accessToken: string } | null; mk: null }) => unknown) =>
      selector({ session: { accessToken: 'tok' }, mk: null }),
    ),
    { getState: () => ({ session: { accessToken: 'tok' }, mk: null }) },
  ),
}));

vi.mock('../../src/lib/server-client.js', () => ({
  httpServerClient: {
    passphraseChangeStart: vi.fn(async () => ({ registration_response: '', session_id: '' })),
    passphraseChangeFinish: vi.fn(async () => undefined),
  },
}));

vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: vi.fn(() => ({ onHelp: vi.fn(), helpOverlay: null })),
}));

vi.mock('../../src/content/help/index.js', () => ({
  HELP_DOCS: {
    'change-passphrase': { title: 'Change passphrase — help', markdown: 'help text' },
  },
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}));

import { ChangePassphrase } from '../../src/routes/change-passphrase.js';

function renderPage() {
  return render(
    <MemoryRouter>
      <ChangePassphrase />
    </MemoryRouter>,
  );
}

describe('ChangePassphrase chrome', () => {
  it('renders the "My Account" breadcrumb linking to /app/account', () => {
    renderPage();
    expect(screen.getByText('My Account')).toBeInTheDocument();
  });

  it('renders the "Change passphrase" breadcrumb', () => {
    renderPage();
    expect(screen.getByText('Change passphrase')).toBeInTheDocument();
  });

  it('renders a back control', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });

  it('renders a ? help affordance', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /help/i })).toBeInTheDocument();
  });

  it('still renders the new-passphrase field', () => {
    renderPage();
    expect(screen.getByLabelText('New passphrase')).toBeInTheDocument();
  });

  it('still renders the confirm-passphrase field', () => {
    renderPage();
    expect(screen.getByLabelText('Confirm new passphrase')).toBeInTheDocument();
  });
});
