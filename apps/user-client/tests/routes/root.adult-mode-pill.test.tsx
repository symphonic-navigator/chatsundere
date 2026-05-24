// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { Root } from '../../src/routes/root.js';

describe('Root brand-bar adult-mode pill', () => {
  beforeEach(async () => {
    sessionStorage.clear();
    sessionStorage.setItem('splashShown', '1'); // suppress splash so the pill is asserted directly
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    sessionStorage.clear();
    await _resetClientDataDbForTests();
  });

  it('mounts the AdultModeToggle in the brand-bar header', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <Root />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /adult mode/i })).toBeInTheDocument(),
    );
    // The pill lives inside the brand-bar header (sibling to logo + badge).
    const pill = screen.getByRole('button', { name: /adult mode/i });
    expect(pill.closest('header')).not.toBeNull();
  });
});
