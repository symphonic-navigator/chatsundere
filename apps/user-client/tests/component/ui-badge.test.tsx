// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge } from '../../src/components/ui/Badge.js';

describe('Badge', () => {
  it('renders read-only text and is NOT a button (a badge tells, it never acts)', () => {
    render(<Badge>13 personas</Badge>);
    const el = screen.getByText('13 personas');
    expect(el.tagName).toBe('SPAN');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('applies the tone via data-tone', () => {
    render(<Badge tone="success">Connected</Badge>);
    expect(screen.getByText('Connected')).toHaveAttribute('data-tone', 'success');
  });

  it('renders a count bubble when count is given', () => {
    render(<Badge count={3}>Inbox</Badge>);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('marks tile badges so the single tile-badge token applies', () => {
    render(<Badge onTile>13 personas</Badge>);
    expect(screen.getByText('13 personas')).toHaveAttribute('data-on-tile', 'true');
  });
});
