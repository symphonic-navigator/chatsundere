// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdatedElsewhereOverlay } from '../../src/components/UpdatedElsewhereOverlay.js';
import { _resetAppUpdateForTests, useAppUpdateStore } from '../../src/sw/app-update.store.js';

const rememberReturnPath = vi.fn();
vi.mock('../../src/sw/post-update-return.js', () => ({
  rememberReturnPath: (...args: unknown[]) => rememberReturnPath(...args),
}));

describe('UpdatedElsewhereOverlay (spec 2026-09-26 §2.5 point 2)', () => {
  beforeEach(() => {
    _resetAppUpdateForTests();
    rememberReturnPath.mockClear();
  });

  it('renders nothing while updatedElsewhere is false', () => {
    const { container } = render(<UpdatedElsewhereOverlay />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the alertdialog with a single Reload button once updated elsewhere', () => {
    useAppUpdateStore.getState().markUpdatedElsewhere();
    render(<UpdatedElsewhereOverlay />);
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Chatsundere was updated in another window.');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('focuses the Reload button on mount', () => {
    useAppUpdateStore.getState().markUpdatedElsewhere();
    render(<UpdatedElsewhereOverlay />);
    expect(screen.getByRole('button', { name: 'Reload' })).toBe(document.activeElement);
  });

  it('keeps focus on Reload and prevents default when Tab is pressed', () => {
    useAppUpdateStore.getState().markUpdatedElsewhere();
    render(<UpdatedElsewhereOverlay />);
    const dialog = screen.getByRole('alertdialog');
    const reloadButton = screen.getByRole('button', { name: 'Reload' });

    const notCancelled = fireEvent.keyDown(dialog, { key: 'Tab' });

    expect(notCancelled).toBe(false); // false means preventDefault() was called
    expect(reloadButton).toBe(document.activeElement);
  });

  it('portals the scrim to document.body above every other layer', () => {
    useAppUpdateStore.getState().markUpdatedElsewhere();
    const { container } = render(<UpdatedElsewhereOverlay />);
    const scrim = document.querySelector('.updated-elsewhere-scrim');
    expect(scrim?.parentElement).toBe(document.body);
    expect(container.contains(scrim)).toBe(false);
    expect((scrim as HTMLElement | null)?.style.zIndex).toBe('2147483000');
  });

  it('makes #root inert while shown and releases it on unmount', () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
    try {
      useAppUpdateStore.getState().markUpdatedElsewhere();
      const { unmount } = render(<UpdatedElsewhereOverlay />, { container: root });
      expect(root.hasAttribute('inert')).toBe(true);
      unmount();
      expect(root.hasAttribute('inert')).toBe(false);
    } finally {
      root.remove();
    }
  });

  it('leaves #root interactive while not updated elsewhere', () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
    try {
      render(<UpdatedElsewhereOverlay />, { container: root });
      expect(root.hasAttribute('inert')).toBe(false);
    } finally {
      root.remove();
    }
  });

  it('remembers the return path and reloads on click', () => {
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: vi.fn(), pathname: '/app/chat/c1', search: '' },
    });

    try {
      useAppUpdateStore.getState().markUpdatedElsewhere();
      render(<UpdatedElsewhereOverlay />);
      fireEvent.click(screen.getByRole('button', { name: 'Reload' }));

      expect(rememberReturnPath).toHaveBeenCalledTimes(1);
      expect(window.location.reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    }
  });
});
