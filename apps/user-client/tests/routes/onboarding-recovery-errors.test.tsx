// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Module mocks ─────────────────────────────────────────────────────────────
// Must come before the dynamic import of the component below.

const mockRecoverFromScratch = vi.fn();

vi.mock('@chatsundere/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatsundere/crypto')>();
  return {
    ...actual,
    recoverFromScratch: (args: unknown) => mockRecoverFromScratch(args),
    getLinkedAccount: vi.fn(async () => null),
    setBiometricPromptDue: vi.fn(async () => undefined),
  };
});

vi.mock('../../src/boot/open-db.js', () => ({ getDb: vi.fn(() => ({})) }));

vi.mock('../../src/boot/client-data-identity.js', () => ({
  wipeClientDataForFreshOnboarding: vi.fn(async () => undefined),
}));

vi.mock('../../src/boot/activate-session.js', () => ({
  activateSession: vi.fn(async () => undefined),
}));

vi.mock('../../src/lib/server-client.js', () => ({ httpServerClient: {} }));

// Only the server probe and the post-link discovery kick need stubbing —
// every other export (Zustand stores) stays live.
vi.mock('@chatsundere/ui-shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatsundere/ui-shared')>();
  return {
    ...actual,
    probeServer: vi.fn(async () => ({ kind: 'ok', config: {} })),
    maybeProbeLinkedServer: vi.fn(),
  };
});

import { CryptoError } from '@chatsundere/crypto';
import { HttpError } from '../../src/lib/fetch.js';
import { OnboardingRecovery } from '../../src/routes/onboarding/recovery.js';

// The exact copy the login surface (routes/login/recovery.tsx:236, sourced
// from lib/copy.ts:231) shows for `invalid_recovery_key_format` — the two
// surfaces must show identical wording.
const INVALID_KEY_COPY = "That recovery key doesn't match.";

// The exact copy the login surface's mapOnlineRecoveryError maps a 404 to
// (lib/copy.ts recovery.errors.unknownUsername) — both recovery surfaces must
// show identical wording for an unknown username.
const UNKNOWN_USERNAME_COPY = 'No account with that username on this server.';

function renderRoute() {
  return render(
    <MemoryRouter>
      <OnboardingRecovery />
    </MemoryRouter>,
  );
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Server URL'), 'https://example.com');
  await user.type(screen.getByLabelText('Username'), 'chris');
  await user.type(screen.getByLabelText('Recovery key'), 'XXXX-XXXX-XXXX-XXXX');
  await user.type(screen.getByLabelText('New passphrase'), 'correct horse battery staple');
  await user.type(screen.getByLabelText('Confirm new passphrase'), 'correct horse battery staple');
  fireEvent.click(screen.getByRole('button', { name: 'Recover account' }));
}

describe('OnboardingRecovery — catch handler branches (D1)', () => {
  beforeEach(() => {
    mockRecoverFromScratch.mockReset();
  });

  it('CryptoError not_found → inline username-field error, screen stays ready, inputs preserved', async () => {
    mockRecoverFromScratch.mockRejectedValue(new CryptoError('not_found', 'no such user'));
    const user = userEvent.setup();
    renderRoute();

    await fillAndSubmit(user);

    expect(await screen.findByText(UNKNOWN_USERNAME_COPY)).toBeInTheDocument();
    // Screen stayed 'ready' — the form (with typed values) is still on screen,
    // not the fatal full-screen message.
    expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('chris');
    expect((screen.getByLabelText('Recovery key') as HTMLInputElement).value).toBe(
      'XXXX-XXXX-XXXX-XXXX',
    );
    expect(screen.getByLabelText('Server URL')).toBeInTheDocument();
  });

  it('CryptoError invalid_recovery_key_format → inline key error, screen stays ready, inputs preserved', async () => {
    mockRecoverFromScratch.mockRejectedValue(
      new CryptoError('invalid_recovery_key_format', 'bad format'),
    );
    const user = userEvent.setup();
    renderRoute();

    await fillAndSubmit(user);

    expect(await screen.findByText(INVALID_KEY_COPY)).toBeInTheDocument();
    // Screen stayed 'ready' — the form (with typed values) is still on screen,
    // not the fatal full-screen message.
    expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('chris');
    expect((screen.getByLabelText('Recovery key') as HTMLInputElement).value).toBe(
      'XXXX-XXXX-XXXX-XXXX',
    );
    expect(screen.getByLabelText('Server URL')).toBeInTheDocument();
  });

  it('HttpError 429 rate_limited with Retry-After → inline "about N minutes", screen stays ready, inputs preserved', async () => {
    mockRecoverFromScratch.mockRejectedValue(new HttpError(429, 'rate_limited', 'slow down', 300));
    const user = userEvent.setup();
    renderRoute();

    await fillAndSubmit(user);

    expect(
      await screen.findByText('Too many attempts. Please wait about 5 minutes.'),
    ).toBeInTheDocument();
    // Screen stayed 'ready' — the form (with typed values) is still on screen,
    // not the fatal full-screen message.
    expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('chris');
    expect((screen.getByLabelText('Recovery key') as HTMLInputElement).value).toBe(
      'XXXX-XXXX-XXXX-XXXX',
    );
    expect(screen.getByLabelText('Server URL')).toBeInTheDocument();
  });

  it('HttpError 429 rate_limited without Retry-After → inline "a few minutes", screen stays ready, inputs preserved', async () => {
    mockRecoverFromScratch.mockRejectedValue(new HttpError(429, 'rate_limited', 'slow down'));
    const user = userEvent.setup();
    renderRoute();

    await fillAndSubmit(user);

    expect(
      await screen.findByText('Too many attempts. Please wait a few minutes.'),
    ).toBeInTheDocument();
    expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('chris');
    expect((screen.getByLabelText('Recovery key') as HTMLInputElement).value).toBe(
      'XXXX-XXXX-XXXX-XXXX',
    );
    expect(screen.getByLabelText('Server URL')).toBeInTheDocument();
  });
});
