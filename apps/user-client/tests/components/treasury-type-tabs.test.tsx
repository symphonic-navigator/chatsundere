// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { TypeTabs } from '../../src/components/treasury/TypeTabs.js';

test('renders five tabs, marks the active one, and reports changes', () => {
  const onChange = vi.fn();
  render(<TypeTabs value="all" onChange={onChange} />);
  expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(screen.getByRole('tab', { name: 'Docs' }));
  expect(onChange).toHaveBeenCalledWith('doc');
});
