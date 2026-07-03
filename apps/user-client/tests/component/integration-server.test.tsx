// SPDX-License-Identifier: AGPL-3.0-only
import { vi } from 'vitest';

const { useMcpServersMock, upsertMock, deleteMock, testConnMock } = vi.hoisted(() => ({
  useMcpServersMock: vi.fn(() => ({ data: [] as unknown[] })),
  upsertMock: vi.fn(async (row: unknown) => row),
  deleteMock: vi.fn(),
  testConnMock: vi.fn(),
}));

vi.mock('@chatsundere/ui-shared', () => ({
  useSessionStore: (selector: (s: { mk: CryptoKey }) => unknown) =>
    selector({ mk: {} as CryptoKey }),
}));
vi.mock('../../src/data/mcp-servers.js', () => ({
  useMcpServers: () => useMcpServersMock(),
  useUpsertMcpServer: () => ({ mutate: vi.fn(), mutateAsync: upsertMock }),
  useDeleteMcpServer: () => ({ mutate: deleteMock }),
  sealMcpKey: vi.fn(async () => ({ blob: 'sealed' })),
  openMcpKey: vi.fn(async () => 'plain'),
}));
vi.mock('../../src/lib/server-gate.js', () => ({
  useServerGate: () => ({ enabled: true, reason: null, tooltip: null }),
}));
vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: () => ({ onHelp: vi.fn(), helpOverlay: null }),
}));
vi.mock('../../src/lib/secrets.js', () => ({
  openSecret: vi.fn(async () => 'plain'),
  sealSecret: vi.fn(async () => ({ blob: 'sealed' })),
}));
vi.mock('../../src/mcp/mcp-connectivity.js', () => ({
  testMcpConnection: (a: unknown) => testConnMock(a),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import type { McpServerRow } from '../../src/boot/client-data-db.js';
import { IntegrationServerPage } from '../../src/routes/app/integrations/server.js';

const ROW: McpServerRow = {
  id: 's1',
  name: 'Wiki tools',
  url: 'https://wiki.example/mcp',
  prefix: 'wiki',
  auth: null,
  onByDefault: false,
  autoRun: false,
  allowDirect: false,
  enabled: true,
  routing: null,
  resolvedEndpoint: null,
  tools: [],
  hiddenTools: [],
  lastTestedAt: null,
  lastError: null,
  createdAt: 1,
  updatedAt: 1,
};

function wrapAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/app/integrations/new" element={<IntegrationServerPage />} />
          <Route path="/app/integrations/:serverId" element={<IntegrationServerPage />} />
          <Route path="/app/integrations" element={<div>integrations list</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('IntegrationServerPage', () => {
  beforeEach(() => {
    cleanup();
    useMcpServersMock.mockReturnValue({ data: [] });
  });

  it('renders empty Name/URL fields and a Save action in add mode', () => {
    wrapAt('/app/integrations/new');
    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(screen.getByLabelText('URL')).toHaveValue('');
    expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument();
  });

  it('seeds the form from an existing row in edit mode', () => {
    useMcpServersMock.mockReturnValue({ data: [ROW] });
    wrapAt('/app/integrations/s1');
    expect(screen.getByLabelText('Name')).toHaveValue('Wiki tools');
    expect(screen.getByLabelText('URL')).toHaveValue('https://wiki.example/mcp');
  });

  it('shows a calm notice for an unknown server id', () => {
    useMcpServersMock.mockReturnValue({ data: [] });
    wrapAt('/app/integrations/does-not-exist');
    expect(screen.getByText(/no longer here/i)).toBeInTheDocument();
  });

  it('disables Test connection until a URL is present', () => {
    wrapAt('/app/integrations/new');
    expect(screen.getByRole('button', { name: /test connection/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://x/mcp' } });
    expect(screen.getByRole('button', { name: /test connection/i })).toBeEnabled();
  });

  it('marks the form dirty (Unsaved badge) once a field changes', () => {
    wrapAt('/app/integrations/new');
    expect(screen.queryByText(/unsaved/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'X' } });
    expect(screen.getByText(/unsaved/i)).toBeInTheDocument();
  });

  it('opens a remove confirm and deletes on confirm', () => {
    useMcpServersMock.mockReturnValue({ data: [ROW] });
    wrapAt('/app/integrations/s1');
    fireEvent.click(screen.getByRole('button', { name: /remove server/i }));
    fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));
    expect(deleteMock).toHaveBeenCalledWith('s1');
  });
});
