// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SeedTemplateRow } from '../../src/boot/client-data-db.js';

vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: () => ({ onHelp: vi.fn(), helpOverlay: null }),
}));

let mockTemplates: SeedTemplateRow[] = [];
let mockMode: 'nsfw' | 'sfw' = 'nsfw';

vi.mock('../../src/data/seed-templates.js', () => ({
  useFilteredSeedTemplates: () => ({
    data: mockTemplates.filter((t) => mockMode === 'nsfw' || !t.nsfw),
  }),
}));

import { TreasuryTemplatesList } from '../../src/routes/app/treasury/templates.js';

function tpl(over: Partial<SeedTemplateRow> = {}): SeedTemplateRow {
  return {
    id: 't1',
    name: 'Primer',
    description: '',
    nsfw: false,
    greeting: null,
    body: [
      { role: 'user', text: 'a' },
      { role: 'persona', text: 'b' },
    ],
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

function renderList() {
  return render(
    <MemoryRouter initialEntries={['/app/treasury/templates']}>
      <Routes>
        <Route path="/app/treasury/templates" element={<TreasuryTemplatesList />} />
        <Route path="/app/treasury/templates/new" element={<div>NEW TEMPLATE PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockTemplates = [];
  mockMode = 'nsfw';
});

describe('TreasuryTemplatesList', () => {
  it('shows both templates in NSFW mode, including a turn-count meta', () => {
    mockTemplates = [
      tpl({ id: 'a', name: 'Safe one' }),
      tpl({ id: 'b', name: 'Adult one', nsfw: true }),
    ];
    renderList();
    expect(screen.getByText('Safe one')).toBeTruthy();
    expect(screen.getByText('Adult one')).toBeTruthy();
    expect(screen.getAllByText(/2 turns/).length).toBeGreaterThan(0);
  });

  it('hides the NSFW template in SFW mode', () => {
    mockMode = 'sfw';
    mockTemplates = [
      tpl({ id: 'a', name: 'Safe one' }),
      tpl({ id: 'b', name: 'Adult one', nsfw: true }),
    ];
    renderList();
    expect(screen.getByText('Safe one')).toBeTruthy();
    expect(screen.queryByText('Adult one')).toBeNull();
  });

  it('shows a greeting marker in the meta when present', () => {
    mockTemplates = [tpl({ greeting: 'hi there' })];
    renderList();
    expect(screen.getByText(/greeting · 2 turns/)).toBeTruthy();
  });

  it('navigates to /new on + Add', () => {
    renderList();
    fireEvent.click(screen.getByRole('button', { name: /\+ add/i }));
    expect(screen.getByText('NEW TEMPLATE PAGE')).toBeTruthy();
  });

  it('renders an empty state when there are no templates', () => {
    renderList();
    expect(screen.getByText(/no templates yet/i)).toBeTruthy();
  });
});
