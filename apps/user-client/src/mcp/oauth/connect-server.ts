// SPDX-License-Identifier: AGPL-3.0-only
import {
  type McpOAuthGrantRow,
  type McpServerRow,
  getClientDataDb,
} from '../../boot/client-data-db.js';
import { type BuildMcpContextArgs, oauthTokenFor } from '../build-mcp-context.js';
import { candidatesFor, testMcpConnection } from '../mcp-connectivity.js';
import type { McpTokenResult } from '../mcp-tools.js';
import type { McpConnectionResult } from '../types.js';
import { type ServerDraft, serverRowFromDraft } from './sign-in.js';

type TokenDeps = {
  getGrant?: BuildMcpContextArgs['getGrant'];
  ensureToken?: BuildMcpContextArgs['ensureToken'];
};

const HELD_ERROR = 'Sign-in paused on this device. Sign in again to carry on.';

/** Readable copy for each way a token can be unavailable; never a raw reason code. */
function tokenError(result: Extract<McpTokenResult, { ok: false }>): string {
  switch (result.reason) {
    case 'dead':
      return 'Your sign-in at this server has ended. Sign in again to reconnect.';
    case 'held':
      return HELD_ERROR;
    case 'no-grant':
      return "This server's sign-in hasn't reached this device yet. Give it a moment.";
    case 'mismatch':
      return "This server's sign-in belongs to a different link.";
    case 'locked':
      return 'Unlock Chatsundere to test this server.';
    case 'no-proxy':
      return 'Renewing access to this server needs a linked Chatsundere server.';
    case 'not-oauth':
      return 'This server is not set up to sign in.';
    default:
      return "Access to this server can't be renewed right now. Try again shortly.";
  }
}

const failed = (error: string): McpConnectionResult => ({
  ok: false,
  routing: null,
  resolvedEndpoint: null,
  tools: [],
  error,
});

/**
 * *Test connection* for an OAuth server: the grant's token, through the same chokepoint
 * and refresh path as a tool call, sent only to the grant's `resource`. A 401 asks the
 * refresh path once more with the refused token.
 */
export async function testOAuthConnection(
  row: McpServerRow,
  hasProxy: boolean,
  deps: TokenDeps = {},
): Promise<McpConnectionResult> {
  const getGrant = deps.getGrant ?? ((id: string) => getClientDataDb().mcpOAuthGrants.get(id));
  let grant: McpOAuthGrantRow | undefined;
  try {
    grant = await getGrant(row.id);
  } catch {
    grant = undefined;
  }
  const tokenDeps = {
    getGrant: async () => grant,
    ...(deps.ensureToken ? { ensureToken: deps.ensureToken } : {}),
  };
  // A stored route of this device is not part of the test: it is what the test decides.
  const fresh: McpServerRow = { ...row, routing: null, resolvedEndpoint: null };
  let rejectedToken: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await oauthTokenFor(fresh, rejectedToken ? { rejectedToken } : {}, tokenDeps);
    if (!token.ok) {
      // A pause is no connection fault: the caller keeps the row's last result as it is.
      if (token.reason === 'held') return { ...failed(HELD_ERROR), held: true };
      return failed(tokenError(token));
    }
    const candidates = grant ? candidatesFor(row, grant, hasProxy) : [];
    if (candidates.length === 0) {
      return failed(
        hasProxy || row.allowDirect
          ? "This server's sign-in belongs to a different link."
          : 'Reaching this server needs a linked Chatsundere server, or Local network.',
      );
    }
    const result = await testMcpConnection({
      url: row.url,
      hasProxy,
      allowDirect: row.allowDirect,
      auth: { header: 'Authorization', value: `Bearer ${token.accessToken}` },
      candidates,
    });
    if (result.ok || result.auth !== 'required' || attempt > 0) return result;
    rejectedToken = token.accessToken;
  }
  return failed("Couldn't reach this server.");
}

/**
 * Saves the server a sign-in just connected, from its draft: first as it stands, so the
 * grant never orphans, then once more with the tools a test listed. `upsert` is expected
 * to defer while offline. Connecting counts as this device's first-use consent.
 */
export async function saveConnectedServer(
  serverId: string,
  draft: ServerDraft,
  deps: {
    upsert: (row: McpServerRow) => Promise<unknown>;
    test: (row: McpServerRow) => Promise<McpConnectionResult>;
    now?: () => number;
  },
): Promise<McpServerRow> {
  const now = deps.now ?? Date.now;
  const row = serverRowFromDraft(serverId, draft, now());
  await deps.upsert(row);
  let result: McpConnectionResult;
  try {
    result = await deps.test(row);
  } catch {
    return row;
  }
  if (!result.ok) return row;
  const tested: McpServerRow = {
    ...row,
    tools: result.tools,
    routing: result.routing,
    resolvedEndpoint: result.resolvedEndpoint,
    lastTestedAt: now(),
    lastError: null,
    updatedAt: now(),
  };
  await deps.upsert(tested);
  return tested;
}
