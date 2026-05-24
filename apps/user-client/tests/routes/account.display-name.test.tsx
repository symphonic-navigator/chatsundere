// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the crypto-DB-backed account load so the AccountSection reaches the
// "ready" state. The Display Name block lives inside that ready branch but
// reads from the (real) client-data DB seeded in beforeEach below.
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
}));

vi.mock('@chatsundere/ui-shared', () => ({
  ConfirmTyped: () => null,
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

import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { AccountSection } from '../../src/routes/app/account-sections/account-section.js';

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AccountSection />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AccountSection display-name input', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('renders a Display Name input with the current displayName prefilled', async () => {
    await getClientDataDb().settings.update(1, { displayName: 'Chris Tidesson' });
    renderSection();
    const input = await screen.findByLabelText<HTMLInputElement>(/display name/i);
    expect(input.value).toBe('Chris Tidesson');
    expect(input.maxLength).toBe(60);
  });

  it('persists a trimmed displayName on blur', async () => {
    renderSection();
    const input = await screen.findByLabelText<HTMLInputElement>(/display name/i);
    fireEvent.change(input, { target: { value: '  Chris Tidesson  ' } });
    fireEvent.blur(input);
    await waitFor(async () => {
      const settings = await getClientDataDb().settings.get(1);
      expect(settings?.displayName).toBe('Chris Tidesson');
    });
  });

  it('normalises whitespace-only input to empty string on blur', async () => {
    await getClientDataDb().settings.update(1, { displayName: 'something' });
    renderSection();
    const input = await screen.findByLabelText<HTMLInputElement>(/display name/i);
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    await waitFor(async () => {
      const settings = await getClientDataDb().settings.get(1);
      expect(settings?.displayName).toBe('');
    });
  });
});
