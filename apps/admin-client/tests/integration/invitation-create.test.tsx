// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('qrcode', () => ({
  default: { toCanvas: vi.fn().mockResolvedValue(undefined) },
}));

import { InvitationsScreen } from '../../src/routes/invitations/index.js';

function Providers({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('invitation create flow', () => {
  it('opens the create modal, submits, reveals the token, and hides it on close', async () => {
    const user = userEvent.setup();
    render(<InvitationsScreen />, { wrapper: Providers });

    await user.click(await screen.findByRole('button', { name: /create invitation/i }));
    expect(await screen.findByRole('heading', { name: /create invitation/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^create$/i }));

    expect(await screen.findByRole('heading', { name: /invitation created/i })).toBeInTheDocument();
    expect(screen.getByText(/shown only once/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/url/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^close$/i }));
    expect(screen.queryByRole('heading', { name: /invitation created/i })).not.toBeInTheDocument();
  });
});
