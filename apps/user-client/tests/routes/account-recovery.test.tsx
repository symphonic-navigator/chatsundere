// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Module mocks ─────────────────────────────────────────────────────────────
// Must come before the dynamic import of the component below.

interface RegenArgs {
  db: unknown;
  mk: unknown;
  serverUpdate?: (args: {
    new_recovery_verifier_key: Uint8Array;
    new_wrapped_mk_recovery_ciphertext: Uint8Array;
    new_wrapped_mk_recovery_nonce: Uint8Array;
    new_wrapped_mk_recovery_aad: Uint8Array;
  }) => Promise<void>;
}

const mockRegenerate = vi.fn(async (_args: RegenArgs) => ({
  recoveryKeyString: 'AAAA-BBBB',
  localWriteFailed: false,
}));

vi.mock('@chatsundere/crypto', () => ({
  regenerateRecoveryKey: (args: RegenArgs) => mockRegenerate(args),
  toBase64Url: (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url'),
  CryptoError: class CryptoError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'CryptoError';
    }
  },
}));

vi.mock('../../src/boot/open-db.js', () => ({ getDb: () => ({}) }));

vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: vi.fn(() => ({ onHelp: vi.fn(), helpOverlay: null })),
}));

vi.mock('../../src/lib/server-client.js', () => ({
  httpServerClient: { updateRecovery: vi.fn() },
}));

// ConfirmTyped from ui-shared — render a simple controlled stub.
vi.mock('@chatsundere/ui-shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatsundere/ui-shared')>();
  return {
    ...actual,
    ConfirmTyped: ({
      open,
      onConfirm,
      onCancel,
      confirmToken,
    }: {
      open: boolean;
      onConfirm: () => void;
      onCancel: () => void;
      confirmToken: string;
    }) =>
      open ? (
        <div data-testid="confirm-typed">
          <span>{confirmToken}</span>
          <button type="button" onClick={onConfirm}>
            Confirm
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      ) : null,
  };
});

import { useAccountLinkStore, useSessionStore } from '@chatsundere/ui-shared';
import { httpServerClient } from '../../src/lib/server-client.js';
import { RecoveryKeyPage } from '../../src/routes/app/account/recovery.js';

const updateRecoveryMock = vi.mocked(httpServerClient.updateRecovery);

function renderPage() {
  return render(
    <MemoryRouter>
      <RecoveryKeyPage />
    </MemoryRouter>,
  );
}

async function openConfirmAndConfirm(user: ReturnType<typeof userEvent.setup>) {
  const btn = await screen.findByRole('button', { name: /generate a new recovery key/i });
  await user.click(btn);
  await user.click(screen.getByRole('button', { name: 'Confirm' }));
}

