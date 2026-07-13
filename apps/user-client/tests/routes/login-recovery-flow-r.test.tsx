// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Module mocks ─────────────────────────────────────────────────────────────
// Must come before the dynamic import of the component below.

const mockLoginLocalWithRecoveryKey = vi.fn();
const mockRecoveryOnline = vi.fn();
const mockGetLinkedAccount = vi.fn();
const mockGetLocalAccount = vi.fn();
const mockChangePassphraseLocalOnly = vi.fn();
const mockRegenerateRecoveryKey = vi.fn();

vi.mock('@chatsundere/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatsundere/crypto')>();
  return {
    ...actual,
    loginLocalWithRecoveryKey: (args: unknown) => mockLoginLocalWithRecoveryKey(args),
    recoveryOnline: (args: unknown) => mockRecoveryOnline(args),
    getLinkedAccount: (db: unknown) => mockGetLinkedAccount(db),
    getLocalAccount: (db: unknown) => mockGetLocalAccount(db),
    changePassphraseLocalOnly: (args: unknown) => mockChangePassphraseLocalOnly(args),
    regenerateRecoveryKey: (args: unknown) => mockRegenerateRecoveryKey(args),
  };
});

vi.mock('../../src/boot/open-db.js', () => ({ getDb: vi.fn(() => ({})) }));

vi.mock('../../src/boot/activate-session.js', () => ({
  activateSession: vi.fn(async () => undefined),
}));

vi.mock('../../src/lib/server-client.js', () => ({ httpServerClient: {} }));

// The env module reads import.meta.env at load time; tests never configure
// VITE_AUTH_URL, so the deferred-recovery branch would otherwise hit the
// "server not configured" guard before ever calling recoveryOnline.
vi.mock('../../src/env.js', () => ({ env: { VITE_AUTH_URL: 'https://auth.example.com' } }));

import { CryptoError } from '@chatsundere/crypto';
import { HttpError } from '../../src/lib/fetch.js';
import { Recovery } from '../../src/routes/login/recovery.js';

// A syntactically-valid recovery key: RecoveryKeyLike only requires >= 50
// chars after stripping separators — the real decode is mocked away.
const FAKE_KEY = 'A'.repeat(52);

function renderRoute() {
  return render(
    <MemoryRouter>
      <Recovery />
    </MemoryRouter>,
  );
}

