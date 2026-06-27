// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { Circle } from '../../src/routes/app/circle.js';

function renderCircle() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/app/circle']}>
        <Routes>
          <Route path="/app/circle" element={<Circle />} />
          <Route path="/app/persona/new" element={<div data-testid="persona-new" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Circle new-persona button', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('renders the labelled "New persona" button with a dark text colour so it stays visible on bg-paper', async () => {
    renderCircle();
    const btn = await screen.findByRole('button', { name: /new persona/i });
    expect(btn.className).toMatch(/\btext-ink\b/);
    expect(btn.className).not.toMatch(/\btext-bg\b/);
    expect(btn).toHaveTextContent('+');
  });

  it('navigates to the persona-create flow when tapped', async () => {
    renderCircle();
    fireEvent.click(await screen.findByRole('button', { name: /new persona/i }));
    await waitFor(() => expect(screen.getByTestId('persona-new')).toBeInTheDocument());
  });
});
