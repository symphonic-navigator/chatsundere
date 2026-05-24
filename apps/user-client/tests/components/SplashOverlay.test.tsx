// SPDX-License-Identifier: AGPL-3.0-only

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SplashContext } from '../../src/components/SplashContext.js';
import { SplashOverlay } from '../../src/components/SplashOverlay.js';

function renderOverlay() {
  const ref = { current: null } as { current: HTMLElement | null };
  return render(
    <SplashContext.Provider value={{ topbarLogoRef: ref }}>
      <SplashOverlay />
    </SplashContext.Provider>,
  );
}

describe('SplashOverlay', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    sessionStorage.clear();
    vi.useRealTimers();
  });

  it('renders the overlay on first mount in a fresh session', () => {
    renderOverlay();
    expect(screen.getByLabelText(/skip intro/i)).toBeInTheDocument();
    expect(screen.getByText('Chatsundere')).toBeInTheDocument();
  });

  it('does not render when sessionStorage marks the splash as already shown', () => {
    sessionStorage.setItem('splashShown', '1');
    renderOverlay();
    expect(screen.queryByLabelText(/skip intro/i)).toBeNull();
  });

  it('unmounts and persists splashShown when tapped', () => {
    renderOverlay();
    fireEvent.click(screen.getByLabelText(/skip intro/i));
    expect(screen.queryByLabelText(/skip intro/i)).toBeNull();
    expect(sessionStorage.getItem('splashShown')).toBe('1');
  });

  it('unmounts when Escape is pressed', () => {
    renderOverlay();
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.queryByLabelText(/skip intro/i)).toBeNull();
  });

  it('unmounts via hard-timeout after 3000ms', () => {
    renderOverlay();
    expect(screen.getByLabelText(/skip intro/i)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3001);
    });
    expect(screen.queryByLabelText(/skip intro/i)).toBeNull();
    expect(sessionStorage.getItem('splashShown')).toBe('1');
  });

  it('dismisses cleanly when topbarLogoRef is null', () => {
    // FLIP migration must be skipped if the ref is null; the overlay
    // still fades out and unmounts on the hard timeout.
    renderOverlay();
    act(() => {
      vi.advanceTimersByTime(3001);
    });
    expect(screen.queryByLabelText(/skip intro/i)).toBeNull();
  });

  it('does not auto-clear splashShown on a normal reload (soft-reload)', () => {
    sessionStorage.setItem('splashShown', '1');
    // Default jsdom navigation entry has type "navigate" and transferSize 0.
    // Our module-load check only clears on type=reload AND transferSize > 0.
    // Re-importing the module would re-run side effects, but Vitest module
    // caching keeps the import singleton — so this test just confirms the
    // overlay respects the existing splashShown flag (regression cover for
    // the cold-start gating).
    renderOverlay();
    expect(screen.queryByLabelText(/skip intro/i)).toBeNull();
  });
});
