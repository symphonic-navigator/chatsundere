// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { Circle } from '../../src/routes/app/circle.js';

function wrap(initialEntry = '/app/circle') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/app/circle" element={<Circle />} />
          <Route path="/app/persona/new" element={<div data-testid="editor-create" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Circle route', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('renders an empty-state hint when no personas exist', async () => {
    wrap();
    await waitFor(() => {
      expect(screen.getByText(/no personas yet/i)).toBeInTheDocument();
    });
  });

  it('navigates to /app/persona/new when the FAB is clicked', async () => {
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: /new persona/i }));
    await waitFor(() => expect(screen.getByTestId('editor-create')).toBeInTheDocument());
  });

  it('renders persona cards when personas exist', async () => {
    const db = getClientDataDb();
    const now = Date.now();
    await db.personas.add({
      id: 'p1',
      name: 'Aurum',
      tagline: 'quiet sparring',
      colour: '#c9a84c',
      font: 'serif',
      instructions: 'be present',
      providerId: 'nope',
      modelId: 'm',
      mindspaceId: null,
      aboutMeOverride: null,
      textureOverride: null,
      temperature: 0.85,
      adultPersona: false,
      createdAt: now,
      updatedAt: now,
    });
    wrap();
    await waitFor(() => {
      expect(screen.getByText('Aurum')).toBeInTheDocument();
      expect(screen.getByText(/quiet sparring/i)).toBeInTheDocument();
    });
  });
});
