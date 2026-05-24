// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  getLocalAccount: vi.fn(async () => ({
    username: 'chris151',
    created_at: new Date('2026-05-01'),
  })),
  listLocalBiometric: vi.fn(async () => []),
  regenerateRecoveryKey: vi.fn(),
  deletePasskeyCredential: vi.fn(),
}));

vi.mock('@chatsundere/ui-shared', () => ({
  ConfirmTyped: () => null,
  InlineMarker: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  useSessionStore: Object.assign(
    vi.fn(() => ({ mk: new Uint8Array(32) })),
    {
      getState: () => ({ mk: new Uint8Array(32), closeAndForget: vi.fn() }),
    },
  ),
}));

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

import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { AccountPage } from '../../src/routes/app/account.js';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AccountPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * AccountPage renders the four sections inside AccordionCards which
 * default to collapsed. The Display Name input lives inside the
 * "Account" accordion — open it so the input becomes queryable.
 */
async function openAccountAccordion() {
  const header = await screen.findByText('Account');
  fireEvent.click(header);
}

describe('My Account display-name (Save & Back model)', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('renders a Display Name input with the current displayName prefilled', async () => {
    await getClientDataDb().settings.update(1, { displayName: 'Chris Tidesson' });
    renderPage();
    await openAccountAccordion();
    const input = await screen.findByLabelText<HTMLInputElement>(/display name/i);
    expect(input.value).toBe('Chris Tidesson');
    expect(input.maxLength).toBe(60);
  });

  it('Save & Back becomes enabled when the draft changes; click persists trimmed displayName', async () => {
    renderPage();
    await openAccountAccordion();
    const input = await screen.findByLabelText<HTMLInputElement>(/display name/i);
    fireEvent.change(input, { target: { value: '  Chris Tidesson  ' } });
    const saveBtn = await screen.findByRole('button', { name: /save & back/i });
    expect(saveBtn).not.toBeDisabled();
    fireEvent.click(saveBtn);
    await waitFor(async () => {
      const settings = await getClientDataDb().settings.get(1);
      expect(settings?.displayName).toBe('Chris Tidesson');
    });
  });

  it('does NOT persist on blur (only Save & Back persists)', async () => {
    renderPage();
    await openAccountAccordion();
    const input = await screen.findByLabelText<HTMLInputElement>(/display name/i);
    fireEvent.change(input, { target: { value: 'should-not-persist-on-blur' } });
    fireEvent.blur(input);
    // Wait a tick to give any stray async work a chance to fire.
    await new Promise((r) => setTimeout(r, 50));
    const settings = await getClientDataDb().settings.get(1);
    expect(settings?.displayName).toBe('');
  });
});
