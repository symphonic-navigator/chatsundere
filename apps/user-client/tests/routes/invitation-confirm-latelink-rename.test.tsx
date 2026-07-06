// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The late-link path (a local account exists + an unlocked session) links to the
// server via `linkToServer`. Stage it to reject with a username conflict so we can
// assert the confirm screen ENTERS rename mode and REVEALS the username field —
// the guard against reinstating the v1 HARD #1 "message set into a hidden field".

vi.mock('@chatsundere/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatsundere/crypto')>();
  return {
    ...actual,
    getLocalAccount: vi.fn(async () => ({ username: 'chris' })),
    getLinkedAccount: vi.fn(async () => null),
    linkToServer: vi.fn(async () => {
      throw new actual.CryptoError('conflict', 'username already registered on this server');
    }),
    changeUsername: vi.fn(async () => {}),
    setBiometricPromptDue: vi.fn(async () => {}),
    startJoinByInvitation: vi.fn(),
    finishJoinByInvitation: vi.fn(),
  };
});

vi.mock('../../src/boot/open-db.js', () => ({
  getDb: vi.fn(() => ({}) as unknown as IDBDatabase),
}));
vi.mock('../../src/lib/server-client.js', () => ({ httpServerClient: {} }));
vi.mock('../../src/sync/link-reset.js', () => ({ resetEngineStateForNewLink: vi.fn() }));
vi.mock('../../src/sync/worker.js', () => ({ runSyncCycle: vi.fn() }));

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

describe('InvitationConfirm — late-link username conflict enters rename mode (Defect A)', () => {
  beforeEach(() => {
    // Unlocked local session named "chris" → isLateLink is true and the account
    // guard passes through.
    useSessionStore.setState({
      session: { userId: 'u1', username: 'chris', mode: 'local' } as never,
      mk: {} as unknown as MasterKey,
    });
    useOnboardingStore.setState({
      state: { kind: 'invitation_input', baseUrl: 'https://server.example', code: 'ABCDEFGHij' },
    });
  });

  it('reveals the username field (pre-filled) on the first conflict, not a hidden error', async () => {
    renderConfirm();

    // Late-link form: passphrase only, no username field yet.
    const passphrase = await screen.findByLabelText('Your passphrase');
    expect(screen.queryByLabelText('Username')).toBeNull();

    fireEvent.change(passphrase, { target: { value: 'correct horse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect this device' }));

    // Conflict → rename mode: the heading changes and the username field appears,
    // pre-filled with the current local name so the user can pick a free one.
    expect(await screen.findByText("That name's already taken here")).toBeInTheDocument();
    const usernameField = screen.getByLabelText('Username');
    expect(usernameField).toHaveValue('chris');
    expect(screen.getByRole('button', { name: 'Join with this name' })).toBeInTheDocument();
  });
});
