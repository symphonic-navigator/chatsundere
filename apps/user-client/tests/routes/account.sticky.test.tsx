// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AccountPage } from '../../src/routes/app/account.js';

describe('My Account sticky region', () => {
  it('wraps the EditorTopbar in the sticky region', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <AccountPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText(/back/i)).toBeInTheDocument());
    const back = screen.getByLabelText(/back/i);
    const sticky = back.closest('[data-editor-sticky]');
    expect(sticky).not.toBeNull();
  });
});
