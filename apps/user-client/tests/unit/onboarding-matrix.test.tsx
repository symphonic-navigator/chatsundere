// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { OnboardingMatrix } from '../../src/routes/onboarding/matrix.js';

function renderMatrix() {
  return render(
    <MemoryRouter>
      <OnboardingMatrix />
    </MemoryRouter>,
  );
}

describe('OnboardingMatrix — Block 1 gating', () => {
  it('renders "Just this device" as an active link', () => {
    renderMatrix();
    const localCell = screen.getByRole('link', { name: /just this device/i });
    expect(localCell).toHaveAttribute('href', '/onboarding/local');
  });

  it('renders the three server-coupled cells as disabled, not as links', () => {
    renderMatrix();
    for (const label of ['I have an invitation', 'Add this device', 'Use a recovery key']) {
      expect(screen.queryByRole('link', { name: new RegExp(label, 'i') })).toBeNull();
      const cell = screen.getByText(label).closest('[aria-disabled="true"]');
      expect(cell).not.toBeNull();
    }
  });

  it('surfaces a "Coming with Block 2" tooltip on each disabled cell', () => {
    renderMatrix();
    for (const label of ['I have an invitation', 'Add this device', 'Use a recovery key']) {
      const cell = screen.getByText(label).closest('[aria-disabled="true"]');
      expect(cell?.getAttribute('title')).toMatch(/block 2/i);
    }
  });
});
