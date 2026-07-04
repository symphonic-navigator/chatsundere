// SPDX-License-Identifier: AGPL-3.0-only
import type { AdminCreateInvitationResponse } from '@chatsundere/shared-types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createInvitationMock = vi.fn();
vi.mock('../../src/data/api.js', () => ({
  createInvitation: (input: unknown) => createInvitationMock(input),
}));

import { HttpError } from '../../src/lib/fetch.js';
import { InvitationCreateModal } from '../../src/routes/invitations/create-modal.js';

function Providers({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const RESPONSE: AdminCreateInvitationResponse = {
  invitation_id: 'i1',
  code: 'ABCDEFGHIJ',
  qr_url: 'http://auth.test/join#ABCDEFGHIJ',
  expires_at: '2026-07-11T00:00:00Z',
  state: 'active',
};

beforeEach(() => {
  createInvitationMock.mockReset();
});

describe('invitation create flow', () => {
  it('preserves the filled form when step-up is declined, then reveals on retry', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    render(<InvitationCreateModal onCreated={onCreated} onCancel={() => {}} />, {
      wrapper: Providers,
    });

    // Fill the form with values we expect to survive a declined step-up.
    await user.type(screen.getByLabelText(/suggested username/i), 'newbie');
    await user.type(screen.getByLabelText(/issuer label/i), 'June wave');

    // First submit: the server refuses (step-up required → HttpError).
    createInvitationMock.mockRejectedValueOnce(new HttpError(403, 'step_up_required', 'denied'));
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    // The failure line surfaces and the typed input is still present.
    expect(await screen.findByTestId('create-invitation-error')).toBeInTheDocument();
    expect(screen.getByLabelText(/suggested username/i)).toHaveValue('newbie');
    expect(screen.getByLabelText(/issuer label/i)).toHaveValue('June wave');
    expect(onCreated).not.toHaveBeenCalled();

    // Second submit: the step-up succeeds and the response flows to onCreated.
    createInvitationMock.mockResolvedValueOnce(RESPONSE);
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await vi.waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onCreated.mock.calls[0]?.[0]).toEqual(RESPONSE);
    expect(createInvitationMock).toHaveBeenLastCalledWith({
      role: 'user',
      expires_in_days: 7,
      issuer_label: 'June wave',
      suggested_username: 'newbie',
    });
  });
});
