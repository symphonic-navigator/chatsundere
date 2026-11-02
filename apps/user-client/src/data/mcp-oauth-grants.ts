// SPDX-License-Identifier: AGPL-3.0-only
import { type MasterKey, getRandomBytes, toBase64Url } from '@chatsundere/crypto';
import { useQuery } from '@tanstack/react-query';
import { type McpOAuthGrantRow, getClientDataDb } from '../boot/client-data-db.js';
import { type EncryptedBlob, openSecret, sealSecret } from '../lib/secrets.js';
import type { TokenSet } from '../mcp/oauth/token-client.js';
import { getSyncState } from '../sync/watermark.js';
import { QK } from './queryKeys.js';

const DEVICE_ID_BYTES = 16;

function tokenSlot(serverId: string): string {
  return `mcp/${serverId}/oauth-tokens`;
}

/** All stored MCP OAuth grants, one per OAuth server. */
export function useMcpOAuthGrants() {
  return useQuery({
    queryKey: QK.mcpOAuthGrants,
    queryFn: (): Promise<McpOAuthGrantRow[]> => getClientDataDb().mcpOAuthGrants.toArray(),
  });
}

/** Seal a token set under the server's stable OAuth slot. */
export function sealTokens(t: TokenSet, mk: MasterKey, serverId: string): Promise<EncryptedBlob> {
  const body: TokenSet = {
    accessToken: t.accessToken,
    refreshToken: t.refreshToken,
    accessExpiresAt: t.accessExpiresAt,
    scope: t.scope,
  };
  return sealSecret(JSON.stringify(body), mk, tokenSlot(serverId));
}

/**
 * Open a sealed token set, or null when the grant holds none. Throws when the
 * blob was sealed under another key or another server's slot.
 */
export async function openTokens(
  blob: EncryptedBlob | null,
  mk: MasterKey,
  serverId: string,
): Promise<TokenSet | null> {
  if (blob === null) return null;
  const parsed = JSON.parse(await openSecret(blob, mk, tokenSlot(serverId))) as TokenSet;
  return {
    accessToken: parsed.accessToken,
    refreshToken: parsed.refreshToken ?? null,
    accessExpiresAt: parsed.accessExpiresAt ?? null,
    scope: parsed.scope ?? null,
  };
}

/**
 * This device's id for refresh claims, created on first use. It lives in the
 * never-synced `syncState` row, so each device keeps its own.
 */
export async function getDeviceId(): Promise<string> {
  await getSyncState();
  const db = getClientDataDb();
  // Read and create in one transaction so concurrent first calls agree.
  return db.transaction('rw', db.syncState, async () => {
    const existing = (await db.syncState.get('state'))?.mcpDeviceId;
    if (existing) return existing;
    const id = toBase64Url(getRandomBytes(DEVICE_ID_BYTES));
    await db.syncState.update('state', { mcpDeviceId: id });
    return id;
  });
}
