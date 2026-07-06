// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InlineEditRow } from '../../src/routes/app/account/InlineEditRow.js';

// ─── Module mocks for AccountPage ────────────────────────────────────────────
// These must come before the dynamic import below.

const stores = vi.hoisted(() => ({
  role: null as 'primary_admin' | 'admin' | 'user' | null,
  adminUrl: undefined as string | undefined,
  linkStatus: 'local-only' as 'unknown' | 'local-only' | 'linked',
  baseUrl: null as string | null,
}));

vi.mock('@chatsundere/crypto', () => ({
  CryptoError: class CryptoError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  changeUsername: vi.fn(),
  getLocalAccount: vi.fn(async () => ({
    username: 'navigator',
    created_at: new Date('2026-01-01'),
  })),
  listPasskeyCredentials: vi.fn(async () => [{ credential_id: new Uint8Array(1) }]),
}));

vi.mock('@chatsundere/ui-shared', () => ({
  motion: { respectsReducedMotion: () => true },
  useSessionStore: Object.assign(
    vi.fn((selector: (s: { session: { username: string } | null }) => unknown) =>
      selector({ session: { username: 'navigator' } }),
    ),
    { getState: () => ({ session: { username: 'navigator' }, mk: null }) },
  ),
  useAccountLinkStore: vi.fn(
    (
      selector: (s: {
        linkStatus: string;
        baseUrl: string | null;
        role: string | null;
      }) => unknown,
    ) => selector({ linkStatus: stores.linkStatus, baseUrl: stores.baseUrl, role: stores.role }),
  ),
  useDiscoveryStore: vi.fn(
    (selector: (s: { config: { adminUrl?: string; features: string[] } | null }) => unknown) =>
      selector({ config: stores.adminUrl ? { adminUrl: stores.adminUrl, features: [] } : null }),
  ),
}));

vi.mock('../../src/boot/open-db.js', () => ({ getDb: () => ({}) }));

vi.mock('../../src/lib/server-client.js', () => ({
  httpServerClient: { patchMe: vi.fn() },
}));

vi.mock('../../src/data/settings.js', () => ({
  useSettings: vi.fn(() => ({ data: { displayName: '' } })),
  useUpdateSettings: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));

vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: vi.fn(() => ({ onHelp: vi.fn(), helpOverlay: null })),
}));

vi.mock('../../src/lib/version.js', () => ({
  APP_VERSION: { version: '0.0.0-test', sha: 'abc1234', builtAt: 'dev' },
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}));

import { changeUsername } from '@chatsundere/crypto';
import { HttpError } from '../../src/lib/fetch.js';
import { httpServerClient } from '../../src/lib/server-client.js';
import { AccountPage } from '../../src/routes/app/account.js';

const changeUsernameMock = vi.mocked(changeUsername);
const patchMeMock = vi.mocked(httpServerClient.patchMe);

function renderPage() {
  return render(
    <MemoryRouter>
      <AccountPage />
    </MemoryRouter>,
  );
}

// ─── InlineEditRow unit tests ─────────────────────────────────────────────────

