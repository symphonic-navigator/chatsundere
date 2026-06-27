// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { TypeTabs } from '../../src/components/treasury/TypeTabs.js';

test('renders five segments incl. Images, marks the active one, reports changes', () => {
  const onChange = vi.fn();
  render(<TypeTabs value="all" onChange={onChange} />);
  expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
  // The image segment is spelled out, consistent with Apps/Docs/Code.
  expect(screen.getByRole('tab', { name: 'Images' })).toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: 'Img' })).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'Docs' }));
  expect(onChange).toHaveBeenCalledWith('doc');
});
