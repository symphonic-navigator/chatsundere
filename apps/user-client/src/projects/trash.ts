// SPDX-License-Identifier: AGPL-3.0-only
import type { Transaction } from 'dexie';
import { uuidv7 } from 'uuidv7';
import { type ProjectRow, type TrashRow, getClientDataDb } from '../boot/client-data-db.js';
import type { TrashUndoHandle } from '../trash/delete-flow.js';
import { snapshotRowIntoTrash } from '../trash/snapshot.js';
import type { ProjectCollection } from '../trash/trash-model.js';
import { fsError, projectNotFound } from './errors.js';
import { type FileMeta, fileByPath, filesUnder, mapQuota } from './fs.js';
import { normalisePath } from './path.js';

/** What a project delete hands the UI: the trash card, an in-place Undo and the toast text. */
export interface ProjectDeleteResult {
  cardKey: string;
  handle: TrashUndoHandle;
  message: string;
}

const DEFAULT_MESSAGE = 'Moved to Recently deleted · recoverable for 30 days';

/** The tables every project delete and its Undo touch. */
const SCOPE = ['projects', 'projectFiles', 'projectContents', 'trash'] as const;

interface Snapshot {
  collection: ProjectCollection;
  key: string;
  row: unknown;
}

/**
 * Snapshots `files` and their content rows into the trash, then deletes them.
 * Call inside a transaction over {@link SCOPE}. Returns what was snapshotted.
 */
async function trashFiles(
  tx: Transaction,
  now: number,
  files: readonly FileMeta[],
  batch?: TrashRow['batch'],
): Promise<Snapshot[]> {
  const db = getClientDataDb();
  const contents = await db.projectContents.bulkGet(files.map((f) => f.id));
  const snapshots: Snapshot[] = [];
  for (const [i, file] of files.entries()) {
    await snapshotRowIntoTrash(tx, now, 'projectFiles', file.id, file, undefined, batch);
    snapshots.push({ collection: 'projectFiles', key: file.id, row: file });
    const content = contents[i];
    if (content) {
      await snapshotRowIntoTrash(tx, now, 'projectContents', file.id, content);
      snapshots.push({ collection: 'projectContents', key: file.id, row: content });
    }
  }
  const ids = files.map((f) => f.id);
  await db.projectFiles.bulkDelete(ids);
  await db.projectContents.bulkDelete(ids);
  return snapshots;
}

/**
 * An Undo that puts every snapshot back under its original id. It refuses with
 * `AlreadyExists` (naming the first taken path and how many others) when a live
 * file now holds any of the paths, restoring nothing and keeping the trash rows.
 */
function inPlaceUndo(projectId: string, snapshots: readonly Snapshot[]): TrashUndoHandle {
  const restoresProject = snapshots.some((s) => s.collection === 'projects');
  const paths = snapshots
    .filter((s) => s.collection === 'projectFiles')
    .map((s) => (s.row as FileMeta).path);
  return {
    kind: 'in-place',
    async restore(): Promise<void> {
      const db = getClientDataDb();
      await mapQuota(
        db.transaction('rw', [...SCOPE], async () => {
          if (!restoresProject && !(await db.projects.get(projectId))) {
            throw projectNotFound(projectId);
          }
          const live = new Set(
            (
              await db.projectFiles
                .where('[projectId+path]')
                .anyOf(paths.map((p) => [projectId, p]))
                .toArray()
            ).map((f) => f.path),
          );
          const taken = paths.filter((p) => live.has(p));
          const [first] = taken;
          if (first !== undefined) {
            throw fsError('AlreadyExists', { path: first, others: taken.length - 1 });
          }
          for (const s of snapshots) await db.table(s.collection).put(s.row);
          if (!restoresProject) await db.projects.update(projectId, { updatedAt: Date.now() });
          await db.trash.bulkDelete(snapshots.map((s) => `${s.collection}:${s.key}`));
        }),
      );
    },
  };
}

/**
 * Moves the file or folder at `path` into Recently deleted. A folder's files
 * form one card. `ifVersion` guards a file against concurrent writers and is
 * refused on a folder with `IsDirectory`; the root cannot be deleted.
 */
export async function deletePath(
  projectId: string,
  path: string,
  opts: { ifVersion?: string } = {},
): Promise<ProjectDeleteResult> {
  const p = normalisePath(path);
  if (p === '/') throw fsError('InvalidPath', { path: p, reason: 'root' });
  const now = Date.now();
  const db = getClientDataDb();

  return mapQuota(
    db.transaction('rw', [...SCOPE], async (tx) => {
      const project = await db.projects.get(projectId);
      if (!project) throw projectNotFound(projectId);

      const file = await fileByPath(projectId, p);
      let result: Omit<ProjectDeleteResult, 'handle'>;
      let snapshots: Snapshot[];
      if (file) {
        if (opts.ifVersion !== undefined && opts.ifVersion !== file.version) {
          throw fsError('VersionConflict', {
            path: p,
            current: file.version,
            passed: opts.ifVersion,
          });
        }
        snapshots = await trashFiles(tx, now, [file]);
        result = { cardKey: `projectFiles:${file.id}`, message: DEFAULT_MESSAGE };
      } else {
        const files = await filesUnder(projectId, p).toArray();
        if (files.length === 0) throw fsError('NotFound', { path: p });
        if (opts.ifVersion !== undefined) throw fsError('IsDirectory', { path: p });
        const dir = p.slice(1);
        const key = uuidv7();
        const title = `${dir}/ — ${project.name}`;
        snapshots = await trashFiles(tx, now, files, { key, title, kind: 'projectFolder' });
        const n = files.length;
        result = {
          cardKey: `batch:${key}`,
          message: `Moved ${dir}/ (${n} ${n === 1 ? 'file' : 'files'}) to Recently deleted`,
        };
      }
      await db.projects.update(projectId, { updatedAt: now });
      return { ...result, handle: inPlaceUndo(projectId, snapshots) };
    }),
  );
}

/** Moves a project with all its files into Recently deleted as one card. */
export async function deleteProject(projectId: string): Promise<ProjectDeleteResult> {
  const now = Date.now();
  const db = getClientDataDb();

  return mapQuota(
    db.transaction('rw', [...SCOPE], async (tx) => {
      const project: ProjectRow | undefined = await db.projects.get(projectId);
      if (!project) throw projectNotFound(projectId);
      await snapshotRowIntoTrash(tx, now, 'projects', projectId, project);
      const files = await db.projectFiles.where('projectId').equals(projectId).toArray();
      const snapshots: Snapshot[] = [
        { collection: 'projects', key: projectId, row: project },
        ...(await trashFiles(tx, now, files)),
      ];
      await db.projects.delete(projectId);
      return {
        cardKey: `projects:${projectId}`,
        handle: inPlaceUndo(projectId, snapshots),
        message: DEFAULT_MESSAGE,
      };
    }),
  );
}
