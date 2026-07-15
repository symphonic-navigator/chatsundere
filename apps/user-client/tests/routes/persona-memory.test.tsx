// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import 'fake-indexeddb/auto';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { Toast } from '../../src/components/Toast.js';
import type { MemoryActionState } from '../../src/lib/use-memory-actions.js';
import { useMemoryActions } from '../../src/lib/use-memory-actions.js';
import { addJournalEntries, commitEntry, saveBody } from '../../src/memory/repo.js';
import { PersonaMemory } from '../../src/routes/app/persona-memory.js';

vi.mock('../../src/lib/use-memory-actions.js', () => ({
  useMemoryActions: vi.fn(),
}));

const mockedUseMemoryActions = vi.mocked(useMemoryActions);

/** Sets the mocked useMemoryActions() return value for one test. Unspecified
 *  fields default to idle/no-op, matching the hook's real initial state. */
function mockMemoryActions(
  overrides: {
    learnState?: MemoryActionState;
    consolidateState?: MemoryActionState;
    lastAttempted?: 'learn' | 'consolidate' | null;
    learnNow?: () => Promise<void>;
    consolidateNow?: () => Promise<void>;
  } = {},
) {
  mockedUseMemoryActions.mockReturnValue({
    learnState: overrides.learnState ?? { status: 'idle' },
    consolidateState: overrides.consolidateState ?? { status: 'idle' },
    learnNow: overrides.learnNow ?? vi.fn(),
    consolidateNow: overrides.consolidateNow ?? vi.fn(),
    lastAttempted: overrides.lastAttempted ?? null,
  });
}

function renderPage({ chat }: { chat?: string } = {}) {
  return setup(chat ? `/app/persona/p1/memory?chat=${chat}` : '/app/persona/p1/memory');
}

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
  await getClientDataDb().personas.add({ id: 'p1', name: 'Fable', useMemory: false } as never);
  mockMemoryActions();
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
    // PageBar renders the back control as aria-label="Back"
    fireEvent.click(await screen.findByRole('button', { name: /^back$/i }));
    expect(screen.getByTestId('chat-sentinel')).toBeInTheDocument();
  });

  it('back goes to the persona hub when no ?chat= is present', async () => {
    setup('/app/persona/p1/memory');
    await screen.findByRole('heading', { level: 1, name: /memory/i });
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
    await waitFor(() => expect(screen.getByTestId('editor-sentinel')).toBeInTheDocument());
  });
});