describe('InlineEditRow', () => {
  it('saves on blur and shows Saved ✓', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<InlineEditRow label="Display name" value="" placeholder="navigator" onSave={onSave} />);
    const input = screen.getByLabelText('Display name');
    fireEvent.change(input, { target: { value: 'Nav' } });
    fireEvent.blur(input);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Nav'));
    expect(await screen.findByText(/Saved/)).toBeInTheDocument();
  });

  it('does not save when unchanged', () => {
    const onSave = vi.fn();
    render(<InlineEditRow label="Display name" value="Nav" onSave={onSave} />);
    fireEvent.blur(screen.getByLabelText('Display name'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('blocks save on validation failure, keeps value + shows error', async () => {
    const onSave = vi.fn();
    const validate = (v: string) => (v.includes(' ') ? 'No spaces allowed' : null);
    render(<InlineEditRow label="Username" value="nav" validate={validate} onSave={onSave} />);
    const input = screen.getByLabelText('Username');
    fireEvent.change(input, { target: { value: 'bad name' } });
    fireEvent.blur(input);
    expect(onSave).not.toHaveBeenCalled();
    expect(await screen.findByText('No spaces allowed')).toBeInTheDocument();
    expect(input).toHaveValue('bad name');
  });

  it('re-syncs draft when value prop resolves async (unfocused field)', async () => {
    // Simulates: settings query starts undefined/empty, resolves to saved value.
    const onSave = vi.fn();
    const { rerender } = render(
      <InlineEditRow label="Display name" value="" placeholder="navigator" onSave={onSave} />,
    );
    const input = screen.getByLabelText('Display name');
    // Initially empty (async not yet resolved).
    expect(input).toHaveValue('');
    // Settings query resolves — prop updates. Field is NOT focused.
    rerender(
      <InlineEditRow
        label="Display name"
        value="Existing Name"
        placeholder="navigator"
        onSave={onSave}
      />,
    );
    await waitFor(() => expect(input).toHaveValue('Existing Name'));
  });

  it('does NOT clobber a user-typed draft when value prop updates while focused', async () => {
    // Simulates: user is mid-edit when a background refresh fires.
    const onSave = vi.fn();
    const { rerender } = render(
      <InlineEditRow
        label="Display name"
        value="Old Name"
        placeholder="navigator"
        onSave={onSave}
      />,
    );
    const input = screen.getByLabelText('Display name');
    // User focuses and starts typing a new value.
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'New Draft' } });
    expect(input).toHaveValue('New Draft');
    // A background refresh fires with the stale server value.
    rerender(
      <InlineEditRow
        label="Display name"
        value="Old Name"
        placeholder="navigator"
        onSave={onSave}
      />,
    );
    // The draft must be preserved — focus guard must have blocked the re-sync.
    expect(input).toHaveValue('New Draft');
  });

  it('surfaces the thrown Error message so callers can be specific (Laura HARD #2)', async () => {
    const onSave = vi
      .fn()
      .mockRejectedValue(
        new Error('That username is already taken on this server. Choose another.'),
      );
    render(<InlineEditRow label="Username" value="nav" onSave={onSave} />);
    const input = screen.getByLabelText('Username');
    fireEvent.change(input, { target: { value: 'taken' } });
    fireEvent.blur(input);
    expect(
      await screen.findByText('That username is already taken on this server. Choose another.'),
    ).toBeInTheDocument();
  });

  it('falls back to the generic message when the thrown error carries none', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error(''));
    render(<InlineEditRow label="Username" value="nav" onSave={onSave} />);
    const input = screen.getByLabelText('Username');
    fireEvent.change(input, { target: { value: 'other' } });
    fireEvent.blur(input);
    expect(await screen.findByText('Could not save. Please try again.')).toBeInTheDocument();
  });
});

// ─── AccountPage render tests ─────────────────────────────────────────────────

describe('AccountPage', () => {
  beforeEach(() => {
    stores.role = null;
    stores.adminUrl = undefined;
    mockNavigate.mockClear();
  });

  it('renders all six matrix tiles with the correct destinations', async () => {
    renderPage();
    // NavTile renders as role="button" with aria-label matching the label prop.
    const tile = (label: string) => screen.getByRole('button', { name: label });
    expect(tile('Passphrase & Biometrics')).toBeInTheDocument();
    expect(tile('Recently deleted')).toBeInTheDocument();
    expect(tile('Server linking')).toBeInTheDocument();
    expect(tile('About')).toBeInTheDocument();
    expect(tile('Recovery Key')).toBeInTheDocument();
    expect(tile('Logout')).toBeInTheDocument();
  });

  it('hides the Admin tile for a local-only user (no role)', async () => {
    stores.role = null;
    stores.adminUrl = 'https://admin.example';
    renderPage();
    await screen.findByRole('button', { name: 'Logout' });
    expect(screen.queryByRole('button', { name: 'Admin' })).not.toBeInTheDocument();
  });

  it('hides the Admin tile for a regular user even when a URL is configured', async () => {
    stores.role = 'user';
    stores.adminUrl = 'https://admin.example';
    renderPage();
    await screen.findByRole('button', { name: 'Logout' });
    expect(screen.queryByRole('button', { name: 'Admin' })).not.toBeInTheDocument();
  });

  it('hides the Admin tile for an admin when no admin URL is configured', async () => {
    stores.role = 'admin';
    stores.adminUrl = undefined;
    renderPage();
    await screen.findByRole('button', { name: 'Logout' });
    expect(screen.queryByRole('button', { name: 'Admin' })).not.toBeInTheDocument();
  });

  it('shows the gold Admin tile for an admin on a backend that advertises one', async () => {
    stores.role = 'admin';
    stores.adminUrl = 'https://admin.example';
    renderPage();
    expect(await screen.findByRole('button', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByText('opens the admin console')).toBeInTheDocument();
  });

  it('opens the admin console in a new tab when the Admin tile is activated', async () => {
    stores.role = 'primary_admin';
    stores.adminUrl = 'https://admin.example';
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderPage();
    const adminTile = await screen.findByRole('button', { name: 'Admin' });
    fireEvent.click(adminTile);
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith('https://admin.example', '_blank', 'noopener,noreferrer'),
    );
    open.mockRestore();
  });

  it('Logout tile carries the discoverability meta text', async () => {
    renderPage();
    expect(screen.getByText('sign out · delete data')).toBeInTheDocument();
  });

  it('does not render any "Save & Back" control', async () => {
    renderPage();
    expect(screen.queryByText(/save & back/i)).not.toBeInTheDocument();
  });

  it('shows the biometrics badge when credentials are present', async () => {
    renderPage();
    // listPasskeyCredentials mock returns 1 row — expect "Configured (1)"
    expect(await screen.findByText('Configured (1)')).toBeInTheDocument();
  });
});

