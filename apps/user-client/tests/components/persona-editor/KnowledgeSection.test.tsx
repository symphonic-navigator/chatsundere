import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/data/knowledge.js', () => ({
  useFilteredLibraries: vi.fn(),
}));
import { KnowledgeSection } from '../../../src/components/persona-editor/KnowledgeSection.js';
import { useFilteredLibraries } from '../../../src/data/knowledge.js';

function wrap(ui: ReactElement) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const lib = (id: string, name: string) => ({
  id,
  name,
  description: '',
  nsfw: false,
  createdAt: 0,
  updatedAt: 0,
});

describe('KnowledgeSection', () => {
  it('toggles a library id in and out of the selection', () => {
    vi.mocked(useFilteredLibraries).mockReturnValue({
      data: [lib('a', 'A'), lib('b', 'B')],
    } as unknown as ReturnType<typeof useFilteredLibraries>);
    const onChange = vi.fn();
    wrap(<KnowledgeSection selected={['a']} onChange={onChange} />);
    fireEvent.click(screen.getByText('B'));
    expect(onChange).toHaveBeenCalledWith(['a', 'b']);
  });

  it('removes an already-selected library on toggle', () => {
    vi.mocked(useFilteredLibraries).mockReturnValue({
      data: [lib('a', 'A'), lib('b', 'B')],
    } as unknown as ReturnType<typeof useFilteredLibraries>);
    const onChange = vi.fn();
    wrap(<KnowledgeSection selected={['a', 'b']} onChange={onChange} />);
    fireEvent.click(screen.getByText('A'));
    expect(onChange).toHaveBeenCalledWith(['b']);
  });

  it('renders an empty-state hint linking to My Knowledge when no libraries exist', () => {
    vi.mocked(useFilteredLibraries).mockReturnValue({
      data: [],
    } as unknown as ReturnType<typeof useFilteredLibraries>);
    wrap(<KnowledgeSection selected={[]} onChange={vi.fn()} />);
    expect(screen.getByText(/My Knowledge/i)).toBeTruthy();
  });
});