describe('RecoveryKeyPage', () => {
  beforeEach(() => {
    mockRegenerate.mockClear();
    mockRegenerate.mockResolvedValue({ recoveryKeyString: 'AAAA-BBBB', localWriteFailed: false });
    updateRecoveryMock.mockReset();
    useAccountLinkStore.setState({ linkStatus: 'local-only', baseUrl: null, role: null });
  });

  it('renders the breadcrumb crumbs', async () => {
    useSessionStore.setState({ mk: { key: 'fake-key' } as never });
    renderPage();
    expect(await screen.findByText('My Account')).toBeInTheDocument();
    expect(await screen.findByText('Recovery Key')).toBeInTheDocument();
  });

  it('mk present → button enabled; confirming shows RecoveryKeyReveal with the key', async () => {
    useSessionStore.setState({ mk: { key: 'fake-mk' } as never });
    const user = userEvent.setup();
    renderPage();

    // The regenerate button must be present and enabled.
    const btn = await screen.findByRole('button', { name: /generate a new recovery key/i });
    expect(btn).not.toBeDisabled();

    // Click opens the ConfirmTyped dialog.
    await user.click(btn);
    expect(await screen.findByTestId('confirm-typed')).toBeInTheDocument();
    expect(screen.getByText('regenerate')).toBeInTheDocument();

    // Confirming triggers the mock and shows the key.
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByLabelText('Recovery key')).toBeInTheDocument();
    expect(screen.getByLabelText('Recovery key')).toHaveTextContent('AAAA-BBBB');
  });

  it('mk null → button disabled with reason text', async () => {
    useSessionStore.setState({ mk: null });
    renderPage();

    const btn = await screen.findByRole('button', { name: /generate a new recovery key/i });
    expect(btn).toBeDisabled();

    // The disabled reason text must be visible on screen.
    expect(
      await screen.findByText(/available after you sign in with your passphrase or recovery key/i),
    ).toBeInTheDocument();
  });

  it('link state unknown → button disabled with checking hint (fail safe)', async () => {
    useSessionStore.setState({ mk: { key: 'fake-mk' } as never });
    useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
    renderPage();

    const btn = await screen.findByRole('button', { name: /generate a new recovery key/i });
    expect(btn).toBeDisabled();
    expect(await screen.findByText(/still checking your server connection/i)).toBeInTheDocument();
  });

  it('unlinked account → regenerate passes NO serverUpdate', async () => {
    useSessionStore.setState({ mk: { key: 'fake-mk' } as never });
    const user = userEvent.setup();
    renderPage();
    await openConfirmAndConfirm(user);

    await screen.findByLabelText('Recovery key');
    expect(mockRegenerate).toHaveBeenCalledTimes(1);
    expect(mockRegenerate.mock.calls[0]?.[0]?.serverUpdate).toBeUndefined();
    expect(updateRecoveryMock).not.toHaveBeenCalled();
  });

  it('linked account → serverUpdate pushes base64url material to the linked server', async () => {
    useSessionStore.setState({ mk: { key: 'fake-mk' } as never });
    useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://srv.example' });
    updateRecoveryMock.mockResolvedValue(undefined);
    // Drive the callback the way the real crypto flow does: server BEFORE local.
    mockRegenerate.mockImplementation(async (args) => {
      await args.serverUpdate?.({
        new_recovery_verifier_key: new Uint8Array(32).fill(1),
        new_wrapped_mk_recovery_ciphertext: new Uint8Array([2, 2]),
        new_wrapped_mk_recovery_nonce: new Uint8Array([3, 3]),
        new_wrapped_mk_recovery_aad: new Uint8Array([4, 4]),
      });
      return { recoveryKeyString: 'CCCC-DDDD', localWriteFailed: false };
    });

    const user = userEvent.setup();
    renderPage();
    await openConfirmAndConfirm(user);

    await screen.findByLabelText('Recovery key');
    expect(updateRecoveryMock).toHaveBeenCalledTimes(1);
    const [req, baseUrl] = updateRecoveryMock.mock.calls[0] ?? [];
    expect(baseUrl).toBe('https://srv.example');
    expect(req).toEqual({
      new_recovery_verifier_key: Buffer.from(new Uint8Array(32).fill(1)).toString('base64url'),
      new_wrapped_mk_recovery: Buffer.from([2, 2]).toString('base64url'),
      new_wrap_nonce_recovery: Buffer.from([3, 3]).toString('base64url'),
      new_wrap_aad_recovery: Buffer.from([4, 4]).toString('base64url'),
    });
  });

  it('linked tail failure (localWriteFailed) → key IS revealed with the split-state warning', async () => {
    useSessionStore.setState({ mk: { key: 'fake-mk' } as never });
    useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://srv.example' });
    mockRegenerate.mockResolvedValue({ recoveryKeyString: 'EEEE-FFFF', localWriteFailed: true });

    const user = userEvent.setup();
    renderPage();
    await openConfirmAndConfirm(user);

    // The key must still be revealed — it is the only one deviceless recovery
    // now accepts — alongside the honest split-state warning.
    expect(await screen.findByLabelText('Recovery key')).toHaveTextContent('EEEE-FFFF');
    expect(screen.getByRole('alert')).toHaveTextContent(/registered with your server/i);
  });

  it('linked account, server unreachable → honest "NOT changed" error, no reveal', async () => {
    useSessionStore.setState({ mk: { key: 'fake-mk' } as never });
    useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://srv.example' });
    // The crypto flow propagates the serverUpdate rejection before any local write.
    mockRegenerate.mockImplementation(async (args) => {
      await args.serverUpdate?.({
        new_recovery_verifier_key: new Uint8Array(32),
        new_wrapped_mk_recovery_ciphertext: new Uint8Array([1]),
        new_wrapped_mk_recovery_nonce: new Uint8Array([1]),
        new_wrapped_mk_recovery_aad: new Uint8Array([1]),
      });
      return { recoveryKeyString: 'unreachable', localWriteFailed: false };
    });
    updateRecoveryMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const user = userEvent.setup();
    renderPage();
    await openConfirmAndConfirm(user);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/recovery key was NOT changed/i),
    );
    expect(screen.queryByLabelText('Recovery key')).toBeNull();
  });
});
