// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { checkServerMock } = vi.hoisted(() => ({ checkServerMock: vi.fn() }));

vi.mock('@chatsundere/ui-shared', () => ({
  useAccountLinkStore: (selector: (s: { linkStatus: string }) => unknown) =>
    selector({ linkStatus: 'linked' }),
}));
vi.mock('../../../src/mcp/oauth/check-server.js', () => ({
  checkServer: (...a: unknown[]) => checkServerMock(...a),
}));

import { CheckServerStep } from '../../../src/components/mcp/CheckServerStep.js';
import { MCP_REDIRECT_CHECK } from '../../../src/mcp/redirect-copy.js';

function renderStep(): void {
  render(
    <MemoryRouter>
      <CheckServerStep hasProxy={true} onResult={vi.fn()} onManual={vi.fn()} />
    </MemoryRouter>,
  );
}

describe('CheckServerStep on a redirecting link', () => {
  beforeEach(() => checkServerMock.mockReset());

  it('shows the redirect sentence, never "Couldn\'t reach", with Try again and the field editable', async () => {
    checkServerMock.mockResolvedValue({
      kind: 'unreachable',
      directOnly: false,
      error: MCP_REDIRECT_CHECK,
      cause: 'redirect',
    });
    renderStep();
    const user = userEvent.setup();
    const field = screen.getByLabelText('Server link');
    await user.type(field, 'https://moved.example/mcp');
    await user.click(screen.getByRole('button', { name: 'Check server' }));

    expect(await screen.findByText(MCP_REDIRECT_CHECK)).toBeTruthy();
    expect(screen.queryByText(/Couldn't reach/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect((field as HTMLInputElement).readOnly).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(checkServerMock).toHaveBeenCalledTimes(2);
  });
});
