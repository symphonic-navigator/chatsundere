// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mutable handles the crypto mock reads on each call, so individual tests stage
// "a linked account exists" versus "no existing link" without re-mocking.
let mockLinkedAccount: unknown = null;
let mockLocalAccount: unknown = null;

vi.mock('@chatsundere/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatsundere/crypto')>();
  return {
    ...actual,
    getLinkedAccount: vi.fn(async () => mockLinkedAccount),
    getLocalAccount: vi.fn(async () => mockLocalAccount),
  };
});

// getDb() throws unless the boot sequence opened IndexedDB; stub it so the
// component's getLinkedAccount(getDb()) call has a handle to pass through.
vi.mock('../../src/boot/open-db.js', () => ({
  getDb: vi.fn(() => ({}) as unknown as IDBDatabase),
}));

import type { MasterKey } from '@chatsundere/crypto';
import { useSessionStore } from '@chatsundere/ui-shared';
import { InvitationConfirm } from '../../src/routes/onboarding/invitation/confirm.js';
import { useOnboardingStore } from '../../src/state/onboarding.store.js';

function renderConfirm() {
  return render(
    <MemoryRouter initialEntries={['/onboarding/invitation/confirm']}>
      <InvitationConfirm />
    </MemoryRouter>,
  );
}

/** Seed the store into invitation_confirm pointing at the given new server. */
function seedConfirmState(baseUrl: string) {
  useOnboardingStore.setState({
    state: {
      kind: 'invitation_confirm',
      sessionId: 's1',
      baseUrl,
      code: 'CODE-123',
      suggestedUsername: null,
      registrationState: null,
    },
  });
}

/** Set an unlocked local session so isLateLink === true. */
function unlockSession() {
  useSessionStore.setState({
    session: { userId: 'u1', username: 'chris' } as never,
    mk: {} as unknown as MasterKey,
  });
}

describe('InvitationConfirm — replace-link acknowledgement (Task 14)', () => {
  beforeEach(() => {
    mockLinkedAccount = null;
    mockLocalAccount = { userId: 'u1' };
    useSessionStore.setState({ session: null, mk: null });
    useOnboardingStore.getState().reset();
  });

  it('interposes an acknowledgement naming both servers before the late-link form', async () => {
    unlockSession();
    seedConfirmState('https://new.example');
    mockLinkedAccount = {
      server_user_id: 'srv-1',
      base_url: 'https://old.example',
      issuer_label: null,
      role: 'user',
      wrapped_mk_opaque_ciphertext: new Uint8Array(),
      wrapped_mk_opaque_nonce: new Uint8Array(),
      wrapped_mk_opaque_aad: new Uint8Array(),
      wrapped_mk_opaque_integrity: new Uint8Array(),
      linked_at: new Date(),
    };

    renderConfirm();

    // Acknowledgement screen names both the current and the new server.
    expect(await screen.findByText(/currently connected to/i)).toBeInTheDocument();
    expect(screen.getByText('https://old.example')).toBeInTheDocument();
    expect(screen.getByText('https://new.example')).toBeInTheDocument();

    // The passphrase form is NOT yet reachable.
    expect(screen.queryByLabelText(/your passphrase/i)).toBeNull();

    // Acknowledging reveals the normal late-link form.
    fireEvent.click(screen.getByRole('button', { name: /replace/i }));

    expect(await screen.findByLabelText(/your passphrase/i)).toBeInTheDocument();
    expect(screen.queryByText(/currently connected to/i)).toBeNull();
  });

  it('does not interpose for a late-link with no existing link', async () => {
    unlockSession();
    seedConfirmState('https://new.example');
    mockLinkedAccount = null;

    renderConfirm();

    // Straight to the form — no replace acknowledgement.
    expect(await screen.findByLabelText(/your passphrase/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText(/currently connected to/i)).toBeNull();
    });
  });
});
