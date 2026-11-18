// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockLoginLocalWithPassphrase = vi.fn();
const mockActivateSession = vi.fn(async (..._a: unknown[]) => undefined);
const passkeyRows = vi.hoisted(() => ({
  rows: [{ credential_id: new Uint8Array([1, 2, 3]) }] as unknown[],
}));

vi.mock('@chatsundere/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatsundere/crypto')>();
  return {
    ...actual,
    getLocalAccount: async () => ({ username: 'chris' }),
    listLocalBiometric: async () => passkeyRows.rows,
    loginLocalWithPassphrase: (args: unknown) => mockLoginLocalWithPassphrase(args),
  };
});
vi.mock('../../src/boot/open-db.js', () => ({ getDb: vi.fn(() => ({})) }));
vi.mock('../../src/boot/activate-session.js', () => ({
  activateSession: (...a: unknown[]) => mockActivateSession(...a),
}));
vi.mock('../../src/lib/server-client.js', () => ({ httpServerClient: {} }));
vi.mock('../../src/data/settings.js', () => ({
  useDisplayName: (fallback?: string | null) => fallback ?? '—',
}));
vi.mock('../../src/lib/webauthn-availability.js', () => ({ isWebAuthnAvailable: () => true }));
vi.mock('../../src/mcp/oauth/sign-in-session.js', () => ({
  postUnlockTarget: async (target: string) => target,
}));

import { useAccountLinkStore, useSessionStore } from '@chatsundere/ui-shared';
import { Login } from '../../src/routes/login/index.js';

function Landed(): JSX.Element {
  const loc = useLocation();
  return <div data-testid="landed">{`${loc.pathname}${loc.search}`}</div>;
}

function renderLogin(path: string) {
  return render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/app/*" element={<Landed />} />
      </Routes>
    </MemoryRouter>,
  );
}

const RETURN = '/app/chat/c1?persona=p1';
const NEED_PATH = `/login?return=${encodeURIComponent(RETURN)}&need=passphrase`;

async function passphraseInput(): Promise<HTMLElement> {
  return await screen.findByLabelText(/^passphrase$/i, { selector: 'input' });
}

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem('splashShown', '1');
  useSessionStore.setState({ session: null, mk: null });
  useAccountLinkStore.setState({ linkStatus: 'local-only' });
  mockLoginLocalWithPassphrase.mockReset().mockResolvedValue({ session: { id: 's2' }, mk: {} });
  mockActivateSession.mockClear();
  passkeyRows.rows = [{ credential_id: new Uint8Array([1, 2, 3]) }];
});

const SENTENCE = 'Unlock once more so Chatsundere can use your keys.';

describe('Login with need=passphrase (spec 0.5.0 papercuts, item 7)', () => {
  it('keeps the passkey button enabled: a passkey unlock restores the keys too', async () => {
    renderLogin(NEED_PATH);
    const passkey = await screen.findByRole('button', { name: /sign in with passkey/i });
    expect(passkey).toBeEnabled();
    expect(screen.queryByText('This needs your passphrase')).toBeNull();
    expect(passkey).not.toHaveAccessibleDescription('This needs your passphrase');
  });

  it('never claims that only the passphrase works', async () => {
    renderLogin(NEED_PATH);
    await passphraseInput();
    expect(screen.queryByText(/needs your passphrase/i)).toBeNull();
  });

  it('focuses the passphrase field', async () => {
    renderLogin(NEED_PATH);
    const input = await passphraseInput();
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it('offers Not now back to the return target while a session is active', async () => {
    useSessionStore.setState({ session: { id: 's1' } as never, mk: null });
    renderLogin(NEED_PATH);
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(await screen.findByTestId('landed')).toHaveTextContent(RETURN);
    expect(mockActivateSession).not.toHaveBeenCalled();
  });

  it('offers no Not now without an active session', async () => {
    renderLogin(NEED_PATH);
    await passphraseInput();
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
  });

  it('returns to the target with the master key after the passphrase, over an active session', async () => {
    useSessionStore.setState({ session: { id: 's1' } as never, mk: null });
    renderLogin(NEED_PATH);
    fireEvent.change(await passphraseInput(), { target: { value: 'correct horse' } });
    fireEvent.click(screen.getByRole('button', { name: /^unlock$/i }));
    expect(await screen.findByTestId('landed')).toHaveTextContent(RETURN);
    expect(mockActivateSession).toHaveBeenCalledTimes(1);
    // The passphrase path hands the master key on (the second argument).
    expect(mockActivateSession.mock.calls[0]?.[1]).toBeDefined();
  });

  it('falls back to /app for an off-origin return target', async () => {
    useSessionStore.setState({ session: { id: 's1' } as never, mk: null });
    renderLogin('/login?return=%2F%2Fevil.example&need=passphrase');
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(await screen.findByTestId('landed')).toHaveTextContent(/^\/app$/);
  });

  it('says why above the passphrase field when passkeys exist', async () => {
    renderLogin(NEED_PATH);
    const input = await passphraseInput();
    const sentence = screen.getByText(SENTENCE);
    expect(sentence.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('says why above the passphrase field without any passkey', async () => {
    passkeyRows.rows = [];
    renderLogin(NEED_PATH);
    const input = await passphraseInput();
    expect(screen.queryByRole('button', { name: /sign in with passkey/i })).toBeNull();
    const sentence = screen.getByText(SENTENCE);
    expect(sentence.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('is unchanged without need: passkey enabled, no reason, no Not now', async () => {
    useSessionStore.setState({ session: { id: 's1' } as never, mk: null });
    renderLogin(`/login?return=${encodeURIComponent(RETURN)}`);
    const passkey = await screen.findByRole('button', { name: /sign in with passkey/i });
    expect(passkey).toBeEnabled();
    expect(screen.queryByText('This needs your passphrase')).toBeNull();
    expect(screen.queryByText(SENTENCE)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
  });
});
