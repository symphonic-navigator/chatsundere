// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageBar } from '../../src/components/ui/PageBar.js';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}));

describe('PageBar', () => {
  beforeEach(() => mockNavigate.mockReset());

  function renderBar(onHelp?: (el: HTMLElement) => void) {
    return render(
      <MemoryRouter>
        <PageBar
          back="/app/account"
          crumbs={[{ label: 'My Account', to: '/app/account' }, { label: 'Biometric' }]}
          onHelp={onHelp}
        />
      </MemoryRouter>,
    );
  }

  it('marks the current (last) crumb and does not make it a button', () => {
    renderBar();
    const current = screen.getByText('Biometric');
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('button', { name: 'Biometric' })).toBeNull();
  });

  it('ancestor crumb navigates to its route', () => {
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'My Account' }));
    expect(mockNavigate).toHaveBeenCalledWith('/app/account');
  });

  it('the back control navigates to `back` and has a ≥44px hit area label', () => {
    renderBar();
    const back = screen.getByRole('button', { name: 'Back' });
    fireEvent.click(back);
    expect(mockNavigate).toHaveBeenCalledWith('/app/account');
  });

  it('renders the help affordance only when onHelp is given, and calls it with the button element', () => {
    const onHelp = vi.fn();
    const { rerender } = renderBar(onHelp);
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(onHelp).toHaveBeenCalledOnce();
    expect(onHelp.mock.calls[0]?.[0]).toBeInstanceOf(HTMLElement);
    rerender(
      <MemoryRouter>
        <PageBar back="/app" crumbs={[{ label: 'My Account' }]} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: 'Help' })).toBeNull();
  });
});
