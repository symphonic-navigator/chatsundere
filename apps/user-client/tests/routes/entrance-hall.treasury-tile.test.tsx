// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { addGeneratedArtefact } from '../../src/data/artefacts.js';
import { EntranceHall } from '../../src/routes/app/entrance-hall.js';

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

test('Treasury tile is interactive and shows the artefact count', async () => {
  await addGeneratedArtefact({ chatId: 'c1', personaId: 'p1', title: 'A', content: 'x' });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <EntranceHall />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const tile = await screen.findByText('My Treasury');
  const card = tile.closest('[role="button"]');
  expect(card).not.toBeNull();
  expect(card).not.toHaveAttribute('aria-disabled', 'true');
  await waitFor(() => expect(screen.getByText('1 artefacts')).toBeInTheDocument());
});
