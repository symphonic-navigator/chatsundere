// SPDX-License-Identifier: AGPL-3.0-only

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ProviderRow, getClientDataDb } from '../boot/client-data-db.js';
import { enqueueSync, isLinkedForSync, mutateSynced } from '../sync/enqueue.js';
import { scheduleClass1Sync } from '../sync/triggers.js';
import { QK } from './queryKeys.js';

/**
 * The AAD slot id a provider's `apiKey` is sealed under. Reads `keySlot`, falling
 * back to `id` for pre-v35 rows sealed before the field existed (spec §4).
 */
export function providerApiKeySlot(row: Pick<ProviderRow, 'id' | 'keySlot'>): string {
  return `provider/${row.keySlot ?? row.id}/api-key`;
}

/** List all configured provider rows. */
export function useProviders() {
  return useQuery({
    queryKey: QK.providers,
    queryFn: async () => {
      const db = getClientDataDb();
      return await db.providers.toArray();
    },
  });
}

export interface UpsertArgs {
  templateId: string;
  apiKey: ProviderRow['apiKey'];
  enabled: boolean;
  /**
   * The AAD slot the caller sealed `apiKey` under. Callers must derive this from
   * a fresh read of the stored row (not a stale cache) so the seal slot and the
   * persisted `keySlot` can never diverge — a mismatch fails every future
   * `openSecret` on this key (Larissa M-1).
   */
  keySlot: string;
}

/**
 * Create or update the single provider row for a template (React-free core). The
 * row's `id` IS its `templateId` (spec §5), so the sync key is deterministic
 * across devices and a second row cannot exist. `keySlot` is caller-supplied and
 * written verbatim on both branches — it must match the slot the api key was
 * actually sealed under.
 */
export async function upsertProviderRow(args: UpsertArgs): Promise<ProviderRow> {
  const db = getClientDataDb();
  const now = Date.now();
  const existing = await db.providers.get(args.templateId);
  const row: ProviderRow = existing
    ? {
        ...existing,
        apiKey: args.apiKey,
        enabled: args.enabled,
        keySlot: args.keySlot,
        updatedAt: now,
      }
    : {
        id: args.templateId,
        templateId: args.templateId,
        displayName: args.templateId,
        baseUrl: '',
        apiKey: args.apiKey,
        routing: { kind: 'direct' },
        enabled: args.enabled,
        keySlot: args.keySlot,
        createdAt: now,
        updatedAt: now,
      };

  if (existing) {
    // Class-2 edit (spec §5): gated synced write-through.
    await mutateSynced({
      collection: 'providers',
      key: row.id,
      tables: ['providers'],
      write: async (tx) => {
        await tx.table('providers').put(row);
      },
    });
  } else {
    const linked = isLinkedForSync();
    // Class-1 creation-insert: row + outbox row are atomic.
    await db.transaction('rw', [db.providers, db.syncOutbox], async (tx) => {
      await db.providers.add(row);
      if (linked) enqueueSync(tx, 'providers', row.id, 'upsert');
    });
    if (linked) scheduleClass1Sync();
  }
  return row;
}

/** Mutation wrapper over {@link upsertProviderRow} that invalidates the list. */
export function useUpsertProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: upsertProviderRow,
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.providers }),
  });
}

/** Delete a provider row by id. */
export function useDeleteProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Class-2 delete (spec §5): enqueue a `delete` tombstone.
      await mutateSynced({
        collection: 'providers',
        key: id,
        op: 'delete',
        tables: ['providers'],
        write: async (tx) => {
          await tx.table('providers').delete(id);
        },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.providers }),
  });
}