// ─── Username rename across the server link (Defect B) ────────────────────────

describe('AccountPage — username rename across the server link (Defect B)', () => {
  beforeEach(() => {
    stores.role = null;
    stores.adminUrl = undefined;
    stores.linkStatus = 'local-only';
    stores.baseUrl = null;
    changeUsernameMock.mockReset();
    patchMeMock.mockReset();
    // Mirror the real flow: changeUsername runs serverPatch FIRST (server-first),
    // so a rejecting serverPatch aborts before any local write.
    changeUsernameMock.mockImplementation(async ({ serverPatch, newUsername }) => {
      if (serverPatch) await serverPatch(newUsername);
    });
  });

  async function renameUsernameTo(next: string): Promise<void> {
    renderPage();
    const input = await screen.findByLabelText('Username');
    fireEvent.change(input, { target: { value: next } });
    fireEvent.blur(input);
  }

  it('unlinked: renames locally, with no serverPatch and no PATCH /me', async () => {
    stores.linkStatus = 'local-only';
    await renameUsernameTo('navigator2');
    await waitFor(() => expect(changeUsernameMock).toHaveBeenCalled());
    const arg = changeUsernameMock.mock.calls.at(-1)?.[0];
    expect(arg?.newUsername).toBe('navigator2');
    expect(arg?.serverPatch).toBeUndefined();
    expect(patchMeMock).not.toHaveBeenCalled();
  });

  it('linked: PATCHes /me server-first with the chosen name', async () => {
    stores.linkStatus = 'linked';
    stores.baseUrl = 'https://server.example';
    patchMeMock.mockResolvedValue(undefined);
    await renameUsernameTo('navigator2');
    await waitFor(() => expect(patchMeMock).toHaveBeenCalled());
    expect(patchMeMock).toHaveBeenCalledWith(
      { username: 'navigator2' },
      'https://server.example',
      '',
    );
  });

  it('linked: a 409 surfaces the "already taken" copy (leaves the local name unchanged)', async () => {
    stores.linkStatus = 'linked';
    stores.baseUrl = 'https://server.example';
    patchMeMock.mockRejectedValue(new HttpError(409, 'username_taken', 'conflict'));
    await renameUsernameTo('taken');
    expect(
      await screen.findByText('That username is already taken on this server. Choose another.'),
    ).toBeInTheDocument();
  });

  it('linked: a network failure surfaces the offline "wasn\'t changed" copy', async () => {
    stores.linkStatus = 'linked';
    stores.baseUrl = 'https://server.example';
    // A network failure rejects fetch with a TypeError, not an HttpError.
    patchMeMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await renameUsernameTo('offline');
    expect(
      await screen.findByText(
        "Couldn't reach the server, so your name wasn't changed. Try again when you're back online.",
      ),
    ).toBeInTheDocument();
  });

  it('unknown link state: refuses the rename until it resolves (Larissa LOW-2)', async () => {
    stores.linkStatus = 'unknown';
    await renameUsernameTo('navigator2');
    expect(
      await screen.findByText(
        'One moment — still checking your server connection. Try again in a second.',
      ),
    ).toBeInTheDocument();
    expect(changeUsernameMock).not.toHaveBeenCalled();
    expect(patchMeMock).not.toHaveBeenCalled();
  });
});