async function reachStep2Deferred(user: ReturnType<typeof userEvent.setup>) {
  renderRoute();
  // isLinked resolves asynchronously — wait for the scope selector to appear.
  await screen.findByText('How should we recover?');
  await user.type(screen.getByLabelText('Recovery key'), FAKE_KEY);
  fireEvent.click(screen.getByRole('radio', { name: /Local and server/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByText('Choose a new passphrase.');
}

async function fillAndSubmitPassphrase(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('New passphrase'), 'correct horse battery staple');
  await user.type(screen.getByLabelText('Confirm passphrase'), 'correct horse battery staple');
  fireEvent.click(screen.getByRole('button', { name: 'Set new passphrase' }));
}

describe('Recovery (login surface) — flow R back affordance (D2)', () => {
  beforeEach(() => {
    mockLoginLocalWithRecoveryKey.mockReset();
    mockRecoveryOnline.mockReset();
    mockGetLinkedAccount.mockReset().mockResolvedValue({ base_url: 'https://auth.example.com' });
    mockGetLocalAccount.mockReset().mockResolvedValue({ username: 'chris' });
    mockChangePassphraseLocalOnly.mockReset();
    mockRegenerateRecoveryKey.mockReset();
  });

  it('step2-deferred: a wrong-key failure renders the error AND the back affordance', async () => {
    mockRecoveryOnline.mockRejectedValue(new CryptoError('wrong_recovery_key', 'bad key'));
    const user = userEvent.setup();

    await reachStep2Deferred(user);
    await fillAndSubmitPassphrase(user);

    expect(await screen.findByText("That recovery key doesn't match.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-enter recovery key' })).toBeInTheDocument();
  });

  it('activating the back affordance returns to the key step, scope preserved, key field cleared and focused', async () => {
    mockRecoveryOnline.mockRejectedValue(new CryptoError('wrong_recovery_key', 'bad key'));
    const user = userEvent.setup();

    await reachStep2Deferred(user);
    await fillAndSubmitPassphrase(user);
    await screen.findByRole('button', { name: 'Re-enter recovery key' });

    fireEvent.click(screen.getByRole('button', { name: 'Re-enter recovery key' }));

    await screen.findByText('Sign in with your recovery key.');
    const keyInput = screen.getByLabelText('Recovery key') as HTMLInputElement;
    expect(keyInput.value).toBe('');
    expect(keyInput).toHaveFocus();
    // Scope context (the "how should we recover" choice) survives the
    // round-trip — the user should not have to redo it.
    expect(screen.getByRole('radio', { name: /Local and server/ })).toBeChecked();
  });

  it('step2-local does NOT render the back affordance (already-verified key)', async () => {
    mockLoginLocalWithRecoveryKey.mockResolvedValue({
      session: { id: 's1' },
      mk: new Uint8Array(32),
    });
    mockGetLinkedAccount.mockResolvedValue(null);
    const user = userEvent.setup();
    renderRoute();

    await user.type(screen.getByLabelText('Recovery key'), FAKE_KEY);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('Choose a new passphrase.');

    expect(screen.queryByRole('button', { name: 'Re-enter recovery key' })).not.toBeInTheDocument();
  });

  it('mapOnlineRecoveryError: HttpError 429 without Retry-After → shared "a few minutes" copy', async () => {
    mockRecoveryOnline.mockRejectedValue(new HttpError(429, 'rate_limited', 'slow down'));
    const user = userEvent.setup();

    await reachStep2Deferred(user);
    await fillAndSubmitPassphrase(user);

    expect(
      await screen.findByText('Too many attempts. Please wait a few minutes.'),
    ).toBeInTheDocument();
  });

  it('mapOnlineRecoveryError: HttpError 429 with Retry-After → shared "about N minutes" copy', async () => {
    mockRecoveryOnline.mockRejectedValue(new HttpError(429, 'rate_limited', 'slow down', 300));
    const user = userEvent.setup();

    await reachStep2Deferred(user);
    await fillAndSubmitPassphrase(user);

    expect(
      await screen.findByText('Too many attempts. Please wait about 5 minutes.'),
    ).toBeInTheDocument();
  });

  it('mapOnlineRecoveryError: HttpError 404 → unknown-username copy', async () => {
    mockRecoveryOnline.mockRejectedValue(new HttpError(404, 'not_found', 'no such user'));
    const user = userEvent.setup();

    await reachStep2Deferred(user);
    await fillAndSubmitPassphrase(user);

    expect(
      await screen.findByText('No account with that username on this server.'),
    ).toBeInTheDocument();
  });

  it('mapOnlineRecoveryError: HttpError 409 → unchanged generic unreachable copy', async () => {
    mockRecoveryOnline.mockRejectedValue(new HttpError(409, 'conflict', 'conflict'));
    const user = userEvent.setup();

    await reachStep2Deferred(user);
    await fillAndSubmitPassphrase(user);

    expect(
      await screen.findByText(
        'The server is unreachable. Try local-only recovery, or try again later.',
      ),
    ).toBeInTheDocument();
  });

  it('mapOnlineRecoveryError: HttpError 401 → unchanged generic unreachable copy', async () => {
    mockRecoveryOnline.mockRejectedValue(new HttpError(401, 'unauthorized', 'unauthorized'));
    const user = userEvent.setup();

    await reachStep2Deferred(user);
    await fillAndSubmitPassphrase(user);

    expect(
      await screen.findByText(
        'The server is unreachable. Try local-only recovery, or try again later.',
      ),
    ).toBeInTheDocument();
  });

  it('mapOnlineRecoveryError: a plain network throw → unchanged unreachable copy', async () => {
    mockRecoveryOnline.mockRejectedValue(new TypeError('Failed to fetch'));
    const user = userEvent.setup();

    await reachStep2Deferred(user);
    await fillAndSubmitPassphrase(user);

    expect(
      await screen.findByText(
        'The server is unreachable. Try local-only recovery, or try again later.',
      ),
    ).toBeInTheDocument();
  });
});
