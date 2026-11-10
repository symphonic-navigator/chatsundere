// SPDX-License-Identifier: AGPL-3.0-only
import { vi } from 'vitest';

const {
  useMcpServersMock,
  upsertMock,
  deleteMock,
  testConnMock,
  checkServerMock,
  testOAuthMock,
  removeGrantMock,
  consentMock,
  consentForMock,
  grants,
  pending,
  gates,
  flowProps,
} = vi.hoisted(() => ({
  useMcpServersMock: vi.fn(() => ({ data: [] as unknown[] })),
  upsertMock: vi.fn(async (row: unknown, _opts?: unknown) => row),
  deleteMock: vi.fn(),
  testConnMock: vi.fn(),
  checkServerMock: vi.fn(),
  testOAuthMock: vi.fn(),
  removeGrantMock: vi.fn(),
  consentMock: vi.fn(async () => undefined),
  consentForMock: vi.fn(async () => undefined),
  grants: { rows: [] as unknown[] },
  pending: { rows: [] as unknown[] },
  gates: {
    proxy: true,
    link: 'linked',
    class2: { disabled: false, tooltip: null as string | null },
  },
  flowProps: { current: null as null | Record<string, unknown> },
}));

vi.mock('@chatsundere/ui-shared', () => ({
  useSessionStore: (selector: (s: { mk: CryptoKey }) => unknown) =>
    selector({ mk: {} as CryptoKey }),
  useAccountLinkStore: (selector: (s: { linkStatus: string }) => unknown) =>
    selector({ linkStatus: gates.link }),
}));
vi.mock('../../src/data/mcp-servers.js', () => ({
  useMcpServers: () => useMcpServersMock(),
  useUpsertMcpServer: (opts?: unknown) => ({
    mutate: vi.fn(),
    mutateAsync: (row: unknown) => upsertMock(row, opts),
  }),
  useDeleteMcpServer: () => ({ mutate: deleteMock }),
  sealMcpKey: vi.fn(async () => ({ blob: 'sealed' })),
  openMcpKey: vi.fn(async () => 'plain'),
  recordMcpConsent: (...a: unknown[]) => consentMock(...(a as [])),
  recordMcpConsentForServer: (...a: unknown[]) => consentForMock(...(a as [])),
}));
vi.mock('../../src/data/mcp-oauth-grants.js', () => ({
  useMcpOAuthGrants: () => ({ data: grants.rows }),
}));
vi.mock('../../src/data/mcp-oauth-pending.js', () => ({
  usePendingSignIns: () => ({ data: pending.rows }),
}));
vi.mock('../../src/lib/server-gate.js', () => ({
  useServerGate: () => ({ enabled: gates.proxy, reason: null, tooltip: null }),
}));
vi.mock('../../src/sync/gate.js', () => ({
  useClass2Gate: () => gates.class2,
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
vi.mock('../../src/mcp/oauth/check-server.js', () => ({
  checkServer: (...a: unknown[]) => checkServerMock(...a),
}));
vi.mock('../../src/mcp/oauth/connect-server.js', async (orig) => ({
  ...(await orig<typeof import('../../src/mcp/oauth/connect-server.js')>()),
  testOAuthConnection: (...a: unknown[]) => testOAuthMock(...a),
}));
vi.mock('../../src/mcp/oauth/sign-in-session.js', () => ({
  createSignInDeps: async () => ({ fake: true }),
}));
vi.mock('../../src/mcp/oauth/sign-in.js', async (orig) => ({
  ...(await orig<typeof import('../../src/mcp/oauth/sign-in.js')>()),
  removeGrant: (...a: unknown[]) => removeGrantMock(...a),
}));
vi.mock('../../src/components/mcp/OAuthSignInFlow.js', () => ({
  OAuthSignInFlow: (p: Record<string, unknown>) => {
    flowProps.current = p;
    return (
      <div>
        <span>sign-in flow</span>
        <button
          type="button"
          onClick={() =>
            (p.onConnected as (r: unknown) => void)({
              serverId: (p.serverId as string | undefined) ?? 'new-id',
              draft: p.draft,
            })
          }
        >
          stub connected
        </button>
        {p.state !== undefined ? (
          <button
            type="button"
            onClick={() =>
              (p.onConnected as (r: unknown) => void)({
                serverId: 'new-9',
                draft: {
                  name: 'Kumbu',
                  prefix: 'kumbu',
                  url: 'https://kumbu.example/mcp',
                  onByDefault: true,
                  autoRun: false,
                  allowDirect: false,
                  routing: 'proxy',
                  resolvedEndpoint: 'https://kumbu.example/mcp',
                },
              })
            }
          >
            stub resumed connected
          </button>
        ) : null}
      </div>
    );
  },
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import type { McpOAuthGrantRow, McpServerRow } from '../../src/boot/client-data-db.js';
import type { OAuthDiscovery } from '../../src/mcp/oauth/discovery.js';
import { IntegrationServerPage } from '../../src/routes/app/integrations/server.js';
import { PendingSignInPage } from '../../src/routes/app/integrations/sign-in.js';
import { useToastStore } from '../../src/state/toast.store.js';

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
          <Route path="/app/integrations/sign-in/:state" element={<PendingSignInPage />} />
          <Route path="/app/integrations/:serverId" element={<IntegrationServerPage />} />
          <Route path="/app/integrations" element={<div>integrations list</div>} />
          <Route path="/app/account/server-linking" element={<div>server linking</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('IntegrationServerPage', () => {
  beforeEach(() => {
    cleanup();
    useMcpServersMock.mockReturnValue({ data: [] });
    upsertMock.mockClear();
    deleteMock.mockClear();
    checkServerMock.mockReset();
    testOAuthMock.mockReset();
    removeGrantMock.mockReset();
    consentMock.mockClear();
    grants.rows = [];
    pending.rows = [];
    gates.proxy = true;
    gates.link = 'linked';
    consentForMock.mockClear();
    gates.class2 = { disabled: false, tooltip: null };
    flowProps.current = null;
    useToastStore.getState().clear();
  });

  // The first screen of Add is now the link and Check server; today's form sits behind this.
  const manual = () =>
    fireEvent.click(screen.getByRole('button', { name: 'Enter details manually' }));

  it('renders empty Name/URL fields and a Save action in add mode', () => {
    wrapAt('/app/integrations/new');
    manual();
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
    manual();
    expect(screen.getByRole('button', { name: /test connection/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://x/mcp' } });
    expect(screen.getByRole('button', { name: /test connection/i })).toBeEnabled();
  });

  it('marks the form dirty (Unsaved badge) once a field changes', () => {
    wrapAt('/app/integrations/new');
    manual();
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

  it('keeps the remove copy of a key server as it was', () => {
    useMcpServersMock.mockReturnValue({ data: [ROW] });
    wrapAt('/app/integrations/s1');
    fireEvent.click(screen.getByRole('button', { name: /remove server/i }));
    expect(
      screen.getByText(
        'The server and its stored key are deleted. Personas lose access to its tools.',
      ),
    ).toBeTruthy();
    expect(removeGrantMock).not.toHaveBeenCalled();
  });

  describe('Add server: link first', () => {
    const DISCOVERY: OAuthDiscovery = {
      kind: 'oauth',
      resource: 'https://kumbu.example/mcp',
      issuer: 'https://auth.kumbu.example',
      resourceName: 'Kumbu',
      authorizationEndpoint: 'https://auth.kumbu.example/authorize',
      tokenEndpoint: 'https://auth.kumbu.example/token',
      registrationEndpoint: null,
      revocationEndpoint: null,
      cimdSupported: true,
      issParameterSupported: false,
      viaProxy: false,
      scope: null,
    };
    const signIn = (over: Record<string, unknown> = {}) => ({
      kind: 'sign-in',
      discovery: DISCOVERY,
      route: 'proxy',
      endpoint: 'https://kumbu.example/mcp',
      ...over,
    });

    async function check(link = 'https://Kumbu.example/mcp/') {
      fireEvent.change(screen.getByLabelText('Server link'), { target: { value: link } });
      fireEvent.click(screen.getByRole('button', { name: 'Check server' }));
    }

    it('opens with the link field and Check server, and nothing else yet', () => {
      wrapAt('/app/integrations/new');
      expect(screen.getByLabelText('Server link')).toHaveValue('');
      expect(screen.getByRole('button', { name: 'Check server' })).toBeDisabled();
      expect(screen.queryByLabelText('Name')).toBeNull();
      expect(screen.queryByRole('button', { name: /^save$/i })).toBeNull();
    });

    it('puts Local network in the manual path, ahead of any probe', () => {
      wrapAt('/app/integrations/new');
      manual();
      expect(screen.getByRole('checkbox', { name: /Local network/ })).toBeTruthy();
      expect(screen.getByLabelText('Name')).toBeTruthy();
      expect(checkServerMock).not.toHaveBeenCalled();
    });

    it('carries the typed link into the manual form', () => {
      wrapAt('/app/integrations/new');
      fireEvent.change(screen.getByLabelText('Server link'), {
        target: { value: 'http://192.168.1.5/mcp' },
      });
      manual();
      expect(screen.getByLabelText('URL')).toHaveValue('http://192.168.1.5/mcp');
    });

    it('checks the link through checkServer with this device’s proxy state', async () => {
      checkServerMock.mockResolvedValue(signIn());
      wrapAt('/app/integrations/new');
      await check();
      await screen.findByText('Sign-in required');
      expect(checkServerMock).toHaveBeenCalledWith('https://Kumbu.example/mcp/', {
        hasProxy: true,
        allowDirect: false,
      });
    });

    describe('sign-in result', () => {
      it('prefills the name, a unique prefix, and turns On by default on', async () => {
        useMcpServersMock.mockReturnValue({
          data: [
            {
              ...ROW,
              id: 'k1',
              name: 'Other',
              prefix: 'Kumbu',
              url: 'https://kumbu.example/other',
            },
          ],
        });
        checkServerMock.mockResolvedValue(signIn());
        wrapAt('/app/integrations/new');
        await check();
        expect(await screen.findByLabelText('Name')).toHaveValue('Kumbu');
        expect(screen.getByLabelText('Tool prefix')).toHaveValue('Kumbu_2');
        expect(screen.getByRole('checkbox', { name: 'On by default' })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: /Trusted/ })).not.toBeChecked();
        expect(screen.getByRole('checkbox', { name: /Local network/ })).toBeTruthy();
      });

      it('falls back to the host for the name', async () => {
        checkServerMock.mockResolvedValue(
          signIn({ discovery: { ...DISCOVERY, resourceName: null } }),
        );
        wrapAt('/app/integrations/new');
        await check();
        expect(await screen.findByLabelText('Name')).toHaveValue('kumbu.example');
      });

      it('hands the flow a draft whose url is the checked endpoint', async () => {
        checkServerMock.mockResolvedValue(signIn());
        wrapAt('/app/integrations/new');
        await check();
        fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
        await screen.findByText('sign-in flow');
        expect(flowProps.current?.discovery).toEqual(DISCOVERY);
        expect(flowProps.current?.serverId).toBeUndefined();
        expect(flowProps.current?.draft).toEqual({
          name: 'Kumbu',
          prefix: 'Kumbu',
          url: 'https://kumbu.example/mcp',
          onByDefault: true,
          autoRun: false,
          allowDirect: false,
          routing: 'proxy',
          resolvedEndpoint: 'https://kumbu.example/mcp',
        });
      });

      it('sets allowDirect after a direct connect on a device without a proxy', async () => {
        gates.proxy = false;
        checkServerMock.mockResolvedValue(signIn({ route: 'direct' }));
        wrapAt('/app/integrations/new');
        await check();
        fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
        await screen.findByText('sign-in flow');
        expect(flowProps.current?.draft).toMatchObject({ allowDirect: true, routing: 'direct' });
      });

      it('points to an existing connection with the same canonical link', async () => {
        useMcpServersMock.mockReturnValue({
          data: [
            {
              ...ROW,
              id: 'oauth-1',
              name: 'My Kumbu',
              url: 'https://KUMBU.example:443/mcp/',
              auth: { scheme: 'oauth' },
            },
          ],
        });
        checkServerMock.mockResolvedValue(signIn());
        wrapAt('/app/integrations/new');
        await check();
        expect(await screen.findByText(/already connected/i)).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Open My Kumbu' }));
        expect(await screen.findByLabelText('Name')).toHaveValue('My Kumbu');
      });

      it('offers Use a key instead, revealing the key fields', async () => {
        checkServerMock.mockResolvedValue(signIn());
        wrapAt('/app/integrations/new');
        await check();
        fireEvent.click(await screen.findByRole('button', { name: 'Use a key instead' }));
        expect(screen.getByLabelText('Authentication')).toHaveValue('bearer');
        expect(screen.getByLabelText('Key')).toBeTruthy();
        expect(screen.getByLabelText('URL')).toHaveValue('https://kumbu.example/mcp');
      });

      it('saves the connected server deferred, as OAuth, with consent on this device', async () => {
        testOAuthMock.mockResolvedValue({
          ok: true,
          routing: 'proxy',
          resolvedEndpoint: 'https://kumbu.example/mcp',
          tools: [{ name: 'search', description: '', inputSchema: {} }],
          error: null,
        });
        checkServerMock.mockResolvedValue(signIn());
        wrapAt('/app/integrations/new');
        await check();
        fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
        fireEvent.click(await screen.findByRole('button', { name: 'stub connected' }));
        await waitFor(() => expect(upsertMock).toHaveBeenCalled());
        const [row, opts] = upsertMock.mock.calls[0] as [McpServerRow, unknown];
        expect(opts).toMatchObject({ deferWhenOffline: true });
        expect(row).toMatchObject({
          id: 'new-id',
          url: 'https://kumbu.example/mcp',
          auth: { scheme: 'oauth' },
          onByDefault: true,
          firstUseConsentFor: 'https://kumbu.example/mcp',
        });
        await waitFor(() => expect(upsertMock).toHaveBeenCalledTimes(2));
        const [withTools, opts2] = upsertMock.mock.calls[1] as [McpServerRow, unknown];
        expect(opts2).toMatchObject({ deferWhenOffline: true });
        expect(withTools.tools).toHaveLength(1);
        expect(withTools.auth).toEqual({ scheme: 'oauth' });
      });
    });

    it('shows the key fields for a key result, with On by default off', async () => {
      checkServerMock.mockResolvedValue({
        kind: 'key',
        route: 'proxy',
        endpoint: 'https://key.example/mcp',
      });
      wrapAt('/app/integrations/new');
      await check('https://key.example');
      expect(await screen.findByLabelText('Key')).toBeTruthy();
      expect(screen.getByLabelText('URL')).toHaveValue('https://key.example/mcp');
      expect(screen.getByRole('checkbox', { name: 'On by default' })).not.toBeChecked();
    });

    it('goes to settings for an open server, with a visible Add a key', async () => {
      checkServerMock.mockResolvedValue({
        kind: 'open',
        route: 'proxy',
        endpoint: 'https://open.example/mcp',
        tools: [{ name: 'lookup', description: 'Look up', inputSchema: {} }],
      });
      wrapAt('/app/integrations/new');
      await check('https://open.example/mcp');
      expect(await screen.findByText('lookup')).toBeTruthy();
      expect(screen.queryByLabelText('Authentication')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Add a key' }));
      expect(screen.getByLabelText('Authentication')).toBeTruthy();
    });

    it('is honest when unreachable, with Try again and Enter details manually', async () => {
      checkServerMock.mockResolvedValue({
        kind: 'unreachable',
        directOnly: false,
        error: 'MCP initialize failed: HTTP 503',
        cause: 'probe',
      });
      wrapAt('/app/integrations/new');
      await check('https://down.example/mcp');
      expect(await screen.findByText(/Couldn't reach this server/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await waitFor(() => expect(checkServerMock).toHaveBeenCalledTimes(2));
      manual();
      expect(screen.getByLabelText('URL')).toHaveValue('https://down.example/mcp');
    });

    it('says a direct-only failure may need a linked server, and points to linking', async () => {
      gates.proxy = false;
      gates.link = 'local-only';
      checkServerMock.mockResolvedValue({
        kind: 'unreachable',
        directOnly: true,
        error: 'x',
        cause: 'probe',
      });
      wrapAt('/app/integrations/new');
      await check('https://kumbu.example/mcp/c/abc');
      expect(
        await screen.findByText(
          "Couldn't reach this server directly. It may only work through a linked Chatsundere server",
        ),
      ).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Link a server' }));
      expect(await screen.findByText('server linking')).toBeTruthy();
    });
  });

  describe('check failures: fix round 1', () => {
    async function checkWith(result: unknown) {
      checkServerMock.mockResolvedValue(result);
      wrapAt('/app/integrations/new');
      fireEvent.change(screen.getByLabelText('Server link'), {
        target: { value: 'https://x.example' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Check server' }));
    }

    it('renders a link validation message alone, without the reach sentence', async () => {
      await checkWith({
        kind: 'unreachable',
        directOnly: false,
        error: 'This link is not a valid address.',
        cause: 'link',
      });
      expect(await screen.findByText('This link is not a valid address.')).toBeTruthy();
      expect(screen.queryByText(/Couldn't reach/)).toBeNull();
    });

    it('never doubles the reach sentence', async () => {
      await checkWith({
        kind: 'unreachable',
        directOnly: false,
        error: "Couldn't reach this server.",
        cause: 'probe',
      });
      const el = await screen.findByText(/Couldn't reach this server\./);
      expect(el.textContent?.match(/Couldn't reach/g)).toHaveLength(1);
    });

    it('tells a linked device without its relay to wait, not to link', async () => {
      gates.proxy = false;
      gates.link = 'linked';
      await checkWith({ kind: 'unreachable', directOnly: true, error: '', cause: 'probe' });
      expect(
        await screen.findByText(
          "Couldn't reach your Chatsundere server right now. Try again shortly.",
        ),
      ).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Link a server' })).toBeNull();
    });

    it('treats a failing save after sign-in as connected, saved later', async () => {
      upsertMock.mockRejectedValueOnce(new Error('offline'));
      await checkWith({
        kind: 'sign-in',
        discovery: { kind: 'oauth', resource: 'https://x.example/mcp', resourceName: 'X' },
        route: 'proxy',
        endpoint: 'https://x.example/mcp',
      });
      fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
      fireEvent.click(await screen.findByRole('button', { name: 'stub connected' }));
      expect(await screen.findByText('integrations list')).toBeTruthy();
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
        'Connected. Saving will finish shortly.',
      );
    });
  });

  describe('detail page of an OAuth server', () => {
    const OAUTH_ROW: McpServerRow = {
      ...ROW,
      id: 'o1',
      name: 'Kumbu',
      url: 'https://kumbu.example/mcp',
      auth: { scheme: 'oauth' },
      onByDefault: true,
      routing: 'proxy',
      resolvedEndpoint: 'https://kumbu.example/mcp',
      firstUseConsentFor: null,
    };
    const GRANT = {
      id: 'o1',
      resource: 'https://kumbu.example/mcp',
      issuer: 'https://auth.kumbu.example',
      tokenEndpoint: 'https://auth.kumbu.example/token',
      revocationEndpoint: 'https://auth.kumbu.example/revoke',
      clientId: 'c',
      registration: 'cimd',
      scope: null,
      tokenRoute: 'proxy',
      tokens: { v: 1 } as unknown,
      claim: null,
      createdAt: 1,
      updatedAt: 1,
    } as McpOAuthGrantRow;

    beforeEach(() => {
      useMcpServersMock.mockReturnValue({ data: [OAUTH_ROW] });
      grants.rows = [GRANT];
    });

    it('shows where it is signed in instead of an auth select, with a read-only link', () => {
      wrapAt('/app/integrations/o1');
      expect(screen.getByText('Signed in at auth.kumbu.example')).toBeTruthy();
      expect(screen.queryByLabelText('Authentication')).toBeNull();
      expect(screen.getByLabelText('URL')).toHaveAttribute('readonly');
      expect(
        screen.getByText('To change the link, remove this server and connect it again'),
      ).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Sign in again' })).toBeNull();
    });

    it('leads with Sign in again when the grant has ended', async () => {
      grants.rows = [{ ...GRANT, tokens: null }];
      checkServerMock.mockResolvedValue({
        kind: 'sign-in',
        discovery: { kind: 'oauth', resource: OAUTH_ROW.url },
        route: 'proxy',
        endpoint: OAUTH_ROW.url,
      });
      wrapAt('/app/integrations/o1');
      const btn = screen.getByRole('button', { name: 'Sign in again' });
      expect(btn).toHaveAttribute('data-tone', 'primary');
      expect(btn).toBeEnabled();
      fireEvent.click(btn);
      await screen.findByText('sign-in flow');
      expect(flowProps.current?.serverId).toBe('o1');
      expect(flowProps.current?.draft).toBeNull();
    });

    it('re-checks exactly the row URL for Sign in again', async () => {
      grants.rows = [{ ...GRANT, tokens: null }];
      checkServerMock.mockResolvedValue({ kind: 'key', route: 'proxy', endpoint: 'x' });
      wrapAt('/app/integrations/o1');
      fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
      await waitFor(() => expect(checkServerMock).toHaveBeenCalled());
      expect(checkServerMock).toHaveBeenCalledWith(
        'https://kumbu.example/mcp',
        expect.objectContaining({ exact: true }),
      );
    });

    it.each([
      ['‹ Back', () => screen.getByRole('button', { name: 'Back' })],
      ['the server crumb', () => screen.getByRole('button', { name: 'Kumbu' })],
    ])('%s on Sign in again returns to the detail page', async (_label, control) => {
      grants.rows = [{ ...GRANT, tokens: null }];
      checkServerMock.mockResolvedValue({
        kind: 'sign-in',
        discovery: { kind: 'oauth', resource: OAUTH_ROW.url },
        route: 'proxy',
        endpoint: OAUTH_ROW.url,
      });
      wrapAt('/app/integrations/o1');
      fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
      await screen.findByText('sign-in flow');
      fireEvent.click(control());
      await waitFor(() => expect(screen.queryByText('sign-in flow')).toBeNull());
      expect(screen.getByText('Signed in at auth.kumbu.example')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Sign in again' })).toBeTruthy();
    });

    it('the root crumb on Sign in again still leaves for My Integrations', async () => {
      grants.rows = [{ ...GRANT, tokens: null }];
      checkServerMock.mockResolvedValue({
        kind: 'sign-in',
        discovery: { kind: 'oauth', resource: OAUTH_ROW.url },
        route: 'proxy',
        endpoint: OAUTH_ROW.url,
      });
      wrapAt('/app/integrations/o1');
      fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
      await screen.findByText('sign-in flow');
      fireEvent.click(screen.getByRole('button', { name: 'My Integrations' }));
      expect(await screen.findByText('integrations list')).toBeTruthy();
    });

    it('disables Sign in again with a reason while a sign-in is already in progress', () => {
      grants.rows = [{ ...GRANT, tokens: null }];
      pending.rows = [
        { state: 'st', serverId: 'o1', isNewServer: false, name: 'Kumbu', createdAt: 1 },
      ];
      wrapAt('/app/integrations/o1');
      expect(screen.getByRole('button', { name: 'Sign in again' })).toBeDisabled();
      expect(screen.getByText('A sign-in is already in progress')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Return to sign-in' })).toBeEnabled();
    });

    it('disables Remove server with a reason while the backend is unreachable', () => {
      gates.class2 = { disabled: true, tooltip: 'offline' };
      wrapAt('/app/integrations/o1');
      expect(screen.getByRole('button', { name: /remove server/i })).toBeDisabled();
      expect(
        screen.getByText(/Removing this server waits until your Chatsundere server is reachable/),
      ).toBeTruthy();
    });

    it('keeps Remove server of a key server enabled while the backend is unreachable', () => {
      useMcpServersMock.mockReturnValue({ data: [ROW] });
      gates.class2 = { disabled: true, tooltip: 'offline' };
      wrapAt('/app/integrations/s1');
      expect(screen.getByRole('button', { name: /remove server/i })).toBeEnabled();
    });

    it('explains a test without the proxy in OAuth terms, not key-server terms', async () => {
      gates.proxy = false;
      wrapAt('/app/integrations/o1');
      fireEvent.click(screen.getByRole('button', { name: /Test connection/ }));
      expect(
        await screen.findByText(/Your Chatsundere server can't be reached right now/),
      ).toBeTruthy();
      expect(screen.queryByText(/Turn on Local network/)).toBeNull();
      expect(testOAuthMock).not.toHaveBeenCalled();
    });

    it('asks an unlinked device to link a server for an OAuth test without the proxy', async () => {
      gates.proxy = false;
      gates.link = 'local-only';
      wrapAt('/app/integrations/o1');
      fireEvent.click(screen.getByRole('button', { name: /Test connection/ }));
      expect(
        await screen.findByText(
          /This server connects through a linked Chatsundere server\. Link one first\./,
        ),
      ).toBeTruthy();
    });

    it('disables Sign in again with a reason while the backend is unreachable', () => {
      grants.rows = [{ ...GRANT, tokens: null }];
      gates.class2 = { disabled: true, tooltip: 'offline' };
      wrapAt('/app/integrations/o1');
      expect(screen.getByRole('button', { name: 'Sign in again' })).toBeDisabled();
      expect(
        screen.getByText(/Signing in again waits until your Chatsundere server is reachable/),
      ).toBeTruthy();
    });

    it('saving a setting leaves the row’s auth and grant unchanged', async () => {
      wrapAt('/app/integrations/o1');
      fireEvent.click(screen.getByRole('checkbox', { name: /Trusted/ }));
      fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
      await screen.findByText('integrations list');
      const row = upsertMock.mock.calls.at(-1)?.[0] as McpServerRow;
      expect(row.auth).toEqual({ scheme: 'oauth' });
      expect(row.autoRun).toBe(true);
      expect(removeGrantMock).not.toHaveBeenCalled();
    });

    it('tests through the grant’s token, and a success counts as consent here', async () => {
      testOAuthMock.mockResolvedValue({
        ok: true,
        routing: 'proxy',
        resolvedEndpoint: 'https://kumbu.example/mcp',
        tools: [],
        error: null,
      });
      wrapAt('/app/integrations/o1');
      fireEvent.click(screen.getByRole('button', { name: /Test connection/ }));
      await screen.findByText(/● Connected/);
      expect(testOAuthMock).toHaveBeenCalled();
      expect(testConnMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ url: OAUTH_ROW.url }),
      );
      expect(consentMock).toHaveBeenCalledWith('o1', 'https://kumbu.example/mcp');
    });

    it('Test connection on a held grant says it is paused and keeps the last result to save', async () => {
      grants.rows = [{ ...GRANT, heldGeneration: 4, seenGeneration: 9 } as McpOAuthGrantRow];
      useMcpServersMock.mockReturnValue({
        data: [{ ...OAUTH_ROW, lastError: 'HTTP 503', lastTestedAt: 5 }],
      });
      testOAuthMock.mockResolvedValue({
        ok: false,
        held: true,
        routing: null,
        resolvedEndpoint: null,
        tools: [],
        error: 'Sign-in paused on this device. Sign in again to carry on.',
      });
      wrapAt('/app/integrations/o1');
      fireEvent.click(screen.getByRole('button', { name: /Test connection/ }));
      expect(
        await screen.findByText('Sign-in paused on this device. Sign in again to carry on.'),
      ).toBeTruthy();
      // The pause outranks the saved error in the status line, and the test block hides it too.
      expect(screen.getByText('⚠ Sign-in paused here')).toBeTruthy();
      expect(screen.queryByText(/HTTP 503/)).toBeNull();
      fireEvent.click(screen.getByRole('checkbox', { name: /Trusted/ }));
      fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
      await screen.findByText('integrations list');
      const row = upsertMock.mock.calls.at(-1)?.[0] as McpServerRow;
      expect(row).toMatchObject({
        lastError: 'HTTP 503',
        lastTestedAt: 5,
        routing: 'proxy',
        resolvedEndpoint: 'https://kumbu.example/mcp',
      });
      expect(consentMock).not.toHaveBeenCalled();
    });

    it('does not record consent after a failed test', async () => {
      testOAuthMock.mockResolvedValue({
        ok: false,
        routing: null,
        resolvedEndpoint: null,
        tools: [],
        error: 'HTTP 503',
      });
      wrapAt('/app/integrations/o1');
      fireEvent.click(screen.getByRole('button', { name: /Test connection/ }));
      await screen.findByText(/HTTP 503/);
      expect(consentMock).not.toHaveBeenCalled();
    });

    it('Remove server says all devices and signing out, and is honest when revocation fails', async () => {
      removeGrantMock.mockResolvedValue({ revoked: false });
      wrapAt('/app/integrations/o1');
      fireEvent.click(screen.getByRole('button', { name: /remove server/i }));
      expect(screen.getByText(/from all your devices/)).toBeTruthy();
      expect(screen.getByText(/signs Chatsundere out at auth\.kumbu\.example/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));
      await waitFor(() => expect(removeGrantMock).toHaveBeenCalledWith('o1', { fake: true }));
      expect(deleteMock).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(
          useToastStore
            .getState()
            .toasts.map((t) => t.message)
            .join(' '),
        ).toMatch(/couldn't sign out at auth\.kumbu\.example/),
      );
    });

    it('points back to a sign-in in progress for this server', () => {
      pending.rows = [
        { state: 'st', serverId: 'o1', isNewServer: false, name: 'Kumbu', createdAt: 1 },
      ];
      wrapAt('/app/integrations/o1');
      expect(screen.getByText('Sign-in in progress')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Return to sign-in' })).toBeTruthy();
    });
  });

  describe('waiting screen of a pending sign-in', () => {
    it('resumes the flow by its state and saves a new server deferred', async () => {
      testOAuthMock.mockResolvedValue({
        ok: false,
        routing: null,
        resolvedEndpoint: null,
        tools: [],
        error: 'x',
      });
      wrapAt('/app/integrations/sign-in/st-9');
      await screen.findByText('sign-in flow');
      expect(flowProps.current?.state).toBe('st-9');
      expect(flowProps.current?.discovery).toBeUndefined();
      fireEvent.click(screen.getByRole('button', { name: 'stub resumed connected' }));
      await waitFor(() => expect(upsertMock).toHaveBeenCalled());
      const [row, opts] = upsertMock.mock.calls[0] as [McpServerRow, unknown];
      expect(opts).toMatchObject({ deferWhenOffline: true });
      expect(row).toMatchObject({ id: 'new-9', auth: { scheme: 'oauth' } });
    });

    it('records consent for a resumed reconnect even before the list has loaded', async () => {
      useMcpServersMock.mockReturnValue({ data: [] });
      wrapAt('/app/integrations/sign-in/st-9');
      await screen.findByText('sign-in flow');
      fireEvent.click(screen.getByRole('button', { name: 'stub connected' }));
      await waitFor(() => expect(consentForMock).toHaveBeenCalledWith('new-id'));
      expect(upsertMock).not.toHaveBeenCalled();
    });

    it('Use a key instead carries the link into the manual form', async () => {
      wrapAt('/app/integrations/sign-in/st-9');
      await screen.findByText('sign-in flow');
      (flowProps.current?.onUseKey as (link: string | null) => void)('https://kumbu.example/mcp');
      expect(await screen.findByLabelText('URL')).toHaveValue('https://kumbu.example/mcp');
      expect(screen.getByLabelText('Authentication')).toHaveValue('bearer');
    });
  });
});
