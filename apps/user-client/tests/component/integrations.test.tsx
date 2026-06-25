// SPDX-License-Identifier: AGPL-3.0-only
import { vi } from 'vitest';

const { useMcpServersMock } = vi.hoisted(() => ({
  useMcpServersMock: vi.fn(() => ({ data: [] as unknown[] })),
}));

vi.mock('../../src/data/mcp-servers.js', () => ({ useMcpServers: () => useMcpServersMock() }));
vi.mock('../../src/data/settings.js', () => ({
  useSettings: () => ({ data: { corsProxy: null } }),
}));
vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: () => ({ onHelp: vi.fn(), helpOverlay: null }),
}));

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import type { McpServerRow } from '../../src/boot/client-data-db.js';
import { Integrations } from '../../src/routes/app/integrations.js';

const ROW: McpServerRow = {
  id: 's1',
  name: 'Wiki tools',
  url: 'https://wiki.example/mcp',
  prefix: 'wiki',
  auth: null,
  onByDefault: true,
  autoRun: false,
  allowDirect: false,
  enabled: true,
  routing: 'proxy',
  resolvedEndpoint: 'https://proxy/x',
  tools: [],
  hiddenTools: [],
  lastTestedAt: 1,
  lastError: null,
  createdAt: 1,
  updatedAt: 1,
};

function wrap() {
  return render(
    <MemoryRouter initialEntries={['/app/integrations']}>
      <Routes>
        <Route path="/app/integrations" element={<Integrations />} />
        <Route path="/app/integrations/new" element={<div>add server screen</div>} />
        <Route path="/app/integrations/:serverId" element={<div>detail screen</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Integrations list', () => {
  beforeEach(() => {
    cleanup();
    useMcpServersMock.mockReturnValue({ data: [] });
  });

  it('shows the empty state and an add affordance when there are no servers', () => {
    wrap();
    expect(screen.getByText(/no mcp servers yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add mcp server/i })).toBeInTheDocument();
  });

  it('navigates to the add page from the add button', () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: /add mcp server/i }));
    expect(screen.getByText('add server screen')).toBeInTheDocument();
  });

  it('renders a server row with its status and a Default badge, and opens its detail', () => {
    useMcpServersMock.mockReturnValue({ data: [ROW] });
    wrap();
    expect(screen.getByText('Wiki tools')).toBeInTheDocument();
    expect(screen.getByText(/needs proxy/i)).toBeInTheDocument();
    expect(screen.getByText('Default: On')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Wiki tools'));
    expect(screen.getByText('detail screen')).toBeInTheDocument();
  });
});
