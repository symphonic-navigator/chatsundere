// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { UiShowcase } from '../../src/routes/app/ui-showcase.js';

describe('UiShowcase', () => {
  it('renders the primitive sections', () => {
    render(
      <MemoryRouter>
        <UiShowcase />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Buttons/i)).toBeInTheDocument();
    expect(screen.getByText(/Badges/i)).toBeInTheDocument();
    expect(screen.getByText(/Pills/i)).toBeInTheDocument();
    expect(screen.getByText(/List/i)).toBeInTheDocument();
  });

  it('opens the confirmation dialog from its trigger', () => {
    render(
      <MemoryRouter>
        <UiShowcase />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // fireEvent.click (not .click()) so React 18 state flush is wrapped in act()
    fireEvent.click(screen.getByRole('button', { name: /open save dialog/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
