// SPDX-License-Identifier: AGPL-3.0-only
import { type UseQueryResult, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { uuidv7 } from 'uuidv7';
import { type SeedTemplateRow, getClientDataDb } from '../boot/client-data-db.js';
import { enqueueSync, isLinkedForSync, mutateSynced } from '../sync/enqueue.js';
import { scheduleClass1Sync } from '../sync/triggers.js';
import { QK } from './queryKeys.js';
import { useAdultMode } from './settings.js';

// ---- Plain async helpers (used by hooks + tests) ----

/** All seed templates, newest first. */
export async function listSeedTemplates(): Promise<SeedTemplateRow[]> {
  return getClientDataDb().seedTemplates.orderBy('createdAt').reverse().toArray();
}

/** One seed template by id, or undefined. */
export async function getSeedTemplate(id: string): Promise<SeedTemplateRow | undefined> {
  return getClientDataDb().seedTemplates.get(id);
}

/** Create a seed template, returning its fresh id. */
export async function createSeedTemplate(
  input: Omit<SeedTemplateRow, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<string> {
  const now = Date.now();
  const row: SeedTemplateRow = { id: uuidv7(), createdAt: now, updatedAt: now, ...input };
  const db = getClientDataDb();
  const linked = isLinkedForSync();
  // Class-1 creation-insert (spec §5): the row and its outbox row are atomic.
  await db.transaction('rw', [db.seedTemplates, db.syncOutbox], async (tx) => {
    await db.seedTemplates.add(row);
    if (linked) enqueueSync(tx, 'seedTemplates', row.id, 'upsert');
  });
  if (linked) scheduleClass1Sync();
  return row.id;
}

/** Patch a seed template by id, bumping `updatedAt`. Class-2 edit (spec §5). */
export async function updateSeedTemplate(
  id: string,
  patch: Partial<Omit<SeedTemplateRow, 'id' | 'createdAt'>>,
): Promise<void> {
  await mutateSynced({
    collection: 'seedTemplates',
    key: id,
    tables: ['seedTemplates'],
    write: async (tx) => {
      await tx.table('seedTemplates').update(id, { ...patch, updatedAt: Date.now() });
    },
  });
}

/** Delete a seed template by id. Class-2 delete (spec §5). */
export async function deleteSeedTemplate(id: string): Promise<void> {
  await mutateSynced({
    collection: 'seedTemplates',
    key: id,
    op: 'delete',
    tables: ['seedTemplates'],
    write: async (tx) => {
      await tx.table('seedTemplates').delete(id);
    },
  });
}

// ---- React-Query hooks ----

/** All seed templates, newest first. */
export function useSeedTemplates(): UseQueryResult<SeedTemplateRow[]> {
  return useQuery({ queryKey: QK.seedTemplates, queryFn: listSeedTemplates });
}

/**
 * Seed templates filtered by the current adult-mode setting — the hook every
 * list/picker/count surface must use (mirrors `useFilteredLibraries`). An
 * all-NSFW set in SFW mode must read identically to "no templates exist".
 */
export function useFilteredSeedTemplates(): UseQueryResult<SeedTemplateRow[]> {
  const templates = useSeedTemplates();
  const { mode } = useAdultMode();
  const data = templates.data?.filter((t) => mode === 'nsfw' || !t.nsfw);
  return { ...templates, data } as UseQueryResult<SeedTemplateRow[]>;
}

/** One seed template by id (disabled until an id is supplied). */
export function useSeedTemplate(
  id: string | undefined,
): UseQueryResult<SeedTemplateRow | undefined> {
  return useQuery({
    queryKey: QK.seedTemplate(id ?? ''),
    queryFn: () => (id ? getSeedTemplate(id) : Promise.resolve(undefined)),
    enabled: id !== undefined,
  });
}

/** Create a seed template; resolves to the new id. */
export function useCreateSeedTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SeedTemplateRow, 'id' | 'createdAt' | 'updatedAt'>) =>
      createSeedTemplate(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.seedTemplates }),
  });
}

/** Patch a seed template by id. */
export function useUpdateSeedTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      id: string;
      patch: Partial<Omit<SeedTemplateRow, 'id' | 'createdAt'>>;
    }) => updateSeedTemplate(args.id, args.patch),
    onSuccess: (_v, args) => {
      qc.invalidateQueries({ queryKey: QK.seedTemplates });
      qc.invalidateQueries({ queryKey: QK.seedTemplate(args.id) });
    },
  });
}

/** Delete a seed template by id. */
export function useDeleteSeedTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteSeedTemplate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.seedTemplates }),
  });
}
