// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import type { ArtefactRow } from '../../src/boot/client-data-db.js';
import { TreasuryRow } from '../../src/components/treasury/TreasuryRow.js';

const row: ArtefactRow = {
  id: 'a',
  chatId: 'c',
  personaId: 'p',
  projectId: null,
  origin: 'generated',
  kind: 'text',
  format: 'html',
  title: 'Pomodoro Timer',
  fileName: 'pomodoro.html',
  mime: 'text/html',
  content: 'x'.repeat(14336),
  tags: [],
  favourite: false,
  createdAt: 0,
  updatedAt: 0,
};

test('idle: tapping the body opens; star toggles favourite', () => {
  const onOpen = vi.fn();
  const onToggleFavourite = vi.fn();
  render(
    <TreasuryRow
      row={row}
      personaName="Mei"
      personaColour="#8d6dff"
      selectMode={false}
      selected={false}
      onOpen={onOpen}
      onToggleSelect={vi.fn()}
      onToggleFavourite={onToggleFavourite}
    />,
  );
  expect(screen.getByText('Pomodoro Timer')).toBeInTheDocument();
  expect(screen.getByText(/Mei/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Pomodoro Timer/ }));
  expect(onOpen).toHaveBeenCalledWith('a');
  fireEvent.click(screen.getByRole('button', { name: /favourite/i }));
  expect(onToggleFavourite).toHaveBeenCalledWith('a');
});

test('select mode: tapping the body toggles selection instead of opening', () => {
  const onOpen = vi.fn();
  const onToggleSelect = vi.fn();
  render(
    <TreasuryRow
      row={row}
      personaName="Mei"
      personaColour="#8d6dff"
      selectMode
      selected={false}
      onOpen={onOpen}
      onToggleSelect={onToggleSelect}
      onToggleFavourite={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /Pomodoro Timer/ }));
  expect(onToggleSelect).toHaveBeenCalledWith('a');
  expect(onOpen).not.toHaveBeenCalled();
});
