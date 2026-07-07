// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../../src/lib/fetch.js';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: vi.fn(() => ({ onHelp: vi.fn(), helpOverlay: null })),
}));

const mockCloseAndForget = vi.fn();

// The full device wipe — the page delegates the entire local erase to it.
const mockWipeDevice = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/lib/wipe-device.js', () => ({
  wipeDevice: () => mockWipeDevice(),
}));

const mockDeleteMe = vi.fn();
vi.mock('../../src/lib/server-client.js', () => ({
  httpServerClient: {
    deleteMe: (...args: unknown[]) => mockDeleteMe(...args),
  },
}));

vi.mock('@chatsundere/ui-shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatsundere/ui-shared')>();
  return {
    ...actual,
    useSessionStore: Object.assign(
      vi.fn((selector: (s: { session: { username: string } | null }) => unknown) =>
        selector({ session: { username: 'navigator' } }),
      ),
      {
        getState: () => ({
          session: { username: 'navigator' },
          closeAndForget: mockCloseAndForget,
        }),
      },
    ),
    // ConfirmTyped — render a controlled stub so we don't need jsdom showModal.
    ConfirmTyped: ({
      open,
      onConfirm,
      onCancel,
      title,
      body,
      confirmToken,
      protectCancel,
      cancelCta,
    }: {
      open: boolean;
      onConfirm: () => void;
      onCancel: () => void;
      title: string;
      body: string;
      confirmToken: string;
      protectCancel?: boolean;
      cancelCta?: string;
    }) =>
      open ? (
        <div data-testid="confirm-typed">
          <span data-testid="confirm-title">{title}</span>
          <span data-testid="confirm-body">{body}</span>
          <span data-testid="confirm-token">{confirmToken}</span>
          {protectCancel && <span data-testid="protect-cancel-flag" />}
          <button type="button" onClick={onConfirm} data-testid="confirm-yes">
            Confirm
          </button>
          <button type="button" onClick={onCancel} data-testid="confirm-no">
            {cancelCta ?? 'No'}
          </button>
        </div>
      ) : null,
  };
});

import { useAccountLinkStore } from '@chatsundere/ui-shared';
import { LogoutPage } from '../../src/routes/app/account/logout.js';

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/app/account/logout']}>
      <Routes>
        <Route path="/app/account/logout" element={<LogoutPage />} />
        <Route path="/login" element={<LocationProbe />} />
        <Route path="/onboarding" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LogoutPage', () => {
  beforeEach(() => {
    mockCloseAndForget.mockClear();
    mockWipeDevice.mockClear();
    mockWipeDevice.mockResolvedValue(undefined);
    mockDeleteMe.mockReset();
    useAccountLinkStore.setState({ linkStatus: 'local-only', baseUrl: null, role: null });
  });

  it('renders the breadcrumb crumbs: My Account / Logout', () => {
    renderPage();
    expect(screen.getByText('My Account')).toBeInTheDocument();
    expect(screen.getByText('Logout')).toBeInTheDocument();
  });

  it('Sign out calls closeAndForget then navigates to /login', async () => {
    const user = userEvent.setup();
    renderPage();
    const signOutBtn = screen.getByRole('button', { name: /sign out/i });
    await user.click(signOutBtn);
    expect(mockCloseAndForget).toHaveBeenCalled();
    expect(screen.getByTestId('location').textContent).toBe('/login');
  });

  it('Delete button opens ConfirmTyped with username as confirmToken', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(screen.queryByTestId('confirm-typed')).toBeNull();
    const deleteBtn = screen.getByRole('button', { name: /delete all my local data/i });
    await user.click(deleteBtn);
    expect(screen.getByTestId('confirm-typed')).toBeInTheDocument();
    expect(screen.getByTestId('confirm-token').textContent).toBe('navigator');
  });

  it('ConfirmTyped receives protectCancel (the cancel button is gold-protected)', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /delete all my local data/i }));
    expect(screen.getByTestId('protect-cancel-flag')).toBeInTheDocument();
  });

  it('confirming local delete runs the full device wipe', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /delete all my local data/i }));
    await user.click(screen.getByTestId('confirm-yes'));
    await waitFor(() => expect(mockWipeDevice).toHaveBeenCalledTimes(1));
    expect(mockDeleteMe).not.toHaveBeenCalled();
  });

  it('unlinked: no "everywhere" button; confirm body promises no recovery', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(screen.queryByRole('button', { name: /delete my account everywhere/i })).toBeNull();
    await user.click(screen.getByRole('button', { name: /delete all my local data/i }));
    expect(screen.getByTestId('confirm-body').textContent).toMatch(/no recovery/i);
  });

  it('linked: local-delete copy says the server copy stays', async () => {
    useAccountLinkStore.setState({
      linkStatus: 'linked',
      baseUrl: 'https://srv.example',
      role: 'user',
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /delete all my local data/i }));
    expect(screen.getByTestId('confirm-body').textContent).toMatch(/stay on the server/i);
  });

  it('linked: "everywhere" deletes the server account first, then wipes the device', async () => {
    useAccountLinkStore.setState({
      linkStatus: 'linked',
      baseUrl: 'https://srv.example',
      role: 'user',
    });
    mockDeleteMe.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /delete my account everywhere/i }));
    await user.click(screen.getByTestId('confirm-yes'));
    await waitFor(() => expect(mockWipeDevice).toHaveBeenCalledTimes(1));
    expect(mockDeleteMe).toHaveBeenCalledWith('https://srv.example', '');
    // Server-first: the wipe only ran after deleteMe resolved.
    expect(mockDeleteMe.mock.invocationCallOrder[0]).toBeLessThan(
      mockWipeDevice.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('linked: server unreachable → honest error, NOTHING deleted', async () => {
    useAccountLinkStore.setState({
      linkStatus: 'linked',
      baseUrl: 'https://srv.example',
      role: 'user',
    });
    mockDeleteMe.mockRejectedValue(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /delete my account everywhere/i }));
    await user.click(screen.getByTestId('confirm-yes'));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/nothing was deleted/i),
    );
    expect(mockWipeDevice).not.toHaveBeenCalled();
  });

  it('linked: server 403 → constructive transfer-primary error', async () => {
    useAccountLinkStore.setState({
      linkStatus: 'linked',
      baseUrl: 'https://srv.example',
      role: 'user',
    });
    mockDeleteMe.mockRejectedValue(new HttpError(403, 'forbidden', '403 Forbidden'));
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /delete my account everywhere/i }));
    await user.click(screen.getByTestId('confirm-yes'));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/transfer your primary-admin role/i),
    );
    expect(mockWipeDevice).not.toHaveBeenCalled();
  });

  it('linked primary admin: "everywhere" disabled with the constructive reason', async () => {
    useAccountLinkStore.setState({
      linkStatus: 'linked',
      baseUrl: 'https://srv.example',
      role: 'primary_admin',
    });
    renderPage();
    const btn = screen.getByRole('button', { name: /delete my account everywhere/i });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/transfer the role to another admin/i)).toBeInTheDocument();
  });
});
