// SPDX-License-Identifier: AGPL-3.0-only
import { vi } from 'vitest';

const { useMcpServersMock, gate, grants, pending, link, finishMock, sweepMock } = vi.hoisted(
  () => ({
    useMcpServersMock: vi.fn(() => ({ data: [] as unknown[] })),
    gate: { enabled: false },
    grants: { rows: [] as unknown[] },
    pending: { rows: [] as unknown[] },
    link: { status: 'local-only' },
    finishMock: vi.fn(async () => undefined),
    sweepMock: vi.fn(async () => undefined),
  }),
);

vi.mock('../../src/data/mcp-servers.js', () => ({ useMcpServers: () => useMcpServersMock() }));
vi.mock('../../src/data/mcp-oauth-grants.js', () => ({
  useMcpOAuthGrants: () => ({ data: grants.rows }),
}));
vi.mock('../../src/data/mcp-oauth-pending.js', () => ({
  usePendingSignIns: () => ({ data: pending.rows }),
}));
vi.mock('../../src/mcp/oauth/sign-in.js', () => ({
  finishOrphanedSignIns: () => finishMock(),
  sweepExpiredSignIns: () => sweepMock(),
}));
vi.mock('@chatsundere/ui-shared', () => ({
  useAccountLinkStore: (sel: (s: { linkStatus: string }) => unknown) =>
    sel({ linkStatus: link.status }),
}));
vi.mock('../../src/data/settings.js', () => ({
  useSettings: () => ({ data: { corsProxy: null } }),
}));
vi.mock('../../src/lib/server-gate.js', () => ({
  useServerGate: () => ({ enabled: gate.enabled, reason: null, tooltip: null }),
}));
vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: () => ({ onHelp: vi.fn(), helpOverlay: null }),
}));

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  resolvedEndpoint: 'https://wiki.example/mcp',
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
        <Route path="/app/integrations/sign-in/:state" element={<div>waiting screen</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Integrations list', () => {
  beforeEach(() => {
    cleanup();
    useMcpServersMock.mockReturnValue({ data: [] });
    grants.rows = [];
    pending.rows = [];
    link.status = 'local-only';
    finishMock.mockClear();
  });

  describe('a server synced from another device', () => {
    beforeEach(() => {
      gate.enabled = true;
    });
    afterEach(() => {
      gate.enabled = false;
    });

    const pulled = (over: Partial<McpServerRow> = {}) => {
      const { routing: _r, resolvedEndpoint: _e, ...rest } = ROW;
      return {
        ...rest,
        allowDirect: false,
        tools: [{ name: 'go', description: '', inputSchema: {} }],
        ...over,
      };
    };

    it('reads as connecting on first use, never as connected', () => {
      useMcpServersMock.mockReturnValue({ data: [pulled()] });
      wrap();
      expect(screen.queryByText(/Connected/)).toBeNull();
      expect(screen.getByText(/Connects on first use/)).toBeTruthy();
    });

    it('reads as not tested when it is a Local network server, which never probes itself', () => {
      useMcpServersMock.mockReturnValue({ data: [pulled({ allowDirect: true })] });
      wrap();
      expect(screen.getByText(/Not tested/)).toBeTruthy();
    });

    it('shows the saved error rather than hiding a failed test', () => {
      useMcpServersMock.mockReturnValue({ data: [pulled({ lastError: 'HTTP 503' })] });
      wrap();
      expect(screen.getByText(/HTTP 503/)).toBeTruthy();
    });

    it('does not read as connected when its stored route points elsewhere', () => {
      useMcpServersMock.mockReturnValue({
        data: [pulled({ routing: 'proxy', resolvedEndpoint: 'https://old.example/mcp' })],
      });
      wrap();
      expect(screen.queryByText(/Connected/)).toBeNull();
    });

    it('still reads as not tested when no device has ever connected', () => {
      useMcpServersMock.mockReturnValue({ data: [pulled({ tools: [] })] });
      wrap();
      expect(screen.getByText(/Not tested/)).toBeTruthy();
    });
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

  it('finishes orphaned sign-ins when the list loads', () => {
    wrap();
    expect(finishMock).toHaveBeenCalled();
  });

  describe('OAuth servers', () => {
    const OAUTH: McpServerRow = {
      ...ROW,
      id: 'o1',
      name: 'Kumbu',
      url: 'https://kumbu.example/mcp',
      resolvedEndpoint: 'https://kumbu.example/mcp',
      auth: { scheme: 'oauth' },
      tools: [{ name: 'go', description: '', inputSchema: {} }],
    };
    const grant = (over: Record<string, unknown> = {}) => ({
      id: 'o1',
      resource: 'https://kumbu.example/mcp',
      tokens: { v: 1 },
      claim: null,
      ...over,
    });

    beforeEach(() => {
      gate.enabled = true;
    });
    afterEach(() => {
      gate.enabled = false;
    });

    it('shows a pending new server as a row leading back to the waiting screen', () => {
      pending.rows = [
        { state: 'st-1', serverId: 'new-1', isNewServer: true, name: 'Kumbu', createdAt: 1 },
      ];
      wrap();
      expect(screen.getByText('○ Sign-in in progress')).toBeTruthy();
      fireEvent.click(screen.getByText('Kumbu'));
      expect(screen.getByText('waiting screen')).toBeTruthy();
    });

    it('reads a missing grant as connecting on first use, never as Sign in again', () => {
      useMcpServersMock.mockReturnValue({
        data: [{ ...OAUTH, routing: null, resolvedEndpoint: null }],
      });
      wrap();
      expect(screen.getByText('○ Connects on first use')).toBeTruthy();
      expect(screen.queryByText(/Sign in again/)).toBeNull();
    });

    it('reads a missing grant as connecting on first use even with a route', () => {
      useMcpServersMock.mockReturnValue({ data: [OAUTH] });
      wrap();
      expect(screen.getByText('○ Connects on first use')).toBeTruthy();
    });

    it('asks to sign in again when the grant holds no tokens', () => {
      useMcpServersMock.mockReturnValue({ data: [OAUTH] });
      grants.rows = [grant({ tokens: null })];
      wrap();
      expect(screen.getByText('⚠ Sign in again')).toBeTruthy();
    });

    it('does not ask to sign in again while a fresh pair waits to be published', () => {
      useMcpServersMock.mockReturnValue({ data: [OAUTH] });
      grants.rows = [grant({ tokens: null, pendingTokens: { v: 1 } })];
      wrap();
      expect(screen.queryByText(/Sign in again/)).toBeNull();
      expect(screen.getByText(/Connected/)).toBeTruthy();
    });

    it('puts a sign-in in progress ahead of a saved error', () => {
      useMcpServersMock.mockReturnValue({ data: [{ ...OAUTH, lastError: 'HTTP 401' }] });
      grants.rows = [grant()];
      pending.rows = [
        { state: 's', serverId: 'o1', isNewServer: false, name: 'Kumbu', createdAt: 1 },
      ];
      wrap();
      expect(screen.getByText('○ Sign-in in progress')).toBeTruthy();
      expect(screen.queryByText(/HTTP 401/)).toBeNull();
      fireEvent.click(screen.getByText('Kumbu'));
      expect(screen.getByText('detail screen')).toBeTruthy();
    });

    it('waits for the Chatsundere server rather than saying Needs proxy, when linked', () => {
      gate.enabled = false;
      link.status = 'linked';
      useMcpServersMock.mockReturnValue({ data: [OAUTH] });
      grants.rows = [grant()];
      wrap();
      expect(screen.getByText('○ Waiting for your Chatsundere server')).toBeTruthy();
      expect(screen.queryByText(/Needs proxy/)).toBeNull();
    });

    it('says linking is needed on a device with no proxy at all', () => {
      gate.enabled = false;
      link.status = 'local-only';
      useMcpServersMock.mockReturnValue({ data: [OAUTH] });
      grants.rows = [grant()];
      wrap();
      expect(screen.getByText('○ Needs a linked Chatsundere server')).toBeTruthy();
    });

    it('reads as connected with a live grant and a usable route', () => {
      useMcpServersMock.mockReturnValue({ data: [OAUTH] });
      grants.rows = [grant()];
      wrap();
      expect(screen.getByText('● Connected (via proxy)')).toBeTruthy();
    });
  });
});
