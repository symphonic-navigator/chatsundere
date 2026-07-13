// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

// The pairing form (the destination a tile tap lands on below) imports no
// crypto; the invitation destination is stubbed below, so no crypto mock is
// needed for these tests. `@chatsundere/ui-shared` runs unmocked — the route
// no longer probes on entry, so its live Zustand session/link stores suffice.

import { useAccountLinkStore, useSessionStore } from '@chatsundere/ui-shared';
import { JoinLanding } from '../../src/routes/join.js';
import { PairingForm } from '../../src/routes/onboarding/pairing/form.js';
import { useOnboardingStore } from '../../src/state/onboarding.store.js';
import { useToastStore } from '../../src/state/toast.store.js';

const SERVER = 'https://srv.example';
const CODE = 'AB7K3-MN9PX';
const VALID_JOIN_PATH = `/join?server=${encodeURIComponent(SERVER)}#${CODE}`;

/** Drive window.location (the route parses it, not the router location). */
function setWindowLocation(path: string): void {
  window.history.replaceState({}, '', path);
}

function LocationProbe(): JSX.Element {
  const loc = useLocation();
  return <div data-testid="loc" data-pathname={loc.pathname} />;
}

function renderJoin(): void {
  render(
    <MemoryRouter initialEntries={['/join']}>
      <Routes>
        <Route path="/join" element={<JoinLanding />} />
        <Route path="/onboarding" element={<div>MATRIX</div>} />
        <Route path="/onboarding/invitation" element={<div>INVITATION-FORM</div>} />
        <Route path="/onboarding/pairing" element={<PairingForm />} />
        <Route path="/app" element={<div>APP-HOME</div>} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

function pathname(): string | null {
  return screen.getByTestId('loc').getAttribute('data-pathname');
}

describe('JoinLanding — the /join chooser for scanned Chatsundere codes', () => {
  beforeEach(() => {
    useSessionStore.setState({ session: null, mk: null });
    useAccountLinkStore.setState({
      linkStatus: 'unknown',
      baseUrl: null,
      issuerLabel: null,
      role: null,
    });
    useOnboardingStore.getState().reset();
    useToastStore.getState().clear();
    setWindowLocation(VALID_JOIN_PATH);
  });

  it('shows a calm notice with a labelled action when the link carries no valid code', () => {
    setWindowLocation('/join');
    renderJoin();

    expect(screen.getByText(/didn't carry a valid code/i)).toBeInTheDocument();
    const action = screen.getByRole('link', { name: 'Choose how to join' });
    fireEvent.click(action);
    expect(pathname()).toBe('/onboarding');
  });

  it('renders the chooser (eyebrow, wordmark, sentence, both gold tiles) for a valid code with no session', () => {
    renderJoin();

    expect(screen.getByText('Welcome')).toBeInTheDocument();
    expect(screen.getByText('Chatsundere')).toBeInTheDocument();
    expect(screen.getByText(/You scanned a Chatsundere code/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'I have an invitation' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Link this device to my account' }),
    ).toBeInTheDocument();
    // Both account-backed intents carry the gold priority overlay; no disabled state.
    expect(document.querySelectorAll('[data-gold="true"]')).toHaveLength(2);
    expect(document.querySelector('[aria-disabled="true"]')).toBeNull();
  });

  it('seeds the store with invitation_input and navigates to the invitation flow root on tile tap', async () => {
    renderJoin();

    fireEvent.click(screen.getByRole('button', { name: 'I have an invitation' }));

    await waitFor(() => expect(pathname()).toBe('/onboarding/invitation'));
    const state = useOnboardingStore.getState().state;
    expect(state).toEqual({ kind: 'invitation_input', baseUrl: SERVER, code: CODE });
    // Never a /confirm deep-link.
    expect(pathname()).not.toContain('/confirm');
  });

  it('seeds the store with pairing_input and navigates to the pairing flow root on tile tap', async () => {
    renderJoin();

    fireEvent.click(screen.getByRole('button', { name: 'Link this device to my account' }));

    await waitFor(() => expect(pathname()).toBe('/onboarding/pairing'));
    const state = useOnboardingStore.getState().state;
    expect(state).toEqual({ kind: 'pairing_input', baseUrl: SERVER, code: CODE });
  });

  it('tile tap lands on the prefilled FORM with both fields populated, not /confirm', async () => {
    renderJoin();

    const tile = screen.getByRole('button', { name: 'Link this device to my account' });
    expect(tile).not.toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(tile);

    await waitFor(() => expect(pathname()).toBe('/onboarding/pairing'));
    // The flow root is the prefilled form — both fields carry the scanned values,
    // and we did NOT fast-forward to confirm. The form owns its own probe (on
    // Continue), so this route has nothing further to hand off.
    expect(pathname()).not.toContain('/confirm');
    expect((screen.getByLabelText('Server URL') as HTMLInputElement).value).toBe(SERVER);
    expect((screen.getByLabelText('Code') as HTMLInputElement).value).toBe(CODE);
  });

  it('redirects a linked session-holder to /app with the linked toast — no chooser', async () => {
    useSessionStore.setState({
      session: { userId: 'u1', username: 'chris' } as never,
      mk: {} as never,
    });
    useAccountLinkStore.setState({
      linkStatus: 'linked',
      baseUrl: SERVER,
      issuerLabel: null,
      role: 'user',
    });
    renderJoin();

    await waitFor(() => expect(pathname()).toBe('/app'));
    expect(screen.queryByRole('button', { name: 'I have an invitation' })).toBeNull();
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.message).toBe('This device is already linked to your account.');
  });

  it('redirects a local-only session-holder to /app with a constructive, non-dismissive toast', async () => {
    useSessionStore.setState({
      session: { userId: 'u1', username: 'chris' } as never,
      mk: {} as never,
    });
    useAccountLinkStore.setState({
      linkStatus: 'local-only',
      baseUrl: null,
      issuerLabel: null,
      role: null,
    });
    renderJoin();

    await waitFor(() => expect(pathname()).toBe('/app'));
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.message).toMatch(/isn't available yet/i);
  });
});
