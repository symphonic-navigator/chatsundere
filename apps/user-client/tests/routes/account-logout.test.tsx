// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: vi.fn(() => ({ onHelp: vi.fn(), helpOverlay: null })),
}));

vi.mock('../../src/boot/open-db.js', () => ({ getDb: () => ({}) }));

const mockCloseAndForget = vi.fn();

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
      confirmToken,
      protectCancel,
      cancelCta,
    }: {
      open: boolean;
      onConfirm: () => void;
      onCancel: () => void;
      confirmToken: string;
      protectCancel?: boolean;
      cancelCta?: string;
    }) =>
      open ? (
        <div data-testid="confirm-typed">
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

const mockDeleteLocalAccount = vi.fn().mockResolvedValue(undefined);
vi.mock('@chatsundere/crypto', () => ({
  // biome-ignore lint/suspicious/noExplicitAny: test spy forwarding
  deleteLocalAccount: (...args: any[]) => mockDeleteLocalAccount(...args),
  getLocalAccount: vi.fn(async () => ({ username: 'navigator', created_at: new Date() })),
}));

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

import { LogoutPage } from '../../src/routes/app/account/logout.js';

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

  it('confirming delete calls deleteLocalAccount then closeAndForget then navigates to /onboarding', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /delete all my local data/i }));
    await user.click(screen.getByTestId('confirm-yes'));
    await waitFor(() => expect(mockDeleteLocalAccount).toHaveBeenCalled());
    await waitFor(() => expect(mockCloseAndForget).toHaveBeenCalled());
    expect(screen.getByTestId('location').textContent).toBe('/onboarding');
  });
});
