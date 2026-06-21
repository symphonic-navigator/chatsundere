// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../../src/components/ui/Button.js';

describe('Button', () => {
  it('renders children inside a real button element', () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn.tagName).toBe('BUTTON');
  });

  it('defaults to the neutral tone', () => {
    render(<Button>Cancel</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('data-tone', 'neutral');
  });

  it('applies the priority (gold) overlay for a primary button', () => {
    render(
      <Button tone="primary" priority>
        Save
      </Button>,
    );
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('data-tone', 'primary');
    expect(btn).toHaveAttribute('data-priority', 'true');
  });

  it('never marks a destructive button as priority (gold never invites destruction)', () => {
    render(
      <Button tone="destructive" priority>
        Delete
      </Button>,
    );
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('data-tone', 'destructive');
    expect(btn).not.toHaveAttribute('data-priority');
  });

  it('forwards onClick and disabled', () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Go</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(
      <Button onClick={onClick} disabled>
        Go
      </Button>,
    );
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
