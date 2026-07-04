// SPDX-License-Identifier: AGPL-3.0-only

import { useAccountLinkStore } from '@chatsundere/ui-shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The linked branch reads linked_at once from the crypto IDB — stub the DB
// handle and the read so the component can resolve it without a real IDB
// (mirrors tests/component/server-linking.test.tsx).
vi.mock('../../src/boot/open-db.js', () => ({
  getDb: vi.fn(() => ({}) as IDBDatabase),
}));

vi.mock('@chatsundere/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatsundere/crypto')>();
  return {
    ...actual,
    getLinkedAccount: vi.fn(async () => ({
      server_user_id: 'user-1',
      base_url: 'https://chatsundere.example.org',
      issuer_label: 'chatsundere.example.org',
      role: 'user' as const,
      linked_at: new Date('2026-01-02T00:00:00Z'),
    })),
  };
});

vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: vi.fn(() => ({ onHelp: vi.fn(), helpOverlay: null })),
}));

const decoupleSpy = vi.hoisted(() => vi.fn());
vi.mock('../../src/lib/decouple-device.js', () => ({ decoupleDevice: decoupleSpy }));

const logoutSpy = vi.hoisted(() => vi.fn());
vi.mock('../../src/lib/auth-logout.js', () => ({ logoutCurrentSession: logoutSpy }));

import { ServerLinkingPage } from '../../src/routes/app/account/server-linking.js';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/app/account/server-linking']}>
      <Routes>
        <Route path="/app/account/server-linking" element={<ServerLinkingPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function lastButton(name: RegExp) {
  const matches = screen.getAllByRole('button', { name });
  const last = matches.at(-1);
  if (!last) throw new Error(`no button matching ${name}`);
  return last;
}

const LINKED_BASE_URL = 'https://chatsundere.example.org';

describe('ServerLinkingPage — decouple this device', () => {
  beforeEach(() => {
    decoupleSpy.mockReset();
    logoutSpy.mockReset();
    useAccountLinkStore.setState({
      linkStatus: 'linked',
      baseUrl: LINKED_BASE_URL,
      issuerLabel: 'chatsundere.example.org',
      role: 'user',
    });
  });

  it('renders the "End this link" section with the confirm disabled until "decouple" is typed', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByText('End this link')).toBeInTheDocument();

    const confirm = lastButton(/decouple this device/i);
    expect(confirm).toBeDisabled();

    await user.type(screen.getByRole('textbox', { name: /decouple/i }), 'decouple');
    expect(confirm).toBeEnabled();
  });

  it('names what is different from signing out', () => {
    renderPage();
    expect(screen.getByText(/different from signing out/i)).toBeInTheDocument();
    expect(screen.getByText(/your other devices keep their copies/i)).toBeInTheDocument();
  });

  it('calls decoupleDevice on confirm and shows the reassuring copy once the store flips local-only', async () => {
    const user = userEvent.setup();
    decoupleSpy.mockImplementation(async () => {
      useAccountLinkStore.getState().setLocalOnly();
      return { sessionRevoked: true };
    });
    renderPage();

    await user.type(screen.getByRole('textbox', { name: /decouple/i }), 'decouple');
    await user.click(lastButton(/decouple this device/i));

    expect(decoupleSpy).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/your data is still here/i)).toBeInTheDocument();
    // Not a bare terminal "done" — the copy stays reassuring and specific.
    expect(screen.queryByText(/^done$/i)).not.toBeInTheDocument();
  });

  it('shows a constructive retry note when the server session could not be revoked', async () => {
    const user = userEvent.setup();
    decoupleSpy.mockImplementation(async () => {
      useAccountLinkStore.getState().setLocalOnly();
      return { sessionRevoked: false };
    });
    renderPage();

    await user.type(screen.getByRole('textbox', { name: /decouple/i }), 'decouple');
    await user.click(lastButton(/decouple this device/i));

    expect(await screen.findByText(/couldn.t reach the server/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('retries the revoke alone with the captured base URL, and shows the success state on true', async () => {
    // Proves the fix for the dead-retry defect: Retry must call
    // logoutCurrentSession directly (not re-run decoupleDevice, which is a
    // structural no-op the second time since the store's baseUrl is already
    // null) — and it must use the base URL captured BEFORE the first
    // decoupleDevice() cleared the store.
    const user = userEvent.setup();
    decoupleSpy.mockImplementation(async () => {
      useAccountLinkStore.getState().setLocalOnly();
      return { sessionRevoked: false };
    });
    logoutSpy.mockResolvedValue(true);
    renderPage();

    await user.type(screen.getByRole('textbox', { name: /decouple/i }), 'decouple');
    await user.click(lastButton(/decouple this device/i));
    expect(await screen.findByText(/couldn.t reach the server/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /retry/i }));

    expect(decoupleSpy).toHaveBeenCalledTimes(1);
    expect(logoutSpy).toHaveBeenCalledTimes(1);
    expect(logoutSpy).toHaveBeenCalledWith(LINKED_BASE_URL);
    expect(await screen.findByText(/your data is still here/i)).toBeInTheDocument();
    expect(screen.queryByText(/couldn.t reach the server/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });
});
