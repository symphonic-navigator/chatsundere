// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import type { PersonaRow } from '../../src/boot/client-data-db.js';
import { TreasuryFilterSheet } from '../../src/components/treasury/TreasuryFilterSheet.js';

const personas = [{ id: 'p1', name: 'Mei', colour: '#8d6dff' }] as unknown as PersonaRow[];

function setup(overrides: Partial<React.ComponentProps<typeof TreasuryFilterSheet>> = {}) {
  const props = {
    personas,
    personaId: null,
    onPersonaChange: vi.fn(),
    allTags: ['demo', 'prod'],
    selectedTags: [] as string[],
    onTagsChange: vi.fn(),
    favourite: false,
    onFavouriteChange: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<TreasuryFilterSheet {...props} />);
  return props;
}

test('toggling favourite reports the new value', () => {
  const props = setup();
  fireEvent.click(screen.getByRole('button', { name: /favourites only/i }));
  expect(props.onFavouriteChange).toHaveBeenCalledWith(true);
});

test('picking a tag suggestion reports the new tag set', () => {
  const props = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Add tag demo' }));
  expect(props.onTagsChange).toHaveBeenCalledWith(['demo']);
});

test('the project row is present but disabled', () => {
  setup();
  expect(screen.getByText(/projects/i).closest('[aria-disabled="true"]')).not.toBeNull();
});
