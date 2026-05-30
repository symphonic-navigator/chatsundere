// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PersonaRow } from '../../src/boot/client-data-db';
import { PersonaFilterChips } from '../../src/components/history/PersonaFilterChips';

function p(over: Partial<PersonaRow>): PersonaRow {
  return {
    id: 'x',
    name: 'X',
    tagline: '',
    colour: '#fff',
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
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe('PersonaFilterChips', () => {
  it('renders [All] as the first chip plus one chip per persona', () => {
    const { container } = render(
      <PersonaFilterChips
        personas={[p({ id: 'a', name: 'A' }), p({ id: 'b', name: 'B' })]}
        selectedId={null}
        onChange={vi.fn()}
      />,
    );
    const chips = container.querySelectorAll('[data-chip]');
    expect(chips.length).toBe(3);
    expect(chips[0]?.textContent).toBe('All');
    expect(chips[1]?.textContent).toBe('A');
    expect(chips[2]?.textContent).toBe('B');
  });

  it('marks the [All] chip selected when selectedId is null', () => {
    const { container } = render(
      <PersonaFilterChips personas={[]} selectedId={null} onChange={vi.fn()} />,
    );
    expect(container.querySelector('[data-chip][data-selected="true"]')?.textContent).toBe('All');
  });

  it('marks the matching persona chip selected', () => {
    const { container } = render(
      <PersonaFilterChips
        personas={[p({ id: 'a', name: 'A' })]}
        selectedId="a"
        onChange={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-chip][data-selected="true"]')?.textContent).toBe('A');
  });

  it('clicking [All] calls onChange(null)', () => {
    const onChange = vi.fn();
    const { container } = render(
      <PersonaFilterChips personas={[]} selectedId="a" onChange={onChange} />,
    );
    const allChip = container.querySelector('[data-chip]');
    if (allChip) {
      fireEvent.click(allChip);
    }
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('clicking a persona chip calls onChange(personaId)', () => {
    const onChange = vi.fn();
    const { container } = render(
      <PersonaFilterChips
        personas={[p({ id: 'a', name: 'A' })]}
        selectedId={null}
        onChange={onChange}
      />,
    );
    const personaChip = container.querySelectorAll('[data-chip]')[1];
    if (personaChip) {
      fireEvent.click(personaChip);
    }
    expect(onChange).toHaveBeenCalledWith('a');
  });
});
