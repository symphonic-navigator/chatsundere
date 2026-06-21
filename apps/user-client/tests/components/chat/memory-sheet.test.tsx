// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type PersonaRow,
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../../src/boot/client-data-db.js';
import { MemorySheet } from '../../../src/components/chat/MemorySheet.js';
import { addJournalEntries } from '../../../src/memory/repo.js';

const persona = { id: 'p1', name: 'Fable' } as PersonaRow;

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

describe('MemorySheet', () => {
  it('lists uncommitted entries and commits one', async () => {
    await addJournalEntries('p1', [
      { content: 'Likes hiking', category: 'preference', isCorrection: false },
    ]);
    wrap(<MemorySheet persona={persona} chatId="c1" onClose={() => {}} />);
    expect(await screen.findByText('Likes hiking')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /commit/i }));
    await waitFor(() => expect(screen.queryByText('Likes hiking')).not.toBeInTheDocument());
  });

  it('shows an empty state when there is nothing pending', async () => {
    wrap(<MemorySheet persona={persona} chatId="c1" onClose={() => {}} />);
    expect(await screen.findByText(/Fable will start to remember/i)).toBeInTheDocument();
  });
});
