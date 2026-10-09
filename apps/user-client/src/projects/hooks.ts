// SPDX-License-Identifier: AGPL-3.0-only
import Dexie, { liveQuery } from 'dexie';
import { type DependencyList, useEffect, useState } from 'react';
import { type ProjectRow, getClientDataDb } from '../boot/client-data-db.js';
import type { FileMeta } from './fs.js';
import type { RevisionMeta } from './revisions.js';

/**
 * Subscribes to a Dexie `liveQuery`: re-runs whenever a committed write (in
 * this tab or another) touches what the query read. `undefined` while the
 * first result is pending or after the query failed.
 */
function useLive<T>(query: () => Promise<T>, deps: DependencyList): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `query` is rebuilt every render; `deps` are its inputs
  useEffect(() => {
    setValue(undefined);
    const sub = liveQuery(query).subscribe({
      next: (v) => setValue(() => v),
      error: (e) => {
        console.warn('Project live query failed', e);
        setValue(undefined);
      },
    });
    return () => sub.unsubscribe();
  }, deps);
  return value;
}

/** All projects, most recently changed first. */
export function useProjects(): ProjectRow[] | undefined {
  return useLive(() => getClientDataDb().projects.orderBy('updatedAt').reverse().toArray(), []);
}

/** Shared empty result while counts load, so consumers see a stable reference. */
const NO_COUNTS: ReadonlyMap<string, number> = Object.freeze(new Map<string, number>());

/** File count per project id (projects without files are absent; read as 0). */
export function useProjectFileCounts(): ReadonlyMap<string, number> {
  const counts = useLive(async () => {
    const ids = (await getClientDataDb().projectFiles.orderBy('projectId').keys()) as string[];
    const map = new Map<string, number>();
    for (const id of ids) map.set(id, (map.get(id) ?? 0) + 1);
    return map;
  }, []);
  return counts ?? NO_COUNTS;
}

/** One project; `null` when it does not exist, `undefined` while loading. */
export function useProject(projectId: string): ProjectRow | null | undefined {
  return useLive(
    async () => (await getClientDataDb().projects.get(projectId)) ?? null,
    [projectId],
  );
}

/** Metadata of every file in the project (dotfiles included), sorted by path. */
export function useProjectTree(projectId: string): FileMeta[] | undefined {
  return useLive(
    () =>
      getClientDataDb()
        .projectFiles.where('[projectId+path]')
        .between([projectId, Dexie.minKey], [projectId, Dexie.maxKey])
        .toArray(),
    [projectId],
  );
}

/** Metadata of one file by id; `null` when it does not exist, `undefined` while loading. */
export function useProjectFile(fileId: string): FileMeta | null | undefined {
  return useLive(async () => (await getClientDataDb().projectFiles.get(fileId)) ?? null, [fileId]);
}

/** Superseded versions of a file, newest first (metadata only). */
export function useRevisions(fileId: string): RevisionMeta[] | undefined {
  return useLive(async () => {
    const rows = await getClientDataDb()
      .projectRevisions.where('[fileId+createdAt]')
      .between([fileId, Dexie.minKey], [fileId, Dexie.maxKey])
      .reverse()
      .toArray();
    return rows.map(({ version, size, createdAt }) => ({ version, size, createdAt }));
  }, [fileId]);
}
