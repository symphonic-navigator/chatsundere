import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
// SPDX-License-Identifier: AGPL-3.0-only
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockLoginLocalWithPassphrase = vi.fn();
const mockOtherClientsOpen = vi.fn();

vi.mock('@chatsundere/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatsundere/crypto')>();
  return {
    ...actual,
    getLocalAccount: async () => ({ username: 'chris' }),
    listLocalBiometric: async () => [],
    loginLocalWithPassphrase: (args: unknown) => mockLoginLocalWithPassphrase(args),
  };
});
vi.mock('../../src/boot/open-db.js', () => ({ getDb: vi.fn(() => ({})) }));
vi.mock('../../src/boot/activate-session.js', () => ({
  activateSession: vi.fn(async () => undefined),
}));
vi.mock('../../src/lib/server-client.js', () => ({ httpServerClient: {} }));
vi.mock('../../src/data/settings.js', () => ({
  useDisplayName: (fallback?: string | null) => fallback ?? '—',
}));
vi.mock('../../src/lib/webauthn-availability.js', () => ({ isWebAuthnAvailable: () => false }));
vi.mock('../../src/sw/presence.js', () => ({
  otherClientsOpen: () => mockOtherClientsOpen(),
}));

import { CryptoError } from '@chatsundere/crypto';
import { useAccountLinkStore, useSessionStore } from '@chatsundere/ui-shared';
import { Login } from '../../src/routes/login/index.js';
import { _resetAppUpdateForTests, useAppUpdateStore } from '../../src/sw/app-update.store.js';
import {
  POST_UPDATE_RETURN_KEY,
  _resetPostUpdateReturnForTests,
} from '../../src/sw/post-update-return.js';

function Landed(): JSX.Element {
  const loc = useLocation();
  return <div data-testid="landed">{`${loc.pathname}${loc.search}`}</div>;
}

function renderLogin(path = '/login') {
  return render(
    <StrictMode>
      <MemoryRouter
        initialEntries={[path]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/app/*" element={<Landed />} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  );
}

async function passphraseInput(): Promise<HTMLElement> {
  return await screen.findByLabelText(/^passphrase$/i, { selector: 'input' });
}

async function unlock(passphrase = 'correct horse') {
  fireEvent.change(await passphraseInput(), { target: { value: passphrase } });
  fireEvent.click(screen.getByRole('button', { name: /^unlock$/i }));
}

let apply: ReturnType<typeof vi.fn<() => boolean>>;

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem('splashShown', '1');
  _resetPostUpdateReturnForTests();
  _resetAppUpdateForTests();
  apply = vi.fn(() => true);
  useAppUpdateStore.getState().bind({ apply, check: async () => 'none', peek: () => 'none' });
  useSessionStore.setState({ session: null });
  useAccountLinkStore.setState({ linkStatus: 'local-only' });
  mockLoginLocalWithPassphrase.mockReset().mockResolvedValue({ session: {}, mk: {} });
  mockOtherClientsOpen.mockReset().mockResolvedValue(true);
});

describe('Login × app update (spec 2026-09-26 §2.4, §3.3)', () => {
  it('resumes the post-update return path once, even under StrictMode', async () => {
    sessionStorage.setItem(POST_UPDATE_RETURN_KEY, '/app/chat/c1');
    renderLogin();
    expect(sessionStorage.getItem(POST_UPDATE_RETURN_KEY)).toBeNull();
    await unlock();
    expect(await screen.findByTestId('landed')).toHaveTextContent('/app/chat/c1');
  });

  it('prefers an explicit ?return= over the post-update return path', async () => {
    sessionStorage.setItem(POST_UPDATE_RETURN_KEY, '/app/chat/c1');
    renderLogin('/login?return=%2Fapp%2Fsettings');
    await unlock();
    expect(await screen.findByTestId('landed')).toHaveTextContent('/app/settings');
  });

  it('auto-applies a ready update from the pristine screen when no other client answers', async () => {
    mockOtherClientsOpen.mockResolvedValue(false);
    useAppUpdateStore.getState().markUpdateReady();
    renderLogin();
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  });

  it('does not auto-apply while an error is shown, even with an empty field', async () => {
    mockOtherClientsOpen.mockResolvedValue(false);
    // Reject on a later task so the error lands inside findByRole's act scope.
    mockLoginLocalWithPassphrase.mockImplementation(
      () =>
        new Promise((_, reject) =>
          setTimeout(() => reject(new CryptoError('wrong_passphrase', 'no')), 0),
        ),
    );
    renderLogin();
    await unlock('wrong');
    await screen.findByRole('alert');
    fireEvent.change(await passphraseInput(), { target: { value: '' } });
    act(() => useAppUpdateStore.getState().markUpdateReady());
    await new Promise((r) => setTimeout(r, 0));
    expect(mockOtherClientsOpen).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it('never auto-applies while a session is present', async () => {
    mockOtherClientsOpen.mockResolvedValue(false);
    useSessionStore.setState({ session: {} as never });
    useAppUpdateStore.getState().markUpdateReady();
    renderLogin();
    await waitFor(() => expect(mockOtherClientsOpen).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(apply).not.toHaveBeenCalled();
  });

  it('disables unlocking while an update is being applied', async () => {
    renderLogin();
    fireEvent.change(await passphraseInput(), { target: { value: 'correct horse' } });
    const button = screen.getByRole('button', { name: /^unlock$/i });
    expect(button).toBeEnabled();
    act(() => useAppUpdateStore.getState().applyUpdate());
    expect(button).toBeDisabled();
    fireEvent.submit(button.closest('form') as HTMLFormElement);
    expect(mockLoginLocalWithPassphrase).not.toHaveBeenCalled();
  });
});
