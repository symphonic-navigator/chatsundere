// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ListScaffold } from '../../src/components/ui/ListScaffold.js';

describe('ListScaffold', () => {
  it('renders a back control with an accessible name and fires onBack', () => {
    const onBack = vi.fn();
    render(
      <ListScaffold title="My Circle" onBack={onBack}>
        <div>rows</div>
      </ListScaffold>,
    );
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('shows the title with count and a fixed footer', () => {
    render(
      <ListScaffold
        title="My Circle"
        count={13}
        onBack={() => {}}
        footer={<button type="button">+ New</button>}
      >
        <div>rows</div>
      </ListScaffold>,
    );
    expect(screen.getByText('My Circle')).toBeInTheDocument();
    expect(screen.getByText('13')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ New' })).toBeInTheDocument();
  });

  it('renders the constructive empty state instead of children when empty', () => {
    render(
      <ListScaffold
        title="My Circle"
        onBack={() => {}}
        isEmpty
        empty={<p>No personas yet — create your first</p>}
      >
        <div>rows</div>
      </ListScaffold>,
    );
    expect(screen.getByText(/no personas yet/i)).toBeInTheDocument();
    expect(screen.queryByText('rows')).not.toBeInTheDocument();
  });

  it('puts only the list in the scroll region (header and footer are siblings of it)', () => {
    const { container } = render(
      <ListScaffold title="My Circle" onBack={() => {}} footer={<span>foot</span>}>
        <div>rows</div>
      </ListScaffold>,
    );
    const scroll = container.querySelector('.cs-scaffold-scroll');
    expect(scroll).toBeTruthy();
    expect(scroll?.textContent).toContain('rows');
    expect(scroll?.textContent).not.toContain('foot'); // footer is outside the scroll region
  });
});
