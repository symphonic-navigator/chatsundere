// SPDX-License-Identifier: AGPL-3.0-only
// The recovery-key reveal is a point of no return (spec "Back means one thing"):
// while a key waits to be acknowledged, every onboarding or login route replaces
// itself with the reveal, so Back can never lose the key. The hold decides while
// rendering, so the page it replaces never mounts or runs its effects.
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RecoveryRevealHold } from '../../src/components/RecoveryRevealHold.js';
import { OnboardingMatrix } from '../../src/routes/onboarding/matrix.js';
import { useOnboardingStore } from '../../src/state/onboarding.store.js';

let go: (to: string) => void = () => {};
function Grab() {
  const navigate = useNavigate();
  go = (to) => navigate(to);
  return null;
}

function App({ at }: { at: string }) {
  return (
    <MemoryRouter initialEntries={[at]}>
      <Grab />
      <RecoveryRevealHold>
        <Routes>
          <Route path="/onboarding" element={<OnboardingMatrix />} />
          <Route path="/onboarding/invitation" element={<h1>Invitation form</h1>} />
          <Route path="/onboarding/invitation/recovery" element={<h1>Invitation reveal</h1>} />
          <Route path="/onboarding/local" element={<h1>Local wizard</h1>} />
          <Route path="/login" element={<h1>Login</h1>} />
          <Route path="/login/recovery" element={<h1>Login recovery</h1>} />
          <Route path="/app" element={<h1>Hall</h1>} />
        </Routes>
      </RecoveryRevealHold>
    </MemoryRouter>
  );
}

const heading = () => screen.getByRole('heading').textContent;

beforeEach(() => useOnboardingStore.getState().reset());
afterEach(cleanup);

describe('RecoveryRevealHold', () => {
  it('sends a Back into the invitation form straight back to the reveal', () => {
    useOnboardingStore.getState().setState({
      kind: 'invitation_recovery',
      userId: 'u',
      username: 'ann',
      recoveryKeyString: 'KEY',
    });
    render(<App at="/onboarding/invitation/recovery?return=%2Fonboarding" />);
    expect(heading()).toBe('Invitation reveal');
    act(() => go('/onboarding/invitation'));
    expect(heading()).toBe('Invitation reveal');
    act(() => go('/onboarding'));
    expect(heading()).toBe('Invitation reveal');
  });

  it('holds a local account’s reveal on its own route', () => {
    useOnboardingStore.getState().setState({
      kind: 'local_recovery',
      recoveryKeyString: 'KEY',
      at: '/onboarding/local',
    });
    render(<App at="/onboarding/local" />);
    act(() => go('/onboarding'));
    expect(heading()).toBe('Local wizard');
  });

  it('holds the login recovery’s new key the same way', () => {
    useOnboardingStore.getState().setState({
      kind: 'local_recovery',
      recoveryKeyString: 'KEY',
      at: '/login/recovery',
    });
    render(<App at="/login/recovery" />);
    act(() => go('/login'));
    expect(heading()).toBe('Login recovery');
  });

  it('the Welcome screen never mounts while a key is held, so it cannot clear it', () => {
    useOnboardingStore.getState().setState({
      kind: 'local_recovery',
      recoveryKeyString: 'KEY',
      at: '/onboarding/local',
    });
    render(<App at="/onboarding/local" />);
    act(() => go('/onboarding'));
    expect(heading()).toBe('Local wizard');
    expect(useOnboardingStore.getState().state.kind).toBe('local_recovery');
  });

  it('holds every route, the app’s own too, until the key is acknowledged', () => {
    useOnboardingStore.getState().setState({
      kind: 'local_recovery',
      recoveryKeyString: 'KEY',
      at: '/onboarding/local',
    });
    render(<App at="/app" />);
    expect(heading()).toBe('Local wizard');
    act(() => useOnboardingStore.getState().reset());
    act(() => go('/app'));
    expect(heading()).toBe('Hall');
  });
});
