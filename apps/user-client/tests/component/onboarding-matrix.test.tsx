// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { OnboardingMatrix } from '../../src/routes/onboarding/matrix.js';

describe('OnboardingMatrix', () => {
  function renderMatrix() {
    return render(
      <MemoryRouter>
        <OnboardingMatrix />
      </MemoryRouter>,
    );
  }

  it('renders all four intents as active NavTiles (no aria-disabled)', () => {
    renderMatrix();
    // NavTiles are role="button" divs, not <Link> anchors (design-language port).
    const tiles = screen.getAllByRole('button');
    expect(tiles).toHaveLength(4);
    expect(document.querySelector('[aria-disabled="true"]')).toBeNull();
    expect(screen.getByText('I have an invitation')).toBeDefined();
    expect(screen.getByText('Link this device to my account')).toBeDefined();
    expect(screen.getByText('Use a recovery key')).toBeDefined();
    expect(screen.getByText('Just this device')).toBeDefined();
  });

  it('shows the Welcome eyebrow and the Chatsundere wordmark', () => {
    renderMatrix();
    expect(screen.getByText('Welcome')).toBeDefined();
    expect(screen.getByText('Chatsundere')).toBeDefined();
  });

  it('gives the two account-backed heroes the gold overlay; local stays full-opacity purple', () => {
    renderMatrix();
    const gold = document.querySelectorAll('[data-gold="true"]');
    expect(gold).toHaveLength(2);
    // The local tile is purple and carries no dimming hook (hierarchy, not opacity).
    const local = screen.getByRole('button', { name: 'Just this device' });
    expect(local).toHaveAttribute('data-colour', 'purple');
    expect(local).not.toHaveAttribute('data-gold');
    expect(document.querySelector('[data-muted]')).toBeNull();
  });

  it('renders tiles at standard menu height (no full-height fill variant)', () => {
    renderMatrix();
    expect(document.querySelector('[data-fill]')).toBeNull();
  });
});
