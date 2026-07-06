// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { OnboardingMatrix } from '../../src/routes/onboarding/matrix.js';

describe('OnboardingMatrix', () => {
  it('renders all four cells as active links (no aria-disabled)', () => {
    render(
      <MemoryRouter>
        <OnboardingMatrix />
      </MemoryRouter>,
    );
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(4);
    expect(document.querySelector('[aria-disabled="true"]')).toBeNull();
    expect(screen.getByText('I have an invitation')).toBeDefined();
    expect(screen.getByText('Add this device')).toBeDefined();
    expect(screen.getByText('Use a recovery key')).toBeDefined();
    expect(screen.getByText('Just this device')).toBeDefined();
  });
});
