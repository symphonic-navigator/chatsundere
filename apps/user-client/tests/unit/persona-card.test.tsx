// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { PersonaRow } from '../../src/boot/client-data-db.js';
import { PersonaCard } from '../../src/components/PersonaCard.js';
import type { ResolvedMindspace } from '../../src/state/mindspace-resolver.js';

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
    textureOverride: null,
    temperature: 0.85,
    adultPersona: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function makeMindspace(overrides: Partial<ResolvedMindspace> = {}): ResolvedMindspace {
  return {
    id: 'ms-1',
    displayName: 'Aurum',
    palette: {
      bg: '#1a1208',
      surfaceBase: '#3a2e15',
      surfaceRaised: '#4a3d20',
      surfaceInput: '#2a2010',
      accent: '#c9a84c',
      accentSubtle: '#9a7d2e',
      accentBorder: '#6a5821',
      accentBorderActive: '#c9a84c',
      accentGlow: '#c9a84c',
      text: { primary: '#fff', secondary: '#ddd', muted: '#888', ghost: '#555' },
    },
    texture: 'cloudy',
    builtIn: true,
    createdAt: 0,
    ...overrides,
  };
}

function wrap(node: React.ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

describe('PersonaCard', () => {
  it('renders monogram + name + tagline', () => {
    wrap(
      <PersonaCard
        persona={makePersona()}
        mindspace={makeMindspace()}
        hasProvider
        onChat={() => {}}
      />,
    );
    expect(screen.getByText('AU')).toBeInTheDocument();
    expect(screen.getByText('Aurum')).toBeInTheDocument();
    expect(screen.getByText(/quiet companion/i)).toBeInTheDocument();
  });

  it('fires onChat when the primary Chat button is clicked', () => {
    const onChat = vi.fn();
    wrap(
      <PersonaCard
        persona={makePersona()}
        mindspace={makeMindspace()}
        hasProvider
        onChat={onChat}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^chat$/i }));
    expect(onChat).toHaveBeenCalledWith(makePersona().id);
  });

  it('shows "Provider missing" badge when hasProvider is false', () => {
    wrap(
      <PersonaCard
        persona={makePersona()}
        mindspace={makeMindspace()}
        hasProvider={false}
        onChat={() => {}}
      />,
    );
    expect(screen.getByText(/provider missing/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^chat$/i })).toBeDisabled();
  });

  it('renders persona name in persona colour', () => {
    wrap(
      <PersonaCard
        persona={makePersona({ colour: '#b33a5e' })}
        mindspace={makeMindspace()}
        hasProvider
        onChat={() => {}}
      />,
    );
    const name = screen.getByText('Aurum');
    expect(name.style.color).toBe('rgb(179, 58, 94)');
  });

  it('applies mindspace background tint and base border colour', () => {
    const ms = makeMindspace({
      palette: {
        ...makeMindspace().palette,
        surfaceBase: '#3a2e15',
        accentBorder: '#6a5821',
      },
    });
    const { container } = wrap(
      <PersonaCard persona={makePersona()} mindspace={ms} hasProvider onChat={() => {}} />,
    );
    const li = container.querySelector('[data-persona-card]') as HTMLElement;
    // jsdom normalises 8-digit-hex (#RRGGBBAA) to rgba(); check both forms
    // so the assertion survives a real-browser CSSOM that keeps the hex.
    const bg = li.style.background;
    const border = li.style.border;
    expect(bg.includes('#3a2e15') || bg.includes('rgba(58, 46, 21')).toBe(true);
    expect(border.includes('#6a5821') || border.includes('rgb(106, 88, 33)')).toBe(true);
  });

  it('applies persona-card-nsfw class when persona is adult', () => {
    const { container } = wrap(
      <PersonaCard
        persona={makePersona({ adultPersona: true })}
        mindspace={makeMindspace()}
        hasProvider
        onChat={() => {}}
      />,
    );
    const li = container.querySelector('[data-persona-card]') as HTMLElement;
    expect(li.className).toContain('persona-card-nsfw');
    expect(li.className).not.toContain('persona-card-sfw');
    expect(li.dataset.adult).toBe('true');
  });

  it('applies persona-card-sfw class when persona is not adult', () => {
    const { container } = wrap(
      <PersonaCard
        persona={makePersona({ adultPersona: false })}
        mindspace={makeMindspace()}
        hasProvider
        onChat={() => {}}
      />,
    );
    const li = container.querySelector('[data-persona-card]') as HTMLElement;
    expect(li.className).toContain('persona-card-sfw');
    expect(li.className).not.toContain('persona-card-nsfw');
    expect(li.dataset.adult).toBe('false');
  });
});
