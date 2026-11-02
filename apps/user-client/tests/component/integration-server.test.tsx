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

  it('marks the form unsaved after a successful test, whose result only Save keeps', async () => {
    useMcpServersMock.mockReturnValue({ data: [ROW] });
    testConnMock.mockResolvedValue({
      ok: true,
      routing: 'proxy',
      resolvedEndpoint: 'https://wiki.example/mcp',
      tools: [],
      error: null,
    });
    wrapAt('/app/integrations/s1');
    expect(screen.queryByText(/Unsaved/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Test connection/ }));
    expect(await screen.findByText(/Unsaved/)).toBeTruthy();
  });

  describe('synced tools survive anything short of a good test or a new URL', () => {
    const TOOLS = [{ name: 'go', description: '', inputSchema: {} }];
    const WITH_TOOLS: McpServerRow = {
      ...ROW,
      name: 'Wiki tools',
      routing: 'proxy',
      resolvedEndpoint: 'https://wiki.example/mcp',
      tools: TOOLS,
    };

    async function saveAndGetRow(): Promise<McpServerRow> {
      fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
      await screen.findByText('integrations list');
      return upsertMock.mock.calls.at(-1)?.[0] as McpServerRow;
    }

    it('keeps them when a test fails and the user saves', async () => {
      useMcpServersMock.mockReturnValue({ data: [WITH_TOOLS] });
      testConnMock.mockResolvedValue({
        ok: false,
        routing: null,
        resolvedEndpoint: null,
        tools: [],
        error: 'HTTP 503',
      });
      wrapAt('/app/integrations/s1');
      fireEvent.click(screen.getByRole('button', { name: /Test connection/ }));
      await screen.findByText(/HTTP 503/);
      expect((await saveAndGetRow()).tools).toEqual(TOOLS);
    });

    it('keeps them when Local network is toggled and the user saves', async () => {
      useMcpServersMock.mockReturnValue({ data: [WITH_TOOLS] });
      wrapAt('/app/integrations/s1');
      fireEvent.click(screen.getByRole('checkbox', { name: /Local network/ }));
      const row = await saveAndGetRow();
      expect(row.tools).toEqual(TOOLS);
      expect(row.routing).toBeNull();
    });

    it('drops them when the URL changes', async () => {
      useMcpServersMock.mockReturnValue({ data: [WITH_TOOLS] });
      wrapAt('/app/integrations/s1');
      fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://new.example' } });
      expect((await saveAndGetRow()).tools).toEqual([]);
    });
  });

  it('does not nag when re-testing a healthy server changes nothing', async () => {
    const tools = [{ name: 'go', description: '', inputSchema: {} }];
    useMcpServersMock.mockReturnValue({
      data: [{ ...ROW, routing: 'proxy', resolvedEndpoint: 'https://wiki.example/mcp', tools }],
    });
    testConnMock.mockResolvedValue({
      ok: true,
      routing: 'proxy',
      resolvedEndpoint: 'https://wiki.example/mcp',
      tools,
      error: null,
    });
    wrapAt('/app/integrations/s1');
    fireEvent.click(screen.getByRole('button', { name: /Test connection/ }));
    await screen.findByText(/Connected/);
    expect(screen.queryByText(/Unsaved/)).toBeNull();
  });

  it('opens a remove confirm and deletes on confirm', () => {
    useMcpServersMock.mockReturnValue({ data: [ROW] });
    wrapAt('/app/integrations/s1');
    fireEvent.click(screen.getByRole('button', { name: /remove server/i }));
    fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));
    expect(deleteMock).toHaveBeenCalledWith('s1');
  });
});