describe('PersonaMemory — persona-global settings', () => {
  it('renders the Remembering toggle with the persona-scope label', async () => {
    setup('/app/persona/p1/memory');
    // Scope label must be unmistakable — user must not mistake this for a per-chat switch.
    expect(await screen.findByText(/applies to all chats with fable/i)).toBeInTheDocument();
    // Toggle itself is present and reflects the current state.
    const toggle = screen.getByRole('button', { name: /^remembering$/i });
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  it('flipping the Remembering toggle writes useMemory to the persona', async () => {
    setup('/app/persona/p1/memory');
    await screen.findByText(/applies to all chats with fable/i);

    const toggle = screen.getByRole('button', { name: /^remembering$/i });
    await userEvent.click(toggle);

    await waitFor(async () => {
      const updated = await getClientDataDb().personas.get('p1');
      expect(updated?.useMemory).toBe(true);
    });
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

  it('omits the actions block and shows an orientation line on the hub path', async () => {
    setup('/app/persona/p1/memory');
    await screen.findByRole('heading', { level: 1, name: /memory/i });
    expect(screen.queryByRole('button', { name: /learn from this chat/i })).not.toBeInTheDocument();
    expect(screen.getByText(/open a chat with fable/i)).toBeInTheDocument();
  });
});

describe('PersonaMemory — action error copy', () => {
  // The page's own persona lookup resolves asynchronously (Dexie via react-query),
  // so these await the loaded copy rather than asserting synchronously — the
  // brief's snippet assumed a synchronously-available persona.
  it('renders the timeout copy for a consolidate timeout', async () => {
    mockMemoryActions({
      consolidateState: { status: 'error', error: 'timeout', partialSlices: 0 },
      lastAttempted: 'consolidate',
    });
    renderPage({ chat: 'c1' });
    expect(
      await screen.findByText(
        'The model took too long to answer. Nothing was lost — it may be busy; try again in a little while.',
      ),
    ).toBeInTheDocument();
  });

  it('renders the partial-progress copy when slices were checkpointed', async () => {
    mockMemoryActions({
      consolidateState: { status: 'error', error: 'timeout', partialSlices: 2 },
      lastAttempted: 'consolidate',
    });
    renderPage({ chat: 'c1' });
    expect(
      await screen.findByText(
        'Consolidated some of them — the rest are still below. Try again to finish.',
      ),
    ).toBeInTheDocument();
  });

  it('error slot and Retry follow the most recently attempted action', async () => {
    const learnNow = vi.fn();
    const consolidateNow = vi.fn();
    mockMemoryActions({
      learnState: { status: 'error', error: 'failed' },
      consolidateState: { status: 'error', error: 'upstream-busy' },
      lastAttempted: 'consolidate',
      learnNow,
      consolidateNow,
    });
    renderPage({ chat: 'c1' });
    expect(
      await screen.findByText(
        'Your AI provider is having trouble right now. Nothing was lost — try again in a few minutes.',
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(consolidateNow).toHaveBeenCalled();
    expect(learnNow).not.toHaveBeenCalled();
  });

  it('offers the debug view only when a model answer was captured', async () => {
    // No captured response → no inspect affordance (e.g. a timeout).
    mockMemoryActions({
      consolidateState: { status: 'error', error: 'timeout' },
      lastAttempted: 'consolidate',
    });
    const first = renderPage({ chat: 'c1' });
    await screen.findByRole('button', { name: 'Retry' });
    expect(screen.queryByRole('button', { name: /show the model's answer/i })).toBeNull();
    first.unmount();

    // A captured response → the quiet inspect button appears below Retry.
    mockMemoryActions({
      consolidateState: {
        status: 'error',
        error: 'invalid-output',
        response: { content: '', reasoning: 'I thought a lot', finishReason: 'stop' },
      },
      lastAttempted: 'consolidate',
    });
    renderPage({ chat: 'c1' });
    expect(
      await screen.findByRole('button', { name: /show the model's answer/i }),
    ).toBeInTheDocument();
  });

  it('opens the response overlay with reasoning and content split apart', async () => {
    mockMemoryActions({
      consolidateState: {
        status: 'error',
        error: 'invalid-output',
        response: {
          content: '',
          reasoning: 'The user likes cats.',
          finishReason: 'stop',
        },
      },
      lastAttempted: 'consolidate',
    });
    renderPage({ chat: 'c1' });
    await userEvent.click(await screen.findByRole('button', { name: /show the model's answer/i }));

    const overlay = await screen.findByTestId('memory-response');
    expect(overlay).toBeInTheDocument();
    // Reasoning surfaces verbatim; content shows the honest empty-state note.
    expect(screen.getByTestId('memory-response-reasoning')).toHaveTextContent(
      'The user likes cats.',
    );
    expect(screen.getByTestId('memory-response-content')).toHaveTextContent(
      'the model returned no content',
    );
    // The empty-content case is called out explicitly.
    expect(screen.getByText(/only reasoning \(or nothing\) came back/i)).toBeInTheDocument();
  });

  it('shows the long-run sub-line while consolidating', async () => {
    mockMemoryActions({ consolidateState: { status: 'pending' }, lastAttempted: 'consolidate' });
    renderPage({ chat: 'c1' });
    expect(
      await screen.findByText(
        'This can take a minute or two for a large memory — you can leave this page; it keeps going.',
      ),
    ).toBeInTheDocument();
  });
});
