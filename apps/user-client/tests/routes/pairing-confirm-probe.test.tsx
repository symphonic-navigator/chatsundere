// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mutable handle so the crypto mock's resolved value can be tuned per test
// without re-declaring the whole vi.mock factory.
let mockLinkedRow: unknown = null;

vi.mock('@chatsundere/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatsundere/crypto')>();
  return {
    ...actual,
    startJoinByPairing: vi.fn(async () => ({
      sessionId: 's1',
      username: 'chris',
      loginResponse: 'opaque-response',
      clientLoginState: {},
    })),
    finishJoinByPairing: vi.fn(async () => ({
      session: { userId: 'u1', username: 'chris' },
      mk: {} as never,
    })),
    getLinkedAccount: vi.fn(async () => mockLinkedRow),
    setBiometricPromptDue: vi.fn(async () => undefined),
  };
});

// getDb() throws unless the boot sequence opened IndexedDB; stub it so the
// confirm handler's getDb()-passing calls have a handle to pass through.
vi.mock('../../src/boot/open-db.js', () => ({
  getDb: vi.fn(() => ({}) as unknown as IDBDatabase),
}));

// The session-activation guard (client-data identity isolation) has its own
// tests; here it is a no-op so `activateSession` reduces to `setSession` for a
// mocked session that carries no real `deriveDek`.
vi.mock('../../src/boot/client-data-identity.js', () => ({
  enforceClientDataIdentity: vi.fn(async () => undefined),
  wipeClientDataForFreshOnboarding: vi.fn(async () => undefined),
  CLIENT_DATA_IDENTITY_CONTEXT: 'client-data/identity-binding-v1',
}));

// Spy on maybeProbeLinkedServer while keeping every other ui-shared export
// (the real Zustand stores) live — this is the regression the task fixes:
// a freshly-paired device must probe the now-linked server so the sync
// engine's canRunCycle() sees a populated discovery config instead of
// no-opping until a reload or connectivity event happens to fire.
const maybeProbeLinkedServer = vi.fn();
vi.mock('@chatsundere/ui-shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatsundere/ui-shared')>();
  return {
    ...actual,
    maybeProbeLinkedServer: () => maybeProbeLinkedServer(),
  };
});

import { useAccountLinkStore, useSessionStore } from '@chatsundere/ui-shared';
import { PairingConfirm } from '../../src/routes/onboarding/pairing/confirm.js';
import { useOnboardingStore } from '../../src/state/onboarding.store.js';

function renderConfirm() {
  return render(
    <MemoryRouter initialEntries={['/onboarding/pairing/confirm']}>
      <PairingConfirm />
    </MemoryRouter>,
  );
}

/** Seed the store into pairing_confirm pointing at the given server. */
function seedConfirmState(baseUrl: string) {
  useOnboardingStore.setState({
    state: {
      kind: 'pairing_confirm',
      sessionId: 's1',
      baseUrl,
      code: 'AB7K3-MN9PX',
      username: 'chris',
      loginState: null,
    },
  });
}

describe('PairingConfirm — probes the linked server after joining (Task 1)', () => {
  beforeEach(() => {
    mockLinkedRow = null;
    maybeProbeLinkedServer.mockReset();
    useSessionStore.setState({ session: null, mk: null });
    useAccountLinkStore.setState({
      linkStatus: 'unknown',
      baseUrl: null,
      issuerLabel: null,
      role: null,
    });
    useOnboardingStore.getState().reset();
  });

  it('probes the linked server for the newly-paired baseUrl after a successful join', async () => {
    seedConfirmState('https://srv.example');
    mockLinkedRow = {
      server_user_id: 'srv-1',
      base_url: 'https://srv.example',
      issuer_label: null,
      role: 'user',
      wrapped_mk_opaque_ciphertext: new Uint8Array(),
      wrapped_mk_opaque_nonce: new Uint8Array(),
      wrapped_mk_opaque_aad: new Uint8Array(),
      wrapped_mk_opaque_integrity: new Uint8Array(),
      linked_at: new Date(),
    };

    renderConfirm();

    fireEvent.change(await screen.findByLabelText(/your passphrase/i), {
      target: { value: 'correct-horse-battery-staple' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add this device/i }));

    await waitFor(() => {
      expect(maybeProbeLinkedServer).toHaveBeenCalledTimes(1);
    });
    // The store must actually report 'linked' for this baseUrl by the time the
    // probe fires — maybeProbeLinkedServer would otherwise no-op internally.
    expect(useAccountLinkStore.getState().linkStatus).toBe('linked');
    expect(useAccountLinkStore.getState().baseUrl).toBe('https://srv.example');
  });
});
