// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Badge } from '../../src/components/ui/Badge.js';
import { ListRow } from '../../src/components/ui/ListRow.js';

describe('ListRow', () => {
  it('renders the three slots', () => {
    render(
      <ListRow
        leading={<span>AV</span>}
        title="Fable"
        subtitle="flagship companion"
        trailing={<Badge>42 chats</Badge>}
      />,
    );
    expect(screen.getByText('AV')).toBeInTheDocument();
    expect(screen.getByText('Fable')).toBeInTheDocument();
    expect(screen.getByText('flagship companion')).toBeInTheDocument();
    expect(screen.getByText('42 chats')).toBeInTheDocument();
  });

  it('fires onOpen when the row is tapped', () => {
    const onOpen = vi.fn();
    render(<ListRow title="Fable" onOpen={onOpen} />);
    fireEvent.click(screen.getByText('Fable'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('opening the ⋯ menu does not trigger the row onOpen', () => {
    const onOpen = vi.fn();
    render(<ListRow title="Fable" onOpen={onOpen} overflow={[{ label: 'Rename' }]} />);
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
  });
});
