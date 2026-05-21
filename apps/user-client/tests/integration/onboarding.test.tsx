import type { MasterKeySession } from '@chatsundere/crypto';
import { useSessionStore } from '@chatsundere/ui-shared';
// SPDX-License-Identifier: AGPL-3.0-only
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App.js';
import { useBootStore } from '../../src/state/boot.store.js';

// vi.hoisted ensures the constant is available when the hoisted vi.mock factory runs.
const { MOCK_RECOVERY_KEY } = vi.hoisted(() => ({
  MOCK_RECOVERY_KEY: 'ABCD-1234-EFGH-5678-IJKL-MNOP-QRST-UVWX-1234-5678',
}));

/**
 * Minimal MasterKeySession mock.
 * `as unknown as MasterKeySession` is the only allowed cast here — it shapes a
 * minimal stub that does not carry the closure from createMasterKeySession.
 */
function makeMockSession(): MasterKeySession {
  return {
    id: 'session-id',
    userId: 'new-user-id',
    username: 'alice',
    mode: 'local',
    online: false,
    deriveDek: vi.fn(),
    encrypt: vi.fn(),
    decrypt: vi.fn(),
    produceRecoveryProof: vi.fn(),
    registerLocalBiometric: vi.fn(),
    close: vi.fn(),
  } as unknown as MasterKeySession;
}

// Mock @chatsundere/crypto — re-export everything real except the two flows
// exercised by the wizard so the test doesn't need the full crypto environment.
vi.mock('@chatsundere/crypto', async (importActual) => {
  const actual = await importActual<typeof import('@chatsundere/crypto')>();
  return {
    ...actual,
    createLocalAccount: vi.fn().mockResolvedValue({
      session: {
        id: 'session-id',
        userId: 'new-user-id',
        username: 'alice',
        mode: 'local',
        online: false,
        deriveDek: vi.fn(),
        encrypt: vi.fn(),
        decrypt: vi.fn(),
        produceRecoveryProof: vi.fn(),
        registerLocalBiometric: vi.fn(),
        close: vi.fn(),
      },
      recoveryKeyString: MOCK_RECOVERY_KEY,
    }),
    getLocalAccount: vi.fn().mockResolvedValue(null),
  };
});

// Mock open-db so we never touch real IndexedDB from within the wizard.
vi.mock('../../src/boot/open-db.js', () => ({
  openDb: vi.fn().mockResolvedValue({}),
  getDb: vi.fn().mockReturnValue({}),
}));

beforeEach(() => {
  // Seed boot store to the ready phase so <App /> renders the router tree.
  useBootStore.setState({ phase: { kind: 'ready', staging: { kind: 'none' } } });
  // Clear any lingering session. Both slices must be reset because Zustand's
  // setState does a shallow merge — passing only `session` would leave a
  // prior `mk` in place across tests.
  useSessionStore.setState({ session: null, mk: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Onboarding → create account walk', () => {
  it('routes to /onboarding when no local account exists and walks through account creation', async () => {
    const user = userEvent.setup();
    render(<App />);

    // Gate navigates to /onboarding when getLocalAccount returns null.
    // The onboarding screen should appear.
    expect(await screen.findByText('Get started')).toBeInTheDocument();

    // Step 1 — click "Get started" to navigate to /create.
    await user.click(screen.getByText('Get started'));

    // Step 1 — username field should appear.
    expect(await screen.findByLabelText('Username')).toBeInTheDocument();

    // Type a valid username.
    await user.type(screen.getByLabelText('Username'), 'alice');

    // Advance to step 2.
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Step 2 — passphrase fields should appear.
    expect(await screen.findByLabelText('Passphrase')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm passphrase')).toBeInTheDocument();

    // Type a matching passphrase and confirmation.
    await user.type(screen.getByLabelText('Passphrase'), 'correct-horse-battery');
    await user.type(screen.getByLabelText('Confirm passphrase'), 'correct-horse-battery');

    // Advance to step 3 (triggers createLocalAccount mock).
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Step 3 — recovery key should appear.
    expect(await screen.findByText(MOCK_RECOVERY_KEY)).toBeInTheDocument();

    // The finish button should be disabled before the checkbox is ticked.
    const finishButton = screen.getByRole('button', { name: /open chatsundere/i });
    expect(finishButton).toBeDisabled();

    // Tick the "I've saved my recovery key" checkbox.
    const confirmCheckbox = screen.getByRole('checkbox');
    await user.click(confirmCheckbox);

    // Button should now be enabled.
    expect(finishButton).not.toBeDisabled();

    // Click "Open Chatsundere" — this calls navigate('/app', { replace: true }).
    // We can't assert on actual navigation in jsdom (BrowserRouter uses the
    // real history API), but we verify the button was clickable without errors.
    await user.click(finishButton);
  });
});
