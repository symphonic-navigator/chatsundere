// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { ArtefactSheet } from '../../src/components/chat/ArtefactSheet.js';
import { addGeneratedArtefact } from '../../src/data/artefacts.js';

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
});

afterEach(async () => {
  await _resetClientDataDbForTests();
});

function wrap(ui: React.ReactNode) {
  return <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;
}

test('lists chat artefacts; tap calls onOpen', async () => {
  const id = await addGeneratedArtefact({
    chatId: 'c1',
    personaId: 'p1',
    title: 'Calc',
    content: '<x>',
  });
  const onOpen = vi.fn();
  render(wrap(<ArtefactSheet chatId="c1" onOpen={onOpen} onClose={vi.fn()} />));
  await waitFor(() => screen.getByText('Calc'));
  fireEvent.click(screen.getByRole('button', { name: /Calc/ }));
  expect(onOpen).toHaveBeenCalledWith(id);
});
