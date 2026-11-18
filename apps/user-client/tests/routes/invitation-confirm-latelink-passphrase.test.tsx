// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Late link after a passkey unlock (spec §3.6, Larissa F1 and F2). The user may
// not have typed the passphrase for weeks, so the confirm screen first proves
// it against the local wrap before linking (F1), and lands its store update on
// the live session rather than the one captured at render (F2).

// Mutable handles the crypto mock reads on each call.
let mockLinkedAccount: unknown = null;
let linkToServerImpl: () => Promise<void> = async () => {};
let linkArgs: { mk: Uint8Array } | null = null;
let loginLocalImpl: () => Promise<unknown> = async () => ({});

vi.mock('@chatsundere/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatsundere/crypto')>();
  return {
    ...actual,
    getLocalAccount: vi.fn(async () => ({ username: 'chris' })),
    getLinkedAccount: vi.fn(async () => mockLinkedAccount),
    loginLocalWithPassphrase: vi.fn(() => loginLocalImpl()),
    linkToServer: vi.fn((args: { mk: Uint8Array }) => {
      linkArgs = args;
      return linkToServerImpl();
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

import {
  CryptoError,
  type MasterKey,
  linkToServer,
  loginLocalWithPassphrase,
} from '@chatsundere/crypto';
import { useAccountLinkStore, useSessionStore } from '@chatsundere/ui-shared';
import { copy } from '../../src/lib/copy.js';
import { InvitationConfirm } from '../../src/routes/onboarding/invitation/confirm.js';
import { useOnboardingStore } from '../../src/state/onboarding.store.js';
import { resetEngineStateForNewLink } from '../../src/sync/link-reset.js';

const LINKED_ROW = {
  server_user_id: 'srv-1',
  base_url: 'https://server.example',
  issuer_label: null,
  role: 'user',
};

function renderConfirm() {
  return render(
    <MemoryRouter initialEntries={['/onboarding/invitation/confirm']}>
      <Routes>
        <Route path="/onboarding/invitation/confirm" element={<InvitationConfirm />} />
        <Route path="/login" element={<div>login page</div>} />
        <Route path="/app" element={<div>app page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** A closable stand-in for a `MasterKeySession`, as `loginLocalWithPassphrase` returns. */
function proofResult() {
  const mk = new Uint8Array(32).fill(9) as MasterKey;
  return { session: { userId: 'u1', username: 'chris', close: vi.fn(() => mk.fill(0)) }, mk };
}

async function submitPassphrase(value: string) {
  const passphrase = await screen.findByLabelText('Your passphrase');
  fireEvent.change(passphrase, { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect this device' }));
}

describe('InvitationConfirm — late link proves the passphrase and lands on the live session', () => {
  let storeMk: MasterKey;
  let setSessionSpy: ReturnType<typeof vi.fn>;
  let setLinkedSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    linkArgs = null;
    mockLinkedAccount = null;
    linkToServerImpl = async () => {
      mockLinkedAccount = LINKED_ROW;
    };
    loginLocalImpl = async () => proofResult();

    // The store's own session and MK, as a passkey unlock leaves them.
    storeMk = new Uint8Array(32).fill(7) as MasterKey;
    useSessionStore.setState({
      session: {
        userId: 'local-u1',
        username: 'chris',
        mode: 'local',
        close: vi.fn(() => storeMk.fill(0)),
      } as never,
      mk: storeMk,
    });
    const realSetSession = useSessionStore.getState().setSession;
    setSessionSpy = vi.fn(realSetSession);
    useSessionStore.setState({ setSession: setSessionSpy as never });
    const realSetLinked = useAccountLinkStore.getState().setLinked;
    setLinkedSpy = vi.fn(realSetLinked);
    useAccountLinkStore.setState({ setLinked: setLinkedSpy as never });

    useOnboardingStore.setState({
      state: { kind: 'invitation_input', baseUrl: 'https://server.example', code: 'ABCDEFGHij' },
    });
  });

  // A typo fails the integrity HMAC first (the AMK comes from the passphrase), so
  // the real flow throws `integrity_check_failed`; `wrong_passphrase` is the AEAD
  // fallback. Both must land inline (Larissa M1).
  it.each(['integrity_check_failed', 'wrong_passphrase'] as const)(
    'shows the inline passphrase error and sends nothing when the proof throws %s',
    async (code) => {
      loginLocalImpl = async () => {
        throw new CryptoError(code, 'wrong');
      };
      renderConfirm();

      await submitPassphrase('typo horse');

      expect(await screen.findByText(copy.login.errors.wrongPassphrase)).toBeInTheDocument();
      expect(loginLocalWithPassphrase).toHaveBeenCalledTimes(1);
      expect(linkToServer).not.toHaveBeenCalled();
      // Back on the form, not stuck in 'submitting'.
      expect(screen.getByRole('button', { name: 'Connect this device' })).toBeEnabled();
      expect(useSessionStore.getState().mk).toBe(storeMk);
    },
  );

  it('closes the proof session, links once and leaves the store MK untouched', async () => {
    const proof = proofResult();
    loginLocalImpl = async () => proof;
    renderConfirm();

    await submitPassphrase('correct horse');

    expect(await screen.findByText('app page')).toBeInTheDocument();
    expect(proof.session.close).toHaveBeenCalledTimes(1);
    expect(linkToServer).toHaveBeenCalledTimes(1);
    const state = useSessionStore.getState();
    expect(state.mk).toBe(storeMk);
    expect(storeMk.every((b) => b === 7)).toBe(true);
    expect(state.session?.mode).toBe('linked');
  });

  it('sends nothing and lands on /login when the store empties during the passphrase proof', async () => {
    let resolveProof: () => void = () => {};
    loginLocalImpl = () =>
      new Promise((resolve) => {
        resolveProof = () => resolve(proofResult());
      });
    renderConfirm();

    await submitPassphrase('correct horse');
    await waitFor(() => expect(loginLocalWithPassphrase).toHaveBeenCalledTimes(1));

    // Sign-out while the (slow) proof runs zeroes the MK captured at render.
    useSessionStore.getState().closeAndForget();
    resolveProof();

    expect(await screen.findByText('login page')).toBeInTheDocument();
    expect(linkToServer).not.toHaveBeenCalled();
    expect(setSessionSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('lands on /login without setSession when the store empties during linkToServer', async () => {
    let resolveLink: () => void = () => {};
    linkToServerImpl = () =>
      new Promise<void>((resolve) => {
        resolveLink = () => {
          mockLinkedAccount = LINKED_ROW;
          resolve();
        };
      });
    renderConfirm();

    await submitPassphrase('correct horse');
    await waitFor(() => expect(linkToServer).toHaveBeenCalledTimes(1));

    const wrapped = linkArgs?.mk;
    useSessionStore.getState().closeAndForget();
    // The MK handed to linkToServer is the proof's own buffer, so a sign-out
    // mid-link cannot zero what is about to be wrapped for the server (H1).
    expect(wrapped).toBeDefined();
    expect(wrapped).not.toBe(storeMk);
    expect(wrapped?.every((b) => b === 0)).toBe(false);
    resolveLink();

    expect(await screen.findByText('login page')).toBeInTheDocument();
    expect(setLinkedSpy).toHaveBeenCalledWith(LINKED_ROW);
    expect(resetEngineStateForNewLink).toHaveBeenCalledTimes(1);
    expect(setSessionSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(useSessionStore.getState()).toMatchObject({ session: null, mk: null });
  });
});
