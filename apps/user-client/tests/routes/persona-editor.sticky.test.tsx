// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { PersonaEditor } from '../../src/routes/app/persona-editor.js';

function renderEditor(initial: '/app/persona/new' | '/app/persona/p-1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/app/persona/:id" element={<PersonaEditor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Persona Editor sticky region', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('in create mode wraps only the EditorTopbar in the sticky region (no quick-actions row)', async () => {
    renderEditor('/app/persona/new');
    await waitFor(() => expect(screen.getByLabelText(/back/i)).toBeInTheDocument());
    const back = screen.getByLabelText(/back/i);
    const sticky = back.closest('[data-editor-sticky]');
    expect(sticky).not.toBeNull();
    // Quick-actions should NOT be present in create mode.
    expect(screen.queryByText(/^Continue$/)).toBeNull();
    expect(screen.queryByText(/^New Chat$/)).toBeNull();
    expect(screen.queryByText(/^Incognito$/)).toBeNull();
  });
});
