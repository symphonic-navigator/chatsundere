// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../../src/boot/client-data-db.js';
import { KnowledgeList } from '../../../src/routes/app/knowledge.js';
import { KnowledgeLibraryPage } from '../../../src/routes/app/knowledge/library.js';

beforeEach(async () => {
  await openClientDataDb();
  await getClientDataDb().settings.update(1, { adultMode: 'sfw' });
});
afterEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
});

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/app/knowledge']}>
        <Routes>
          <Route path="/app/knowledge" element={<KnowledgeList />} />
          <Route path="/app/knowledge/new" element={<KnowledgeLibraryPage />} />
          <Route path="/app/knowledge/:libraryId" element={<KnowledgeLibraryPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('KnowledgeList', () => {
  it('shows an empty state when there are no libraries', async () => {
    wrap();
    expect(await screen.findByText(/no libraries yet/i)).toBeTruthy();
  });

  it('creates a library through the new-library page', async () => {
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: /\+ add/i }));
    fireEvent.change(await screen.findByLabelText(/name/i), { target: { value: 'World Lore' } });
    fireEvent.click(screen.getByRole('button', { name: /create library/i }));
    expect(await screen.findByText('World Lore')).toBeTruthy();
  });

  it('hides NSFW libraries in SFW mode', async () => {
    await getClientDataDb().libraries.add({
      id: 'n1',
      name: 'Adult Lore',
      description: '',
      nsfw: true,
      createdAt: 1,
      updatedAt: 1,
    });
    wrap();
    await waitFor(() => expect(screen.queryByText('Adult Lore')).toBeNull());
  });
});
