// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { OverflowMenu } from '../../src/components/ui/OverflowMenu.js';

test('renders a non-interactive separator between item groups', () => {
  const onA = vi.fn();
  render(
    <OverflowMenu
      items={[
        { label: 'New chat', onSelect: onA },
        { separator: true },
        { label: 'Delete', tone: 'destructive', onSelect: vi.fn() },
      ]}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
  expect(screen.getByTestId('cs-overflow-sep')).toBeInTheDocument();
  expect(screen.getAllByRole('menuitem')).toHaveLength(2);
  fireEvent.click(screen.getByText('New chat'));
  expect(onA).toHaveBeenCalledOnce();
});
