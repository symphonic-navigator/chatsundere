// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Module mocks ─────────────────────────────────────────────────────────────
// Must precede the import of the component under test.

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

describe('RecentlyDeletedPage', () => {
  beforeEach(() => {
    listTrashCards.mockReset();
    restoreCard.mockClear();
    purgeCard.mockClear();
  });

  it('renders one card per entry with title, count summary, Restore and Delete now', async () => {
    listTrashCards.mockResolvedValue([
      {
        cardKey: 'personas:a',
        entityKind: 'persona',
        title: 'Fable',
        counts: { chats: 3, memories: 12, items: 15 },
        deletedAt: NOW - 2 * 86_400_000,
      },
      {
        cardKey: 'chats:b',
        entityKind: 'chat',
        title: 'A quiet evening',
        counts: { items: 0 },
        deletedAt: NOW - 3_600_000,
      },
    ]);

    renderPage();

    expect(await screen.findByText('Fable')).toBeInTheDocument();
    expect(screen.getByText('A quiet evening')).toBeInTheDocument();

    // Human count summary for the persona card.
    expect(screen.getByText(/3 chats/)).toBeInTheDocument();
    expect(screen.getByText(/12 memories/)).toBeInTheDocument();

    // Two controls per card → four total.
    expect(screen.getAllByRole('button', { name: /restore/i })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /delete now/i })).toHaveLength(2);
  });

  it('renders the calm empty copy when there is nothing', async () => {
    listTrashCards.mockResolvedValue([]);
    renderPage();
    expect(
      await screen.findByText(
        "Nothing here — deleted items rest here for 30 days before they're gone.",
      ),
    ).toBeInTheDocument();
  });

  it('Delete now opens a confirm naming the cascade counts and warning it cannot be undone', async () => {
    listTrashCards.mockResolvedValue([
      {
        cardKey: 'personas:a',
        entityKind: 'persona',
        title: 'Fable',
        counts: { chats: 3, memories: 12, items: 15 },
        deletedAt: NOW - 2 * 86_400_000,
      },
    ]);

    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /delete now/i }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/3 chats/);
    expect(dialog).toHaveTextContent(/12 memories/);
    expect(dialog).toHaveTextContent(/cannot be undone/i);
  });
});
