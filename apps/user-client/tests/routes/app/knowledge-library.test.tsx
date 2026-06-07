import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../../src/boot/client-data-db.js';
import { KnowledgeLibrary } from '../../../src/routes/app/knowledge-library.js';

vi.mock('../../../src/knowledge/start-ingestion.js', () => ({ enqueueDocument: () => {} }));

beforeEach(async () => {
  await openClientDataDb();
  await getClientDataDb().libraries.add({
    id: 'lib1',
    name: 'World Lore',
    description: '',
    nsfw: false,
    createdAt: 1,
    updatedAt: 1,
  });
});
afterEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
});

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/app/knowledge/lib1']}>
        <Routes>
          <Route path="/app/knowledge/:libraryId" element={<KnowledgeLibrary />} />
          <Route path="/app/knowledge" element={<div>list</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('KnowledgeLibrary', () => {
  it('shows the library name and an empty document state', async () => {
    wrap();
    expect(await screen.findByText('World Lore')).toBeTruthy();
    expect(screen.getByText(/no documents yet/i)).toBeTruthy();
  });

  it('adds a document by paste, listed as pending', async () => {
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: /add document/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /paste text/i }));
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Geography' } });
    fireEvent.change(screen.getByLabelText(/content/i), {
      target: { value: 'The northern reach.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(await screen.findByText('Geography')).toBeTruthy();
    expect(screen.getByText(/pending/i)).toBeTruthy();
  });

  it('edits the library name via the Edit sheet', async () => {
    wrap();
    // Wait for the library to load
    await screen.findByText('World Lore');

    // Open the edit sheet
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));

    // Change the name field
    const nameInput = screen.getByDisplayValue('World Lore');
    fireEvent.change(nameInput, { target: { value: 'New Name' } });

    // Submit
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    // The component reads the name from useLibraries() — after mutation the query refetches
    expect(await screen.findByText('New Name')).toBeTruthy();
  });

  it('deletes the library via inline confirm and navigates away', async () => {
    wrap();
    await screen.findByText('World Lore');

    // Open the delete confirm bar
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    // Confirm deletion
    const confirmBar = await screen.findByText(/delete this library/i);
    expect(confirmBar).toBeTruthy();

    // There are now two "Delete" buttons (header + confirm bar); click the one inside the bar
    const deleteButtons = screen.getAllByRole('button', { name: /^delete$/i });
    // The confirm-bar Delete is the last one rendered after the header Delete
    const confirmDeleteBtn = deleteButtons[deleteButtons.length - 1];
    if (!confirmDeleteBtn) throw new Error('confirm Delete button not found');
    fireEvent.click(confirmDeleteBtn);

    // Navigation target appears
    expect(await screen.findByText('list')).toBeTruthy();

    // Library is gone from DB
    const row = await getClientDataDb().libraries.get('lib1');
    expect(row).toBeUndefined();
  });
});
