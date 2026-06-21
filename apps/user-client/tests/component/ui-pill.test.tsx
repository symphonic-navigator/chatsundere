// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Pill } from '../../src/components/ui/Pill.js';

describe('Pill', () => {
  it('is interactive (a Pill acts) and fires onClick', () => {
    const onClick = vi.fn();
    render(<Pill onClick={onClick}>Personas</Pill>);
    const pill = screen.getByRole('button', { name: 'Personas' });
    fireEvent.click(pill);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('reflects the active state via data-active', () => {
    render(<Pill active>All</Pill>);
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('data-active', 'true');
  });

  it('renders a remove control and fires onRemove without firing onClick', () => {
    const onClick = vi.fn();
    const onRemove = vi.fn();
    render(
      <Pill variant="tag" onClick={onClick} onRemove={onRemove}>
        #fiction
      </Pill>,
    );
    fireEvent.click(screen.getByRole('button', { name: /remove #fiction/i }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });
});
