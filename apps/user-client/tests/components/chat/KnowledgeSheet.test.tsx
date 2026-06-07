// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/data/knowledge.js', () => ({ useFilteredLibraries: vi.fn() }));
import { KnowledgeSheet } from '../../../src/components/chat/KnowledgeSheet.js';
import { useFilteredLibraries } from '../../../src/data/knowledge.js';

const lib = (id: string, name: string) => ({
  id,
  name,
  description: '',
  nsfw: false,
  createdAt: 0,
  updatedAt: 0,
});
const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('KnowledgeSheet', () => {
  it('shows persona libraries locked-on and toggles chat libraries', () => {
    vi.mocked(useFilteredLibraries).mockReturnValue({
      data: [lib('p', 'Persona Lib'), lib('c', 'Chat Lib')],
    } as unknown as ReturnType<typeof useFilteredLibraries>);
    const onToggleChat = vi.fn();
    wrap(
      <KnowledgeSheet
        personaLibraryIds={['p']}
        chatLibraryIds={[]}
        onToggleChat={onToggleChat}
        onClose={vi.fn()}
      />,
    );
    // persona lib is shown locked (its toggle control is disabled)
    const personaControl = screen.getByLabelText('Persona Lib') as HTMLInputElement;
    expect(personaControl.disabled).toBe(true);
    expect(personaControl.checked).toBe(true);
    fireEvent.click(screen.getByLabelText('Chat Lib'));
    expect(onToggleChat).toHaveBeenCalledWith('c');
  });

  it('disables non-persona toggles when no chat exists, persona stays locked', () => {
    vi.mocked(useFilteredLibraries).mockReturnValue({
      data: [lib('p', 'Persona Lib'), lib('c', 'Chat Lib')],
    } as unknown as ReturnType<typeof useFilteredLibraries>);
    const onToggleChat = vi.fn();
    wrap(
      <KnowledgeSheet
        personaLibraryIds={['p']}
        chatLibraryIds={[]}
        onToggleChat={onToggleChat}
        canBindChat={false}
        onClose={vi.fn()}
      />,
    );
    const chatControl = screen.getByLabelText('Chat Lib') as HTMLInputElement;
    expect(chatControl.disabled).toBe(true);
    fireEvent.click(chatControl);
    expect(onToggleChat).not.toHaveBeenCalled();
    const personaControl = screen.getByLabelText('Persona Lib') as HTMLInputElement;
    expect(personaControl.disabled).toBe(true);
    expect(personaControl.checked).toBe(true);
  });

  it('reflects existing chat membership as checked', () => {
    vi.mocked(useFilteredLibraries).mockReturnValue({
      data: [lib('c', 'Chat Lib')],
    } as unknown as ReturnType<typeof useFilteredLibraries>);
    wrap(
      <KnowledgeSheet
        personaLibraryIds={[]}
        chatLibraryIds={['c']}
        onToggleChat={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const control = screen.getByLabelText('Chat Lib') as HTMLInputElement;
    expect(control.checked).toBe(true);
    expect(control.disabled).toBe(false);
  });

  it('renders empty-state linking to My Knowledge when no libraries exist', () => {
    vi.mocked(useFilteredLibraries).mockReturnValue({
      data: [],
    } as unknown as ReturnType<typeof useFilteredLibraries>);
    wrap(
      <KnowledgeSheet
        personaLibraryIds={[]}
        chatLibraryIds={[]}
        onToggleChat={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/My Knowledge/i)).toBeTruthy();
  });

  it('dismisses on close', () => {
    vi.mocked(useFilteredLibraries).mockReturnValue({
      data: [lib('c', 'Chat Lib')],
    } as unknown as ReturnType<typeof useFilteredLibraries>);
    const onClose = vi.fn();
    wrap(
      <KnowledgeSheet
        personaLibraryIds={[]}
        chatLibraryIds={[]}
        onToggleChat={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
