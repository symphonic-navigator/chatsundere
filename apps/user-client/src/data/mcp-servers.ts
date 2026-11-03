// SPDX-License-Identifier: AGPL-3.0-only
import type { MasterKey } from '@chatsundere/crypto';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type McpServerRow, getClientDataDb } from '../boot/client-data-db.js';
import { queryClient } from '../lib/queryClient.js';
import { openSecret, sealSecret } from '../lib/secrets.js';
import type { McpRouting } from '../mcp/types.js';
import { mutateSynced } from '../sync/enqueue.js';
import { QK } from './queryKeys.js';

/** All configured MCP servers, ordered by creation. */
export function useMcpServers() {
  return useQuery({
    queryKey: QK.mcpServers,
    queryFn: (): Promise<McpServerRow[]> =>
      getClientDataDb().mcpServers.orderBy('createdAt').toArray(),
  });
}

/**
 * Insert or replace an MCP server row through the synced write-through. With
 * `deferWhenOffline` the local write still lands while sync is unreachable, which
 * the save after an OAuth sign-in needs: its grant already exists and must not orphan.
 * With `ifAbsent` an existing row makes it throw instead of being replaced.
 */
export async function upsertMcpServer(
  row: McpServerRow,
  opts: { deferWhenOffline?: boolean; ifAbsent?: boolean } = {},
): Promise<McpServerRow> {
  // Class-2 upsert (spec §5): device-probe fields are stripped before seal
  // (§10 deny-list). Gated write-through — the integrations affordance is
  // disabled offline.
  await mutateSynced({
    collection: 'mcpServers',
    key: row.id,
    tables: ['mcpServers'],
    write: async (tx) => {
      // `add` aborts the whole transaction on an existing key, so nothing is enqueued.
      if (opts.ifAbsent) await tx.table('mcpServers').add(row);
      else await tx.table('mcpServers').put(row);
    },
    ...(opts.deferWhenOffline ? { deferWhenOffline: true } : {}),
  });
  return row;
}

/** Insert or replace an MCP server row. */
export function useUpsertMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (row: McpServerRow): Promise<McpServerRow> => upsertMcpServer(row),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.mcpServers }),
  });
}

/**
 * Remember the route this device resolved. `routing` and `resolvedEndpoint` are
 * device-local (never sealed), so this is a plain local write with no outbox entry.
 * A probe takes seconds and the row may be edited or pulled meanwhile, so the write
 * only lands if the row still has the URL and intent the probe was made for.
 */
export async function persistMcpRoute(
  id: string,
  route: { routing: McpRouting; resolvedEndpoint: string },
  probedFor: { url: string; allowDirect: boolean },
): Promise<void> {
  const db = getClientDataDb();
  await db.transaction('rw', db.mcpServers, async () => {
    const row = await db.mcpServers.get(id);
    if (row?.url !== probedFor.url || row.allowDirect !== probedFor.allowDirect) return;
    await db.mcpServers.update(id, { ...route, lastTestedAt: Date.now(), lastError: null });
  });
  void queryClient.invalidateQueries({ queryKey: QK.mcpServers });
}

/** Delete an MCP server by id. */
export function useDeleteMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string): Promise<void> =>
      mutateSynced({
        collection: 'mcpServers',
        key: id,
        op: 'delete',
        tables: ['mcpServers'],
        write: async (tx) => {
          await tx.table('mcpServers').delete(id);
        },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.mcpServers }),
  });
}

/** Seal an MCP server key under the server's stable slot. */
export function sealMcpKey(plaintext: string, mk: MasterKey, serverId: string) {
  return sealSecret(plaintext, mk, `mcp/${serverId}/api-key`);
}

/** Open the sealed key for a server row, or null if it has no key (no auth, or OAuth). */
export async function openMcpKey(row: McpServerRow, mk: MasterKey): Promise<string | null> {
  if (!row.auth || row.auth.scheme === 'oauth') return null;
  return openSecret(row.auth.key, mk, `mcp/${row.id}/api-key`);
}
