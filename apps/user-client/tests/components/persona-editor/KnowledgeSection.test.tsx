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

const lib = (id: string, name: string, nsfw = false) => ({
  id,
  name,
  description: '',
  nsfw,
  createdAt: 0,
  updatedAt: 0,
});

describe('KnowledgeSection', () => {
  it('toggles a library id in and out of the selection', () => {
    vi.mocked(useFilteredLibraries).mockReturnValue({
      data: [lib('a', 'A'), lib('b', 'B')],
    } as unknown as ReturnType<typeof useFilteredLibraries>);
    const onChange = vi.fn();
    wrap(<KnowledgeSection selected={['a']} onChange={onChange} adultPersona={true} />);
    fireEvent.click(screen.getByText('B'));
    expect(onChange).toHaveBeenCalledWith(['a', 'b']);
  });

  it('removes an already-selected library on toggle', () => {
    vi.mocked(useFilteredLibraries).mockReturnValue({
      data: [lib('a', 'A'), lib('b', 'B')],
    } as unknown as ReturnType<typeof useFilteredLibraries>);
    const onChange = vi.fn();
    wrap(<KnowledgeSection selected={['a', 'b']} onChange={onChange} adultPersona={true} />);
    fireEvent.click(screen.getByText('A'));
    expect(onChange).toHaveBeenCalledWith(['b']);
  });

  it('renders an empty-state hint linking to My Knowledge when no libraries exist', () => {
    vi.mocked(useFilteredLibraries).mockReturnValue({
      data: [],
    } as unknown as ReturnType<typeof useFilteredLibraries>);
    wrap(<KnowledgeSection selected={[]} onChange={vi.fn()} adultPersona={true} />);
    expect(screen.getByText(/My Knowledge/i)).toBeTruthy();
  });

  it('hides NSFW libraries from an SFW persona even when the global mode permits them', () => {
    vi.mocked(useFilteredLibraries).mockReturnValue({
      data: [lib('sfw', 'SFW Lib'), lib('nsfw', 'NSFW Lib', true)],
    } as unknown as ReturnType<typeof useFilteredLibraries>);
    wrap(<KnowledgeSection selected={[]} onChange={vi.fn()} adultPersona={false} />);
    expect(screen.getByText('SFW Lib')).toBeTruthy();
    expect(screen.queryByText('NSFW Lib')).toBeNull();
  });

  it('shows NSFW libraries for an adult persona', () => {
    vi.mocked(useFilteredLibraries).mockReturnValue({
      data: [lib('sfw', 'SFW Lib'), lib('nsfw', 'NSFW Lib', true)],
    } as unknown as ReturnType<typeof useFilteredLibraries>);
    wrap(<KnowledgeSection selected={[]} onChange={vi.fn()} adultPersona={true} />);
    expect(screen.getByText('SFW Lib')).toBeTruthy();
    expect(screen.getByText('NSFW Lib')).toBeTruthy();
  });

  it('shows the empty-state when filtering removes every library', () => {
    vi.mocked(useFilteredLibraries).mockReturnValue({
      data: [lib('nsfw', 'NSFW Lib', true)],
    } as unknown as ReturnType<typeof useFilteredLibraries>);
    wrap(<KnowledgeSection selected={[]} onChange={vi.fn()} adultPersona={false} />);
    expect(screen.getByText(/My Knowledge/i)).toBeTruthy();
  });
});
