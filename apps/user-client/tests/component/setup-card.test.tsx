// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SetupCard } from '../../src/components/SetupCard.js';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}));

// Reduced motion → true so useNavZoom navigates synchronously in tests.
vi.mock('@chatsundere/ui-shared', () => ({
  motion: { respectsReducedMotion: () => true },
}));

describe('SetupCard', () => {
  beforeEach(() => mockNavigate.mockReset());

  it('lists only the given steps as focusable buttons and navigates on tap', () => {
    render(
      <MemoryRouter>
        <SetupCard steps={[{ label: 'Connect a provider', to: '/app/settings' }]} />
      </MemoryRouter>,
    );
    // Each step is a real <button> (keyboard-reachable), not a clickable span.
    const step = screen.getByRole('button', { name: /Connect a provider/ });
    expect(screen.queryByRole('button', { name: /Create your first companion/ })).toBeNull();
    fireEvent.click(step);
    expect(mockNavigate).toHaveBeenCalledWith('/app/settings');
  });

  it('wears the gold Crown treatment and carries data-static', () => {
    const { container } = render(
      <MemoryRouter>
        <SetupCard steps={[{ label: 'Create your first companion', to: '/app/persona/new' }]} />
      </MemoryRouter>,
    );
    const card = container.querySelector('.cs-navtile');
    expect(card).toHaveAttribute('data-gold', 'true');
    expect(card).toHaveAttribute('data-wide', 'true');
    expect(card).toHaveAttribute('data-static', 'true');
  });
});
