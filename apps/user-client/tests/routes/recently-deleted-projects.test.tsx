// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fsError } from '../../src/projects/errors.js';
import { toastStore, useToastStore } from '../../src/state/toast.store.js';

const listTrashCards = vi.fn();
const restoreCard = vi.fn(async (_key: string) => undefined);
const purgeCard = vi.fn(async (_key: string) => undefined);

vi.mock('../../src/trash/trash-repo.js', () => ({
  listTrashCards: () => listTrashCards(),
  restoreCard: (key: string) => restoreCard(key),
  purgeCard: (key: string) => purgeCard(key),
}));

vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: vi.fn(() => ({ onHelp: vi.fn(), helpOverlay: null })),
}));

import { RecentlyDeletedPage } from '../../src/routes/app/account/recently-deleted.js';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <RecentlyDeletedPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const NOW = Date.now();

const FOLDER_CARD = {
  cardKey: 'batch:k1',
  entityKind: 'projectFolder',
  title: 'notes/ — Project X',
  counts: { files: 3, items: 3 },
  deletedAt: NOW,
};

describe('RecentlyDeletedPage — project cards', () => {
  beforeEach(() => {
    listTrashCards.mockReset();
    restoreCard.mockReset();
    purgeCard.mockClear();
    toastStore.clear();
  });

  it('shows the file count on a folder card', async () => {
    listTrashCards.mockResolvedValue([FOLDER_CARD]);
    renderPage();
    expect(await screen.findByText('notes/ — Project X')).toBeInTheDocument();
    expect(screen.getByText('3 files · deleted today')).toBeInTheDocument();
  });

  it('shows the project name on a file card and earlier deletes on a project card', async () => {
    listTrashCards.mockResolvedValue([
      {
        cardKey: 'projectFiles:f1',
        entityKind: 'projectFile',
        title: 'notes/plan.md',
        counts: { files: 1, items: 0 },
        projectName: 'Project X',
        deletedAt: NOW,
      },
      {
        cardKey: 'projects:p1',
        entityKind: 'project',
        title: 'Project Y',
        counts: { files: 12, earlierFiles: 3, items: 12 },
        deletedAt: NOW,
      },
    ]);
    renderPage();
    expect(await screen.findByText('Project X · deleted today')).toBeInTheDocument();
    expect(
      screen.getByText('12 files · includes 3 files deleted earlier · deleted today'),
    ).toBeInTheDocument();
  });

  it('names the files in the purge confirmation', async () => {
    listTrashCards.mockResolvedValue([FOLDER_CARD]);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /delete now/i }));
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'Permanently delete this folder and its 3 files? This cannot be undone.',
    );
  });

  it('says "1 file" in the purge confirmation of a single-file folder', async () => {
    listTrashCards.mockResolvedValue([{ ...FOLDER_CARD, counts: { files: 1, items: 1 } }]);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /delete now/i }));
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'Permanently delete this folder and its 1 file? This cannot be undone.',
    );
  });

  it('explains a refused restore and keeps the card', async () => {
    listTrashCards.mockResolvedValue([FOLDER_CARD]);
    restoreCard.mockRejectedValue(fsError('AlreadyExists', { path: '/notes/plan.md', others: 2 }));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /restore/i }));

    await vi.waitFor(() => {
      expect(useToastStore.getState().toasts.map((t) => [t.message, t.tone])).toContainEqual([
        "Can't restore: /notes/plan.md (and 2 more) already exists. Rename or move that file, then restore again.",
        'warn',
      ]);
    });
    expect(screen.getByText('notes/ — Project X')).toBeInTheDocument();
  });
});
