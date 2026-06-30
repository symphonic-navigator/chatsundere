// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SeedTemplateRow } from '../../src/boot/client-data-db.js';

let mockTemplates: SeedTemplateRow[] = [];
let mockMode: 'nsfw' | 'sfw' = 'nsfw';

vi.mock('../../src/data/seed-templates.js', () => ({
  useFilteredSeedTemplates: () => ({
    data: mockTemplates.filter((t) => mockMode === 'nsfw' || !t.nsfw),
  }),
}));

import { SeedTemplatePicker } from '../../src/components/chat/SeedTemplatePicker.js';

function tpl(over: Partial<SeedTemplateRow> = {}): SeedTemplateRow {
  return {
    id: 't1',
    name: 'Primer',
    description: '',
    nsfw: false,
    greeting: null,
    body: [{ role: 'user', text: 'a' }],
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

beforeEach(() => {
  mockTemplates = [];
  mockMode = 'nsfw';
});

describe('SeedTemplatePicker', () => {
  it('lists NSFW-filtered templates and calls onSelect on a row tap', () => {
    mockMode = 'sfw';
    mockTemplates = [
      tpl({ id: 'a', name: 'Safe one' }),
      tpl({ id: 'b', name: 'Adult one', nsfw: true }),
    ];
    const onSelect = vi.fn();
    render(<SeedTemplatePicker open onClose={() => {}} onSelect={onSelect} />);
    expect(screen.getByText('Safe one')).toBeTruthy();
    expect(screen.queryByText('Adult one')).toBeNull();
    fireEvent.click(screen.getByText('Safe one'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]?.id).toBe('a');
  });

  it('shows an empty hint pointing at Treasury when there are none', () => {
    render(<SeedTemplatePicker open onClose={() => {}} onSelect={() => {}} />);
    expect(screen.getByText(/no templates yet/i)).toBeTruthy();
  });
});
