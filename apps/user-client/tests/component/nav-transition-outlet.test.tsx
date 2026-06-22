// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import NavTransitionOutlet from '../../src/components/NavTransitionOutlet.js';
import { useNavTransitionStore } from '../../src/state/nav-transition.store.js';

const rect = (): DOMRect =>
  ({
    left: 0,
    top: 0,
    width: 10,
    height: 10,
    right: 10,
    bottom: 10,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }) as DOMRect;

/** Arms (from /a) and navigates to /b. */
function Harness({ arm }: { arm: boolean }) {
  const nav = useNavigate();
  return (
    <button
      type="button"
      onClick={() => {
        if (arm) useNavTransitionStore.getState().armFrom(rect(), '/a');
        nav('/b');
      }}
    >
      go
    </button>
  );
}

/** Navigates back to /a (simulates a back-button PUSH). */
function BackButton() {
  const nav = useNavigate();
  return (
    <button type="button" onClick={() => nav('/a')}>
      back
    </button>
  );
}

function renderApp(arm: boolean) {
  return render(
    <MemoryRouter initialEntries={['/a']}>
      <Routes>
        <Route element={<NavTransitionOutlet />}>
          <Route path="/a" element={<Harness arm={arm} />} />
          <Route path="/b" element={<BackButton />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('NavTransitionOutlet', () => {
  beforeEach(() => useNavTransitionStore.setState({ originRect: null, lastOrigin: null }));

  it('applies cs-zoom-in and consumes the rect on a PUSH from an armed tile', () => {
    const { container } = renderApp(true);
    fireEvent.click(screen.getByText('go'));
    expect(container.querySelector('.cs-zoom-in')).not.toBeNull();
    expect(useNavTransitionStore.getState().originRect).toBeNull();
  });

  it('does not zoom on a plain navigation (no rect armed)', () => {
    const { container } = renderApp(false);
    fireEvent.click(screen.getByText('go'));
    expect(container.querySelector('.cs-zoom-in')).toBeNull();
  });

  it('mounts cs-exit-layer when navigating back to the origin path', () => {
    const { container } = renderApp(true);
    // Navigate forward (arms the store with path /a, then enter to /b).
    fireEvent.click(screen.getByText('go'));
    // Now navigate back to /a — the outlet must see lastOrigin.path === /a.
    fireEvent.click(screen.getByText('back'));
    expect(container.querySelector('.cs-exit-layer')).not.toBeNull();
  });
});
