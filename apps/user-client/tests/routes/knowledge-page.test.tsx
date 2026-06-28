// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mutate = vi.fn();

// Mutable so individual tests can vary the chat's already-bound libraries.
let mockChatLibraryIds: string[] = [];

vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: () => ({ onHelp: vi.fn(), helpOverlay: null }),
}));

vi.mock('../../src/data/knowledge.js', () => ({
  useFilteredLibraries: () => ({
    data: [
      { id: 'l1', name: 'Harbour lore', nsfw: false },
      { id: 'l2', name: 'Recipes', nsfw: false },
    ],
  }),
}));

vi.mock('../../src/data/chats.js', () => ({
  useChat: () => ({
    data: {
      chat: { id: 'c1', personaId: 'p1', libraryIds: mockChatLibraryIds },
      messages: [],
    },
  }),
  useSetChatLibraries: () => ({ mutate }),
}));

vi.mock('../../src/data/personas.js', () => ({
  usePersona: () => ({
    data: { id: 'p1', libraryIds: ['l1'], adultPersona: false },
  }),
}));

import { KnowledgePage } from '../../src/routes/app/chat/knowledge-page.js';

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={['/app/chat/c1/knowledge']}>
      <Routes>
        <Route path="/app/chat/:chatId/knowledge" element={<KnowledgePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mutate.mockClear();
  mockChatLibraryIds = [];
});

describe('KnowledgePage — persona library lock', () => {
  it('renders the persona-assigned library as checked and disabled', () => {
    renderPage();
    const checkbox = screen.getByRole('checkbox', { name: 'Harbour lore' });
    expect(checkbox).toBeChecked();
    expect(checkbox).toBeDisabled();
  });
});

describe('KnowledgePage — toggle non-persona library', () => {
  it('calls mutate with the added libraryId when an unchecked non-persona library is toggled', () => {
    renderPage();
    const checkbox = screen.getByRole('checkbox', { name: 'Recipes' });
    fireEvent.click(checkbox);
    expect(mutate).toHaveBeenCalledWith({ chatId: 'c1', libraryIds: ['l2'] });
  });

  it('calls mutate with the id removed when an already-bound non-persona library is toggled off', () => {
    mockChatLibraryIds = ['l2'];
    renderPage();
    const checkbox = screen.getByRole('checkbox', { name: 'Recipes' });
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(mutate).toHaveBeenCalledWith({ chatId: 'c1', libraryIds: [] });
  });
});
