// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerGate } from '../../src/lib/server-gate.js';

let gate: ServerGate = { enabled: true, reason: null, tooltip: null };
let issuerLabel: string | null = 'acme.example';

vi.mock('../../src/lib/server-gate.js', () => ({
  useServerGate: () => gate,
}));
vi.mock('@chatsundere/ui-shared', () => ({
  useAccountLinkStore: (sel: (s: { issuerLabel: string | null }) => unknown) =>
    sel({ issuerLabel }),
}));

import { ServerRelayStatus } from '../../src/components/ServerRelayStatus.js';

function renderStatus() {
  return render(
    <MemoryRouter>
      <ServerRelayStatus />
    </MemoryRouter>,
  );
}

describe('ServerRelayStatus', () => {
  beforeEach(() => {
    gate = { enabled: true, reason: null, tooltip: null };
    issuerLabel = 'acme.example';
  });

  it('describes the linked relay with the issuer label when the gate is enabled', () => {
    renderStatus();
    expect(screen.getByText(/routed via your linked server/i)).toBeInTheDocument();
    expect(screen.getByText(/acme\.example/)).toBeInTheDocument();
    // The retired CORS-proxy vocabulary must not resurface.
    expect(screen.queryByText(/cors proxy/i)).not.toBeInTheDocument();
  });

  it('shows the gate tooltip and a server-linking link when local-only', () => {
    gate = { enabled: false, reason: 'local-only', tooltip: 'Link a server to relay providers.' };
    renderStatus();
    expect(screen.getByText(/link a server to relay providers/i)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /open server linking/i });
    expect(link.getAttribute('href')).toBe('/app/account/server-linking');
    expect(screen.queryByText(/cors proxy/i)).not.toBeInTheDocument();
  });

  it('shows a server-linking link when the session needs re-auth (auth-action)', () => {
    gate = {
      enabled: false,
      reason: 'auth-action',
      tooltip: 'Your server stopped recognising this session.',
    };
    renderStatus();
    const link = screen.getByRole('link', { name: /open server linking/i });
    expect(link.getAttribute('href')).toBe('/app/account/server-linking');
  });

  it('shows the tooltip without a linking link when offline (no useful destination)', () => {
    gate = { enabled: false, reason: 'offline', tooltip: 'The server is unreachable.' };
    renderStatus();
    expect(screen.getByText(/the server is unreachable/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /open server linking/i })).not.toBeInTheDocument();
  });
});
