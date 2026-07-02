// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { copy } from '../../src/lib/copy.js';

// ─── Module mocks ─────────────────────────────────────────────────────────────
// Must come before the dynamic import of the component below. Partial crypto
// mock: real exports plus a listPasskeyCredentials stub returning one synced
// and one local-only row.

vi.mock('@chatsundere/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatsundere/crypto')>();
  return {
    ...actual,
    listPasskeyCredentials: vi.fn(async () => [
      {
        credential_id: new Uint8Array([1, 2, 3]),
        label: 'Synced passkey',
        aaguid: 'aaguid-synced',
        is_synced_with_server: true,
      },
      {
        credential_id: new Uint8Array([4, 5, 6]),
        label: 'Local passkey',
        aaguid: 'aaguid-local',
        is_synced_with_server: false,
      },
    ]),
    deletePasskeyCredential: vi.fn(async () => undefined),
  };
});

vi.mock('../../src/lib/webauthn-availability.js', () => ({
  isWebAuthnAvailable: vi.fn(() => true),
}));

vi.mock('../../src/lib/webauthn.js', () => ({
  registerLocalBiometric: vi.fn(async () => undefined),
  PrfRequiredError: class PrfRequiredError extends Error {},
}));

vi.mock('../../src/lib/server-passkey.js', () => ({
  registerServerSyncedPasskey: vi.fn(async () => 'synced'),
  StartUnreachableError: class StartUnreachableError extends Error {},
}));

vi.mock('../../src/lib/passkey-management.js', () => ({
  renamePasskey: vi.fn(async () => undefined),
}));

vi.mock('../../src/boot/open-db.js', () => ({ getDb: () => ({}) }));

vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: vi.fn(() => ({ onHelp: vi.fn(), helpOverlay: null })),
}));

import { BiometricPage } from '../../src/routes/app/account/biometric.js';

function renderPage() {
  return render(
    <MemoryRouter>
      <BiometricPage />
    </MemoryRouter>,
  );
}

describe('BiometricPage sync markers', () => {
  it('renders a synced and a local-only marker, one per row', async () => {
    renderPage();
    expect(await screen.findByText(copy.settings.authMethods.syncedMarker)).toBeInTheDocument();
    expect(screen.getByText(copy.settings.authMethods.localOnlyMarker)).toBeInTheDocument();
  });

  it('hides the sync captions until the info button is pressed', async () => {
    renderPage();
    await screen.findByText(copy.settings.authMethods.syncedMarker);

    // Captions are press-to-reveal, not rendered up-front.
    expect(screen.queryByText(copy.settings.authMethods.syncedCaption)).not.toBeInTheDocument();
    expect(screen.queryByText(copy.settings.authMethods.localOnlyCaption)).not.toBeInTheDocument();

    const infoButtons = screen.getAllByRole('button', {
      name: copy.settings.authMethods.markerInfoAria,
    });
    expect(infoButtons).toHaveLength(2);

    // Reveal the synced row's caption (first row).
    const firstButton = infoButtons[0];
    if (!firstButton) throw new Error('expected an info button');
    fireEvent.click(firstButton);
    expect(screen.getByText(copy.settings.authMethods.syncedCaption)).toBeInTheDocument();
    expect(screen.queryByText(copy.settings.authMethods.localOnlyCaption)).not.toBeInTheDocument();

    // Reveal the local-only row's caption (second row).
    const secondButton = infoButtons[1];
    if (!secondButton) throw new Error('expected a second info button');
    fireEvent.click(secondButton);
    expect(screen.getByText(copy.settings.authMethods.localOnlyCaption)).toBeInTheDocument();
  });
});
