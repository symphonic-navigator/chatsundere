// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { PersonaRow } from '../../src/boot/client-data-db.js';
import { PersonaCard } from '../../src/components/PersonaCard.js';

function makePersona(overrides: Partial<PersonaRow> = {}): PersonaRow {
  return {
    id: 'p1',
    name: 'Aurum',
    tagline: 'Quiet companion, architectural sparring',
    colour: '#c9a84c',
    font: 'serif',
    instructions: 'i',
    providerId: 'np',
    modelId: 'm',
    mindspaceId: null,
    aboutMeOverride: null,
    temperature: 0.85,
    adultPersona: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function wrap(node: React.ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

describe('PersonaCard', () => {
  it('renders monogram + name + tagline', () => {
    wrap(<PersonaCard persona={makePersona()} hasProvider onChat={() => {}} />);
    expect(screen.getByText('AU')).toBeInTheDocument();
    expect(screen.getByText('Aurum')).toBeInTheDocument();
    expect(screen.getByText(/quiet companion/i)).toBeInTheDocument();
  });

  it('fires onChat when the primary Chat button is clicked', () => {
    const onChat = vi.fn();
    wrap(<PersonaCard persona={makePersona()} hasProvider onChat={onChat} />);
    fireEvent.click(screen.getByRole('button', { name: /^chat$/i }));
    expect(onChat).toHaveBeenCalledWith(makePersona().id);
  });

  it('shows "Provider missing" badge when hasProvider is false', () => {
    wrap(<PersonaCard persona={makePersona()} hasProvider={false} onChat={() => {}} />);
    expect(screen.getByText(/provider missing/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^chat$/i })).toBeDisabled();
  });

  it('renders persona name in persona colour', () => {
    wrap(
      <PersonaCard persona={makePersona({ colour: '#b33a5e' })} hasProvider onChat={() => {}} />,
    );
    const name = screen.getByText('Aurum');
    expect(name.style.color).toBe('rgb(179, 58, 94)');
  });
});
