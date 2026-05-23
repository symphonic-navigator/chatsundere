// SPDX-License-Identifier: AGPL-3.0-only

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { uuidv7 } from 'uuidv7';
import { type ProviderRow, getClientDataDb } from '../boot/client-data-db.js';
import { QK } from './queryKeys.js';

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

interface UpsertArgs {
  /** When present, update the existing row; when absent, insert a new one. */
  id?: string;
  templateId: string;
  apiKey: ProviderRow['apiKey'];
  enabled: boolean;
}

/**
 * Create or update a provider row.
 *
 * On create: `displayName`, `baseUrl`, and `routing` are written with
 * provisional defaults per Decision 22 (the ProviderSheet resolves the
 * real values from the template definition at display-time).
 */
export function useUpsertProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: UpsertArgs): Promise<ProviderRow> => {
      const db = getClientDataDb();
      const now = Date.now();
      if (args.id) {
        await db.providers.update(args.id, {
          templateId: args.templateId,
          apiKey: args.apiKey,
          enabled: args.enabled,
          updatedAt: now,
        });
        const row = await db.providers.get(args.id);
        if (!row) throw new Error('upsert failed: provider missing post-update');
        return row;
      }
      const row: ProviderRow = {
        id: uuidv7(),
        templateId: args.templateId,
        displayName: args.templateId,
        baseUrl: '',
        apiKey: args.apiKey,
        routing: { kind: 'direct' },
        enabled: args.enabled,
        createdAt: now,
        updatedAt: now,
      };
      await db.providers.add(row);
      return row;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.providers }),
  });
}

/** Delete a provider row by id. */
export function useDeleteProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const db = getClientDataDb();
      await db.providers.delete(id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.providers }),
  });
}
