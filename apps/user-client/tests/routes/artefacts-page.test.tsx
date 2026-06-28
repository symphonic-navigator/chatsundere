// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtefactRow } from '../../src/boot/client-data-db.js';

vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: () => ({ onHelp: vi.fn(), helpOverlay: null }),
}));

// Mutable so each test can shape the row list the page sees.
let mockRows: ArtefactRow[] = [];

vi.mock('../../src/data/artefacts.js', async (orig) => ({
  ...(await orig()),
  useChatArtefacts: () => ({ data: mockRows }),
  useSetArtefactFavourite: () => ({ mutate: vi.fn() }),
  useRenameArtefact: () => ({ mutate: vi.fn() }),
  useUpdateArtefactContent: () => ({ mutate: vi.fn() }),
  useDeleteArtefact: () => ({ mutate: vi.fn() }),
  useSetArtefactTags: () => ({ mutate: vi.fn() }),
}));

// The page derives the persona from the chat row (useChat → usePersona) for the
// TreasuryRow attribution; stub both so the test needs no QueryClientProvider.
vi.mock('../../src/data/chats.js', () => ({
  useChat: () => ({ data: { chat: { personaId: 'p1' } } }),
}));
vi.mock('../../src/data/personas.js', () => ({
  usePersona: () => ({ data: { name: 'Aurum', colour: '#c9a84c' } }),
}));

import { ArtefactsPage } from '../../src/routes/app/chat/artefacts-page.js';

/** Build a real-shaped ArtefactRow, overriding only what a test cares about. */
function makeArtefact(overrides: Partial<ArtefactRow> = {}): ArtefactRow {
  return {
    id: 'a1',
    chatId: 'c1',
    personaId: 'p1',
    projectId: null,
    origin: 'generated',
    kind: 'text',
    format: 'html',
    title: 'Test Artefact',
    fileName: 'test-artefact.html',
    mime: 'text/html',
    content: '<p>test</p>',
    tags: [],
    favourite: false,
    createdAt: 1_000_000,
    updatedAt: 1_000_000,
    ...overrides,
  };
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={['/app/chat/c1/artefacts']}>
      <Routes>
        <Route path="/app/chat/:chatId/artefacts" element={<ArtefactsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ArtefactsPage', () => {
  beforeEach(() => {
    mockRows = [makeArtefact()];
  });

  it('renders an artefact row with its title', () => {
    renderPage();
    expect(screen.getByText('Test Artefact')).toBeInTheDocument();
  });

  it('renders the "In this chat" section heading', () => {
    renderPage();
    expect(screen.getByText('In this chat')).toBeInTheDocument();
  });

  it('shows the empty state when there are no artefacts', () => {
    mockRows = [];
    renderPage();
    expect(screen.getByText('Artefacts you create appear here.')).toBeInTheDocument();
  });

  it('renders the ★ Favourites section when a favourite is present', () => {
    mockRows = [
      makeArtefact({ id: 'fav', title: 'Starred Artefact', favourite: true }),
      makeArtefact({ id: 'plain', title: 'Plain Artefact', favourite: false }),
    ];
    renderPage();
    expect(screen.getByText('★ Favourites')).toBeInTheDocument();
    // The starred artefact appears in both sections (lossless); the plain one
    // only under "In this chat" — assert at least one of each shows.
    expect(screen.getAllByText('Starred Artefact').length).toBeGreaterThan(0);
    expect(screen.getByText('Plain Artefact')).toBeInTheDocument();
  });
});
