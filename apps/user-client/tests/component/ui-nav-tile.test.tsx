// tests/component/ui-nav-tile.test.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { Users } from 'lucide-react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NavTile } from '../../src/components/ui/NavTile.js';
import { useNavTransitionStore } from '../../src/state/nav-transition.store.js';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}));

// Reduced motion → true so useNavZoom navigates synchronously in tests.
vi.mock('@chatsundere/ui-shared', () => ({
  motion: { respectsReducedMotion: () => true },
}));

function renderTile(props: Partial<React.ComponentProps<typeof NavTile>> = {}) {
  return render(
    <MemoryRouter>
      <NavTile
        colour="pink"
        icon={Users}
        label="My Circle"
        meta="7 personas"
        to="/app/circle"
        {...props}
      />
    </MemoryRouter>,
  );
}

describe('NavTile', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    useNavTransitionStore.setState({ originRect: null, lastOrigin: null });
  });

  it('renders label + meta and carries the colour plane', () => {
    renderTile();
    const tile = screen.getByRole('button', { name: /My Circle/ });
    expect(tile).toHaveAttribute('data-colour', 'pink');
    expect(screen.getByText('7 personas')).toBeInTheDocument();
  });

  it('arms the transition store and navigates on tap (reduced motion → synchronous)', () => {
    renderTile();
    fireEvent.click(screen.getByRole('button', { name: /My Circle/ }));
    expect(useNavTransitionStore.getState().lastOrigin).not.toBeNull();
    expect(mockNavigate).toHaveBeenCalledWith('/app/circle');
  });

  it('gold variant carries data-gold', () => {
    renderTile({ gold: true });
    expect(screen.getByRole('button', { name: /My Circle/ })).toHaveAttribute('data-gold', 'true');
  });

  it('disabled: focusable, announces reason, does not navigate', () => {
    renderTile({ disabled: true, disabledReason: 'Coming after the alpha', to: undefined });
    const tile = screen.getByRole('button', { name: /My Circle/ });
    expect(tile).toHaveAttribute('aria-disabled', 'true');
    expect(tile).toHaveAttribute('tabindex', '0');
    expect(tile).toHaveAttribute('title', 'Coming after the alpha');
    fireEvent.click(tile);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('renders a body override instead of label when children given', () => {
    renderTile({ children: <span>Continue body</span>, label: 'unused' });
    expect(screen.getByText('Continue body')).toBeInTheDocument();
  });
});
