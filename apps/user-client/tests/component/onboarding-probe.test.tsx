// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const probeServer = vi.fn();
vi.mock('@chatsundere/ui-shared', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  probeServer: (url: string) => probeServer(url),
}));

import { copy } from '../../src/lib/copy.js';
import { InvitationForm } from '../../src/routes/onboarding/invitation/form.js';

describe('invitation form probe', () => {
  beforeEach(() => probeServer.mockReset());

  async function fillAndSubmit() {
    render(
      <MemoryRouter>
        <InvitationForm />
      </MemoryRouter>,
    );
    await userEvent.type(screen.getByLabelText(/server/i), 'https://srv.example');
    await userEvent.type(screen.getByLabelText(/code/i), 'ABCDE-FGHJK');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  }

  it('blocks on unreachable with constructive copy, input preserved', async () => {
    probeServer.mockResolvedValue({ kind: 'unreachable' });
    await fillAndSubmit();
    await screen.findByText(copy.onboardingProbe.unreachable);
    expect(screen.getByLabelText(/server/i)).toHaveValue('https://srv.example');
  });

  it('blocks on invalid with the not-a-chatsundere-server copy', async () => {
    probeServer.mockResolvedValue({ kind: 'invalid' });
    await fillAndSubmit();
    await screen.findByText(copy.onboardingProbe.invalid);
  });

  it('proceeds on ok', async () => {
    probeServer.mockResolvedValue({ kind: 'ok', config: { features: [] } });
    await fillAndSubmit();
    expect(probeServer).toHaveBeenCalledWith('https://srv.example');
    expect(screen.queryByText(copy.onboardingProbe.unreachable)).toBeNull();
  });
});
