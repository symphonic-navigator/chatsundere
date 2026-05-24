// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { Circle } from '../../src/routes/app/circle.js';

describe('Circle FAB', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('renders the + glyph with a dark text colour class so it stays visible on bg-paper', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <Circle />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const fab = screen.getByRole('button', { name: /new persona/i });
    expect(fab.className).toMatch(/\btext-ink\b/);
    expect(fab.className).not.toMatch(/\btext-bg\b/);
    expect(fab).toHaveTextContent('+');
  });
});
