// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type McpServerRow,
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { persistMcpRoute } from '../../src/data/mcp-servers.js';

const ROW: McpServerRow = {
  id: 's',
  name: 'S',
  url: 'https://s/mcp',
  prefix: 's',
  auth: null,
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
  createdAt: 1,
  updatedAt: 1,
};
const ROUTE = { routing: 'proxy' as const, resolvedEndpoint: 'https://s/mcp' };

describe('persistMcpRoute', () => {
  beforeEach(async () => {
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('remembers the route locally, without queueing anything for sync', async () => {
    const db = getClientDataDb();
    await db.mcpServers.put(ROW);
    await persistMcpRoute('s', ROUTE, { url: ROW.url, allowDirect: false });
    expect(await db.mcpServers.get('s')).toMatchObject({ ...ROUTE, updatedAt: 1 });
    expect(await db.syncOutbox.count()).toBe(0);
  });

  it.each([
    ['url', { url: 'https://new/mcp' }],
    ['allowDirect', { allowDirect: true }],
  ])('drops the route if the %s changed during the probe', async (_field, changed) => {
    const db = getClientDataDb();
    await db.mcpServers.put({ ...ROW, ...changed });
    await persistMcpRoute('s', ROUTE, { url: ROW.url, allowDirect: false });
    expect((await db.mcpServers.get('s'))?.routing).toBeNull();
  });
});
