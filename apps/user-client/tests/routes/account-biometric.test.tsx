// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// ─── Module mocks ─────────────────────────────────────────────────────────────
// Must come before the dynamic import of the component below.

vi.mock('@chatsundere/crypto', () => ({
  PasskeyCredentialRow: undefined,
  listPasskeyCredentials: vi.fn(async () => [
    {
      credential_id: new Uint8Array([1, 2, 3]),
      label: 'MacBook Touch ID',
      aaguid: 'aaguid-abc123',
    },
  ]),
  deletePasskeyCredential: vi.fn(async () => undefined),
}));

vi.mock('../../src/lib/webauthn-availability.js', () => ({
  isWebAuthnAvailable: vi.fn(() => true),
}));

vi.mock('../../src/lib/webauthn.js', () => ({
  registerLocalBiometric: vi.fn(async () => undefined),
  PrfRequiredError: class PrfRequiredError extends Error {
    constructor() {
      super('PRF required');
      this.name = 'PrfRequiredError';
    }
  },
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

describe('BiometricPage', () => {
  it('renders the PageBar with My Account / Passphrase & Biometrics crumbs', async () => {
    renderPage();
    expect(await screen.findByText('My Account')).toBeInTheDocument();
    expect(await screen.findByText('Passphrase & Biometrics')).toBeInTheDocument();
  });

  it('renders the existing biometric label in a row', async () => {
    renderPage();
    expect(await screen.findByText('MacBook Touch ID')).toBeInTheDocument();
  });

  it('renders the AAGUID as subtitle text', async () => {
    renderPage();
    expect(await screen.findByText('aaguid-abc123')).toBeInTheDocument();
  });

  it('renders the "Set up biometric" button enabled when WebAuthn is available', async () => {
    renderPage();
    const btn = await screen.findByRole('button', { name: /set up biometric/i });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });

  it('renders the "Set up biometric" button disabled when WebAuthn is unavailable', async () => {
    const { isWebAuthnAvailable } = await import('../../src/lib/webauthn-availability.js');
    // mockReturnValueOnce is not sufficient: isWebAuthnAvailable() is called on
    // every render (including the loading→ready transition), so a stable
    // mockReturnValue is required.
    vi.mocked(isWebAuthnAvailable).mockReturnValue(false);

    renderPage();
    const btn = await screen.findByRole('button', { name: /set up biometric/i });
    expect(btn).toBeDisabled();
    // The disabled reason is exposed via the title attribute.
    expect(btn).toHaveAttribute('title');

    // Restore for subsequent tests.
    vi.mocked(isWebAuthnAvailable).mockReturnValue(true);
  });
});
