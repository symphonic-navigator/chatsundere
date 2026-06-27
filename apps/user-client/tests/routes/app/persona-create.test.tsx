// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../../src/boot/client-data-db.js';
import { PersonaCreate } from '../../../src/routes/app/persona/create.js';

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/app/persona/new']}>
        <Routes>
          <Route path="/app/persona/new" element={<PersonaCreate />} />
          <Route path="/app/persona/:id" element={<div data-testid="persona-hub" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await openClientDataDb();
});
afterEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
});

describe('PersonaCreate', () => {
  it('(a) Create button is disabled with an empty name and enabled after typing a name', async () => {
    wrap();
    const btn = await screen.findByRole('button', { name: /create persona/i });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: /^name$/i }), {
      target: { value: 'Aria' },
    });
    expect(btn).not.toBeDisabled();
  });

  it('(b) clicking Create adds a persona row to the DB and navigates to /app/persona/<id>', async () => {
    wrap();
    fireEvent.change(await screen.findByRole('textbox', { name: /^name$/i }), {
      target: { value: 'Aria' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create persona/i }));
    await waitFor(() => expect(screen.getByTestId('persona-hub')).toBeInTheDocument());
    const personas = await getClientDataDb().personas.toArray();
    expect(personas).toHaveLength(1);
    expect(personas[0]?.name).toBe('Aria');
  });
});
