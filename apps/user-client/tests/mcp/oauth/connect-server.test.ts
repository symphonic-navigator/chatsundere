// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testConnMock } = vi.hoisted(() => ({ testConnMock: vi.fn() }));

vi.mock('../../../src/mcp/mcp-connectivity.js', async (orig) => ({
  ...(await orig<typeof import('../../../src/mcp/mcp-connectivity.js')>()),
  testMcpConnection: (...a: unknown[]) => testConnMock(...a),
}));

import type { McpOAuthGrantRow, McpServerRow } from '../../../src/boot/client-data-db.js';
import { saveConnectedServer, testOAuthConnection } from '../../../src/mcp/oauth/connect-server.js';
import type { ServerDraft } from '../../../src/mcp/oauth/sign-in.js';

const URL_ = 'https://kumbu.example/mcp';
const ROW: McpServerRow = {
  id: 'o1',
  name: 'Kumbu',
  url: URL_,
  prefix: 'kumbu',
  auth: { scheme: 'oauth' },
  onByDefault: true,
  autoRun: false,
  allowDirect: false,
  enabled: true,
  routing: null,
  resolvedEndpoint: null,
  tools: [],
  hiddenTools: [],
  lastTestedAt: null,
  lastError: null,
  firstUseConsentFor: URL_,
  createdAt: 1,
  updatedAt: 1,
};
const GRANT = {
  id: 'o1',
  resource: URL_,
  tokens: null,
  claim: null,
} as unknown as McpOAuthGrantRow;
const OK = { ok: true, routing: 'proxy', resolvedEndpoint: URL_, tools: [], error: null };

describe('testOAuthConnection', () => {
  beforeEach(() => {
    testConnMock.mockReset();
  });

  it('sends the grant’s token to exactly its resource', async () => {
    testConnMock.mockResolvedValue(OK);
    const ensureToken = vi.fn(async () => ({ ok: true as const, accessToken: 'fake-access' }));
    const r = await testOAuthConnection(ROW, true, { getGrant: async () => GRANT, ensureToken });
    expect(r.ok).toBe(true);
    const arg = testConnMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg.candidates).toEqual([{ routing: 'proxy', url: URL_ }]);
    expect((arg.auth as { header: string }).header).toBe('Authorization');
  });

  it('asks once more with the refused token after a 401', async () => {
    testConnMock
      .mockResolvedValueOnce({ ...OK, ok: false, routing: null, auth: 'required', error: 'x' })
      .mockResolvedValueOnce(OK);
    const ensureToken = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, accessToken: 'old' })
      .mockResolvedValueOnce({ ok: true, accessToken: 'new' });
    const r = await testOAuthConnection(ROW, true, { getGrant: async () => GRANT, ensureToken });
    expect(r.ok).toBe(true);
    expect(ensureToken.mock.calls[1]?.[1]).toMatchObject({ rejectedToken: 'old' });
  });

  it('reads an ended sign-in as such, without contacting the server', async () => {
    const r = await testOAuthConnection(ROW, true, {
      getGrant: async () => GRANT,
      ensureToken: async () => ({ ok: false, reason: 'dead' }),
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Sign in again/);
    expect(testConnMock).not.toHaveBeenCalled();
  });

  it('reads a missing grant as one that has not arrived yet', async () => {
    const r = await testOAuthConnection(ROW, true, {
      getGrant: async () => undefined,
      ensureToken: vi.fn(),
    });
    expect(r.error).toMatch(/hasn't reached this device yet/);
  });
});

describe('saveConnectedServer', () => {
  const DRAFT: ServerDraft = {
    name: 'Kumbu',
    prefix: 'kumbu',
    url: URL_,
    onByDefault: true,
    autoRun: false,
    allowDirect: false,
    routing: 'proxy',
    resolvedEndpoint: URL_,
  };

  it('saves the row first, then once more with the tools a test listed', async () => {
    const upsert = vi.fn(async (r: McpServerRow) => r);
    const tools = [{ name: 'go', description: '', inputSchema: {} }];
    const test = vi.fn(async () => ({ ...OK, tools }) as never);
    const row = await saveConnectedServer('o1', DRAFT, { upsert, test, now: () => 5 });
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls[0]?.[0]).toMatchObject({ auth: { scheme: 'oauth' }, tools: [] });
    expect(row.tools).toEqual(tools);
    expect(row.lastTestedAt).toBe(5);
  });

  it('keeps the saved row when the test fails', async () => {
    const upsert = vi.fn(async (r: McpServerRow) => r);
    const test = vi.fn(async () => ({ ...OK, ok: false, error: 'HTTP 503' }) as never);
    const row = await saveConnectedServer('o1', DRAFT, { upsert, test, now: () => 5 });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(row.id).toBe('o1');
  });
});
