// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A mutable handle the crypto mock reads on each call, so individual tests can
// stage "a local account exists" versus "fresh device" without re-mocking.
let mockLocalAccount: unknown = null;

vi.mock('@chatsundere/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatsundere/crypto')>();
  return { ...actual, getLocalAccount: vi.fn(async () => mockLocalAccount) };
});

// getDb() throws unless the boot sequence opened IndexedDB; stub it so the
// guard's getLocalAccount(getDb()) call has a handle to pass through.
vi.mock('../../src/boot/open-db.js', () => ({
  getDb: vi.fn(() => ({}) as unknown as IDBDatabase),
}));

import type { MasterKey } from '@chatsundere/crypto';
import { useSessionStore } from '@chatsundere/ui-shared';
import { InvitationAccountGuard } from '../../src/routes/onboarding/invitation/_account-guard.js';

function guarded(children: ReactNode) {
  return render(
    <MemoryRouter initialEntries={['/onboarding/invitation']}>
      <InvitationAccountGuard>{children}</InvitationAccountGuard>
    </MemoryRouter>,
  );
}

const joinForm = <div data-testid="join-form">join form</div>;

describe('InvitationAccountGuard (spec §4.1 — unlock-first door)', () => {
  beforeEach(() => {
    mockLocalAccount = null;
    useSessionStore.setState({ session: null, mk: null });
  });

  it('shows the unlock-first screen when a local account exists without a session', async () => {
    mockLocalAccount = { userId: 'u1' };

    guarded(joinForm);

    expect(await screen.findByText(/already holds an account/i)).toBeInTheDocument();
    expect(screen.queryByTestId('join-form')).toBeNull();

    const cta = screen.getByRole('link', { name: /unlock and connect/i });
    expect(cta.getAttribute('href')).toContain('/login?return=%2Fonboarding%2Finvitation');
  });

  it('passes through on a fresh device (no local account)', async () => {
    mockLocalAccount = null;

    guarded(joinForm);

    expect(await screen.findByTestId('join-form')).toBeInTheDocument();
    expect(screen.queryByText(/already holds an account/i)).toBeNull();
  });

  it('passes through for an unlocked session (account present, mk set)', async () => {
    mockLocalAccount = { userId: 'u1' };
    useSessionStore.setState({ mk: {} as unknown as MasterKey });

    guarded(joinForm);

    expect(await screen.findByTestId('join-form')).toBeInTheDocument();
    expect(screen.queryByText(/already holds an account/i)).toBeNull();
  });
});
