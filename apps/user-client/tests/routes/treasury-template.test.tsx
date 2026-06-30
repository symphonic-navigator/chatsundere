// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: () => ({ onHelp: vi.fn(), helpOverlay: null }),
}));

let mockMode: 'nsfw' | 'sfw' = 'nsfw';
const createMutate = vi.fn().mockResolvedValue('new-id');

vi.mock('../../src/data/settings.js', () => ({
  useAdultMode: () => ({ mode: mockMode }),
}));
vi.mock('../../src/data/seed-templates.js', () => ({
  useSeedTemplate: () => ({ data: undefined, isLoading: false }),
  useCreateSeedTemplate: () => ({ mutateAsync: createMutate }),
  useUpdateSeedTemplate: () => ({ mutateAsync: vi.fn() }),
  useDeleteSeedTemplate: () => ({ mutate: vi.fn() }),
}));

import { TreasuryTemplatePage } from '../../src/routes/app/treasury/template.js';

function renderCreate() {
  return render(
    <MemoryRouter initialEntries={['/app/treasury/templates/new']}>
      <Routes>
        <Route path="/app/treasury/templates/new" element={<TreasuryTemplatePage />} />
        <Route path="/app/treasury/templates" element={<div>TEMPLATES LIST</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockMode = 'nsfw';
  createMutate.mockClear();
});

describe('TreasuryTemplatePage — create mode', () => {
  it('shows the author-here/apply-there signpost', () => {
    renderCreate();
    expect(screen.getByText(/you build a primer here/i)).toBeTruthy();
  });

  it('disables Save until the template is applyable', () => {
    renderCreate();
    const save = screen.getByRole('button', { name: /^save$/i });
    expect(save).toBeDisabled();
    // Enable the greeting and type something → applyable.
    fireEvent.click(screen.getByRole('button', { name: /opening greeting/i }));
    fireEvent.change(screen.getByLabelText(/greeting text/i), { target: { value: 'Hi there' } });
    expect(screen.getByRole('button', { name: /^save$/i })).not.toBeDisabled();
  });

  it('reveals and hides the greeting text area via its toggle', () => {
    renderCreate();
    expect(screen.queryByLabelText(/greeting text/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /opening greeting/i }));
    expect(screen.getByLabelText(/greeting text/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /opening greeting/i }));
    expect(screen.queryByLabelText(/greeting text/i)).toBeNull();
  });

  it('appends turns whose labels alternate you → persona', () => {
    renderCreate();
    fireEvent.click(screen.getByRole('button', { name: /add your turn/i }));
    expect(screen.getByLabelText(/you turn 1/i)).toBeTruthy();
    // The add button now offers a persona turn next.
    fireEvent.click(screen.getByRole('button', { name: /add persona turn/i }));
    expect(screen.getByLabelText(/persona turn 2/i)).toBeTruthy();
  });

  it('re-labels remaining turns after a middle deletion', () => {
    renderCreate();
    fireEvent.click(screen.getByRole('button', { name: /add your turn/i }));
    fireEvent.click(screen.getByRole('button', { name: /add persona turn/i }));
    fireEvent.click(screen.getByRole('button', { name: /add your turn/i }));
    // Delete the first (You) turn → the former persona turn becomes You.
    const [firstDelete] = screen.getAllByRole('button', { name: /delete turn/i });
    if (!firstDelete) throw new Error('no delete button');
    fireEvent.click(firstDelete);
    expect(screen.getByLabelText(/you turn 1/i)).toBeTruthy();
    expect(screen.getByLabelText(/persona turn 2/i)).toBeTruthy();
  });

  it('shows a calm hint when the last turn is a user turn', () => {
    renderCreate();
    fireEvent.click(screen.getByRole('button', { name: /add your turn/i }));
    fireEvent.change(screen.getByLabelText(/you turn 1/i), { target: { value: 'hey' } });
    expect(screen.getByText(/the last turn is yours/i)).toBeTruthy();
  });

  it('locks the NSFW toggle in SFW mode with a reason', () => {
    mockMode = 'sfw';
    renderCreate();
    const toggle = screen.getByRole('button', { name: /adult \(nsfw\)/i });
    expect(toggle).toBeDisabled();
    expect(screen.getByText(/turn on adult mode first/i)).toBeTruthy();
  });
});
