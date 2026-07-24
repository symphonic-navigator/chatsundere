// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Fresh-PWA join (no local account, no session): the username field is shown,
// and an operator-suggested username carried in from the QR/link via
// invitation_input must pre-fill it. Manual code entry carries no suggestion,
// so the field stays empty. This is the Bug-2 fix: the suggested username never
// reached the field before (the dead invitation_confirm state was its only source).

vi.mock('@chatsundere/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatsundere/crypto')>();
  return {
    ...actual,
    getLocalAccount: vi.fn(async () => null),
    getLinkedAccount: vi.fn(async () => null),
    setBiometricPromptDue: vi.fn(async () => {}),
    startJoinByInvitation: vi.fn(),
    finishJoinByInvitation: vi.fn(),
  };
});

vi.mock('../../src/boot/open-db.js', () => ({
  getDb: vi.fn(() => ({}) as unknown as IDBDatabase),
}));
vi.mock('../../src/lib/server-client.js', () => ({ httpServerClient: {} }));

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

describe('InvitationConfirm — suggested-username pre-fill (Bug 2)', () => {
  beforeEach(() => {
    useSessionStore.setState({ session: null, mk: null });
  });

  it('pre-fills the username field from the QR-carried suggested username', async () => {
    useOnboardingStore.setState({
      state: {
        kind: 'invitation_input',
        baseUrl: 'https://server.example',
        code: 'ABCDEFGHij',
        suggestedUsername: 'alice',
      },
    });

    renderConfirm();

    const usernameField = await screen.findByLabelText('Username');
    expect(usernameField).toHaveValue('alice');
    // Provenance cue reassures the user the name is a suggestion, and editable.
    expect(screen.getByText(/suggested by your operator/i)).toBeInTheDocument();
  });

  it('drops the provenance cue once the user edits the suggested name', async () => {
    useOnboardingStore.setState({
      state: {
        kind: 'invitation_input',
        baseUrl: 'https://server.example',
        code: 'ABCDEFGHij',
        suggestedUsername: 'alice',
      },
    });

    renderConfirm();
    const usernameField = await screen.findByLabelText('Username');
    fireEvent.change(usernameField, { target: { value: 'alice2' } });
    expect(screen.queryByText(/suggested by your operator/i)).not.toBeInTheDocument();
  });

  it('leaves the field empty for manual code entry (no suggestion, no cue)', async () => {
    useOnboardingStore.setState({
      state: { kind: 'invitation_input', baseUrl: 'https://server.example', code: 'ABCDEFGHij' },
    });

    renderConfirm();

    const usernameField = await screen.findByLabelText('Username');
    expect(usernameField).toHaveValue('');
    expect(screen.queryByText(/suggested by your operator/i)).not.toBeInTheDocument();
  });

  it('live-sanitises uppercase and disallowed characters while typing', async () => {
    useOnboardingStore.setState({
      state: { kind: 'invitation_input', baseUrl: 'https://server.example', code: 'ABCDEFGHij' },
    });

    renderConfirm();
    const usernameField = await screen.findByLabelText('Username');
    fireEvent.change(usernameField, { target: { value: 'Chris!' } });
    expect(usernameField).toHaveValue('chris');
  });
});
