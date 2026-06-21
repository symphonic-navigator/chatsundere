// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import 'fake-indexeddb/auto';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { Toast } from '../../src/components/Toast.js';
import { addJournalEntries, commitEntry, saveBody } from '../../src/memory/repo.js';
import { PersonaMemory } from '../../src/routes/app/persona-memory.js';

function setup(initialPath: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/app/persona/:id/memory" element={<PersonaMemory />} />
          <Route
            path="/app/persona/:id"
            element={<div data-testid="editor-sentinel">editor</div>}
          />
          <Route path="/app/chat/:chatId" element={<div data-testid="chat-sentinel">chat</div>} />
        </Routes>
      </MemoryRouter>
      <Toast />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  // Minimal persona row — only fields the page reads must be present.
  await getClientDataDb().personas.add({ id: 'p1', name: 'Fable' } as never);
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

describe('PersonaMemory — shell', () => {
  it('renders the persona name and Memory heading', async () => {
    setup('/app/persona/p1/memory');
    expect(await screen.findByRole('heading', { level: 1, name: /memory/i })).toBeInTheDocument();
    expect(screen.getByText('Fable')).toBeInTheDocument();
  });

  it('back goes to the chat when ?chat= is present', async () => {
    setup('/app/persona/p1/memory?chat=c1');
    fireEvent.click(await screen.findByRole('button', { name: /back to chat/i }));
    expect(screen.getByTestId('chat-sentinel')).toBeInTheDocument();
  });

  it('back goes to the persona editor when no ?chat= is present', async () => {
    setup('/app/persona/p1/memory');
    fireEvent.click(await screen.findByRole('button', { name: /back to fable/i }));
    await waitFor(() => expect(screen.getByTestId('editor-sentinel')).toBeInTheDocument());
  });
});

describe('PersonaMemory — entries', () => {
  it('lists a pending entry and commits it', async () => {
    await addJournalEntries('p1', [
      { content: 'Likes hiking', category: 'preference', isCorrection: false },
    ]);
    setup('/app/persona/p1/memory?chat=c1');
    expect(await screen.findByText('Likes hiking')).toBeInTheDocument();
    const commitBtn = screen.getByRole('button', { name: /commit/i });
    await userEvent.click(commitBtn);
    // After commit, entry moves to committed section and should not be in pending anymore
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /commit/i })).not.toBeInTheDocument(),
    );
    expect(await screen.findByText(/awaiting consolidation/i)).toBeInTheDocument();
  });

  it('edits a pending entry', async () => {
    await addJournalEntries('p1', [{ content: 'old text', category: 'fact', isCorrection: false }]);
    setup('/app/persona/p1/memory?chat=c1');
    await userEvent.click(await screen.findByRole('button', { name: /edit/i }));
    const box = screen.getByLabelText(/edit memory/i);
    await userEvent.clear(box);
    await userEvent.type(box, 'new text');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText('new text')).toBeInTheDocument();
  });

  it('deletes a pending entry but Undo restores it', async () => {
    await addJournalEntries('p1', [{ content: 'fragile', category: 'fact', isCorrection: false }]);
    setup('/app/persona/p1/memory?chat=c1');
    await userEvent.click(await screen.findByRole('button', { name: /delete/i }));
    await waitFor(() => expect(screen.queryByText('fragile')).not.toBeInTheDocument());
    await userEvent.click(await screen.findByRole('button', { name: /undo/i }));
    expect(await screen.findByText('fragile')).toBeInTheDocument();
  });

  it('shows committed entries with edit + delete', async () => {
    await addJournalEntries('p1', [
      { content: 'already known', category: 'fact', isCorrection: false },
    ]);
    const [row] = await import('../../src/memory/repo.js').then((m) =>
      m.listJournal('p1', 'uncommitted'),
    );
    if (row) await commitEntry(row.id);
    setup('/app/persona/p1/memory?chat=c1');
    expect(await screen.findByText('already known')).toBeInTheDocument();
    expect(screen.getByText(/awaiting consolidation/i)).toBeInTheDocument();
  });
});

describe('PersonaMemory — body', () => {
  it('shows the current body and saves an edit as a new version', async () => {
    await saveBody('p1', 'remembers v1', 0, 'manual');
    setup('/app/persona/p1/memory');
    const box = await screen.findByLabelText(/memory body/i);
    expect(box).toHaveValue('remembers v1');
    await userEvent.clear(box);
    await userEvent.type(box, 'remembers v2');
    await userEvent.click(screen.getByRole('button', { name: /save memory/i }));
    await waitFor(() => expect(screen.getByText(/v2 ·/i)).toBeInTheDocument());
  });

  it('restores an older version', async () => {
    await saveBody('p1', 'first', 0, 'manual'); // v1
    await saveBody('p1', 'second', 0, 'manual'); // v2
    setup('/app/persona/p1/memory');
    await screen.findByText(/v2 ·/i);
    await userEvent.click(screen.getByRole('button', { name: /restore/i }));
    // restore re-saves the chosen version as a new newest version (v3)
    await waitFor(() => expect(screen.getByText(/v3 ·/i)).toBeInTheDocument());
  });

  it('shows an empty state when nothing is remembered yet', async () => {
    setup('/app/persona/p1/memory');
    expect(await screen.findByText(/nothing remembered yet/i)).toBeInTheDocument();
  });
});

describe('PersonaMemory — actions gating', () => {
  it('shows the actions block on the chat path', async () => {
    setup('/app/persona/p1/memory?chat=c1');
    expect(
      await screen.findByRole('button', { name: /learn from this chat/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /consolidate now/i })).toBeInTheDocument();
  });

  it('omits the actions block and shows an orientation line on the editor path', async () => {
    setup('/app/persona/p1/memory');
    await screen.findByRole('heading', { level: 1, name: /memory/i });
    expect(screen.queryByRole('button', { name: /learn from this chat/i })).not.toBeInTheDocument();
    expect(screen.getByText(/open a chat with fable/i)).toBeInTheDocument();
  });
});
