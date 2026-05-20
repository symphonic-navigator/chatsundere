// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/routes/login/decision-tree.js', () => ({
  runDecisionTreePreLogin: vi.fn(),
  classifyPostLogin: vi.fn(),
}));

import { runDecisionTreePreLogin } from '../../src/routes/login/decision-tree.js';
import { LoginScreen } from '../../src/routes/login/index.js';

function Wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe('LoginScreen decision tree', () => {
  beforeEach(() => {
    vi.mocked(runDecisionTreePreLogin).mockReset();
  });

  it('shows the noAccount failure state when local_account is missing', async () => {
    vi.mocked(runDecisionTreePreLogin).mockResolvedValue({ branch: 'no_account' });
    render(<LoginScreen />, { wrapper: Wrapper });
    expect(await screen.findByText(/No account on this device/i)).toBeInTheDocument();
  });

  it('shows the noLink failure state when linked_account is missing', async () => {
    vi.mocked(runDecisionTreePreLogin).mockResolvedValue({ branch: 'no_link' });
    render(<LoginScreen />, { wrapper: Wrapper });
    expect(await screen.findByText(/Account is not linked to a server/i)).toBeInTheDocument();
  });

  it('shows the offline failure state when offline', async () => {
    vi.mocked(runDecisionTreePreLogin).mockResolvedValue({ branch: 'offline' });
    render(<LoginScreen />, { wrapper: Wrapper });
    expect(await screen.findByText(/Server connection required/i)).toBeInTheDocument();
  });

  it('shows the login form when pre-login passes', async () => {
    vi.mocked(runDecisionTreePreLogin).mockResolvedValue({ branch: 'ready' });
    render(<LoginScreen />, { wrapper: Wrapper });
    expect(await screen.findByLabelText(/Passphrase/i)).toBeInTheDocument();
  });
});
