import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PersonaRow } from '../../../src/boot/client-data-db.js';
import { PersonaFilterDropdown } from '../../../src/components/history/PersonaFilterDropdown.js';

function persona(id: string, name: string): PersonaRow {
  return {
    id,
    name,
    tagline: '',
    colour: '#aaa',
    font: 'serif',
    instructions: '',
    canonicalId: null,
    providerId: '',
    modelId: '',
    mindspaceId: null,
    aboutMeOverride: null,
    textureOverride: null,
    temperature: 0.85,
    adultPersona: false,
    chatsundereTonality: true,
    contextWindow: null,
    libraryIds: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

const trigger = () => screen.getByRole('button', { name: 'Filter by persona' });

describe('PersonaFilterDropdown', () => {
  it('shows All by default and opens to list every persona', () => {
    render(
      <PersonaFilterDropdown
        personas={[persona('p1', 'Sage'), persona('p2', 'Lyra')]}
        selectedId={null}
        onChange={() => {}}
      />,
    );
    expect(trigger().textContent).toContain('All personas');
    fireEvent.click(trigger());
    expect(screen.getByRole('button', { name: 'All personas' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sage' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lyra' })).toBeTruthy();
  });

  it('reflects the selected persona in the trigger', () => {
    render(
      <PersonaFilterDropdown
        personas={[persona('p1', 'Sage')]}
        selectedId="p1"
        onChange={() => {}}
      />,
    );
    expect(trigger().textContent).toContain('Sage');
  });

  it('emits the persona id when an option is chosen, and null for All', () => {
    const onChange = vi.fn();
    render(
      <PersonaFilterDropdown
        personas={[persona('p1', 'Sage')]}
        selectedId={null}
        onChange={onChange}
      />,
    );
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('button', { name: 'Sage' }));
    expect(onChange).toHaveBeenCalledWith('p1');

    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('button', { name: 'All personas' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('closes the list after a selection', () => {
    render(
      <PersonaFilterDropdown
        personas={[persona('p1', 'Sage')]}
        selectedId={null}
        onChange={() => {}}
      />,
    );
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('button', { name: 'Sage' }));
    expect(screen.queryByRole('button', { name: 'All personas' })).toBeNull();
  });
});
