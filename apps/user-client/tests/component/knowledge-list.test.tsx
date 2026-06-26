import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { libsMock, countsMock } = vi.hoisted(() => ({
  libsMock: vi.fn(),
  countsMock: vi.fn(),
}));
vi.mock('../../src/data/knowledge.js', () => ({
  useFilteredLibraries: () => libsMock(),
  useDocumentCounts: () => countsMock(),
}));
vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: () => ({ onHelp: vi.fn(), helpOverlay: null }),
}));

import { KnowledgeList } from '../../src/routes/app/knowledge.js';

function wrap() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/app/knowledge']}>
        <Routes>
          <Route path="/app/knowledge" element={<KnowledgeList />} />
          <Route path="/app/knowledge/new" element={<div>create library screen</div>} />
          <Route path="/app/knowledge/:id" element={<div>library screen</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  libsMock.mockReturnValue({ data: [] });
  countsMock.mockReturnValue({ data: {} });
});

describe('KnowledgeList', () => {
  it('shows the empty state and the Add affordance when there are no libraries', () => {
    wrap();
    expect(screen.getByText(/no libraries yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add/i })).toBeInTheDocument();
  });

  it('renders a row per library with the NSFW badge and a document count', () => {
    libsMock.mockReturnValue({
      data: [
        {
          id: 'a',
          name: 'Lore',
          description: 'Worldbuilding',
          nsfw: false,
          createdAt: 1,
          updatedAt: 1,
        },
        { id: 'b', name: 'Adult', description: '', nsfw: true, createdAt: 1, updatedAt: 1 },
      ],
    });
    countsMock.mockReturnValue({ data: { a: 12, b: 3 } });
    wrap();
    expect(screen.getByText('Lore')).toBeInTheDocument();
    expect(screen.getByText('Worldbuilding')).toBeInTheDocument();
    expect(screen.getByText(/12 docs/i)).toBeInTheDocument();
    expect(screen.getByText('NSFW')).toBeInTheDocument();
  });
});
