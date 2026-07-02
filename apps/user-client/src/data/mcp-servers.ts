// SPDX-License-Identifier: AGPL-3.0-only
import type { MasterKey } from '@chatsundere/crypto';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type McpServerRow, getClientDataDb } from '../boot/client-data-db.js';
import { openSecret, sealSecret } from '../lib/secrets.js';
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

/** Insert or replace an MCP server row. */
export function useUpsertMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: McpServerRow): Promise<McpServerRow> => {
      // Class-2 upsert (spec §5): device-probe fields are stripped before seal
      // (§10 deny-list). Gated write-through — the integrations affordance is
      // disabled offline.
      await mutateSynced({
        collection: 'mcpServers',
        key: row.id,
        tables: ['mcpServers'],
        write: async (tx) => {
          await tx.table('mcpServers').put(row);
        },
      });
      return row;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.mcpServers }),
  });
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

/** Open the sealed key for a server row, or null if it has no auth. */
export async function openMcpKey(row: McpServerRow, mk: MasterKey): Promise<string | null> {
  if (!row.auth) return null;
  return openSecret(row.auth.key, mk, `mcp/${row.id}/api-key`);
}
