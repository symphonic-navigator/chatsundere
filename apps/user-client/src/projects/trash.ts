// SPDX-License-Identifier: AGPL-3.0-only
import type { Transaction } from 'dexie';
import { uuidv7 } from 'uuidv7';
import {
  type ProjectContentRow,
  type ProjectRow,
  type TrashRow,
  getClientDataDb,
} from '../boot/client-data-db.js';
import type { TrashUndoHandle } from '../trash/delete-flow.js';
import { snapshotRowIntoTrash } from '../trash/snapshot.js';
import type { ProjectCollection } from '../trash/trash-model.js';
import { fsError, projectNotFound } from './errors.js';
import { type FileMeta, fileByPath, filesUnder, mapQuota } from './fs.js';
import { MAX_PATH_LENGTH, MAX_SEGMENT_LENGTH, basename, dirname, normalisePath } from './path.js';
import { rekeyRevisions } from './revisions.js';

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
 * `NotFound` when any of its trash rows is gone (the card was restored or purged
 * meanwhile), and with `AlreadyExists` (naming the first taken path and how many
 * others) when a live file now holds any of the paths; either way it restores
 * nothing and keeps the trash rows.
 */
function inPlaceUndo(projectId: string, snapshots: readonly Snapshot[]): TrashUndoHandle {
  const restoresProject = snapshots.some((s) => s.collection === 'projects');
  const paths = snapshots
    .filter((s) => s.collection === 'projectFiles')
    .map((s) => (s.row as FileMeta).path);
  const trashIds = snapshots.map((s) => `${s.collection}:${s.key}`);
  return {
    kind: 'in-place',
    async restore(): Promise<void> {
      const db = getClientDataDb();
      await mapQuota(
        db.transaction('rw', [...SCOPE], async () => {
          const rows = await db.trash.bulkGet(trashIds);
          const missing = trashIds.find((_, i) => rows[i] === undefined);
          if (missing !== undefined) throw fsError('NotFound', { path: `trash ${missing}` });
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
          await db.trash.bulkDelete(trashIds);
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

/** The local-calendar `YYYY-MM-DD` of `now`. */
function localDate(now: number): string {
  const d = new Date(now);
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/**
 * `/dir/stem.md` → `/dir/stem (restored YYYY-MM-DD)[ n].md` for the n-th attempt,
 * shortening the stem so the name and the path stay within the limits.
 */
function restoredPath(path: string, date: string, n: number): string {
  const dir = dirname(path);
  const prefix = dir === '/' ? '/' : `${dir}/`;
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot) : '';
  const tail = ` (restored ${date})${n === 1 ? '' : ` ${n}`}${ext}`;
  const room = Math.min(
    MAX_SEGMENT_LENGTH - tail.length,
    MAX_PATH_LENGTH - prefix.length - tail.length,
  );
  // Only a folder path within a few characters of the limit leaves no room at all.
  if (room < 1) throw fsError('InvalidPath', { path, reason: 'too-long' });
  let stem = (dot > 0 ? name.slice(0, dot) : name).slice(0, room);
  // Never leave half of a surrogate pair at the cut.
  if (/[\uD800-\uDBFF]$/.test(stem)) stem = stem.slice(0, -1);
  return `${prefix}${stem}${tail}`;
}

/** Newest delete first; equal times fall back to the newer (uuidv7) file id. */
function newestFirst(a: TrashRow, b: TrashRow): number {
  return b.deletedAt - a.deletedAt || (a.key < b.key ? 1 : a.key > b.key ? -1 : 0);
}

/**
 * Restores a card made only of project rows under fresh ids (spec §5.3), inside
 * the caller's restore transaction. A project in the card gets a new id that its
 * files follow; otherwise files go back into their live project. Within the card
 * the most recently deleted file keeps a contested path and the others become
 * `<stem> (restored YYYY-MM-DD)<ext>` (numbered when taken); a path held by a live
 * file aborts with `AlreadyExists`. Revisions follow their file, `batch` is
 * dropped, and nothing reaches the sync engine.
 */
export async function restoreProjectMembers(
  tx: Transaction,
  members: readonly TrashRow[],
  now: number,
): Promise<void> {
  const db = getClientDataDb();
  const projectMember = members.find((m) => m.collection === 'projects');
  const fileMembers = members.filter((m) => m.collection === 'projectFiles');
  const contentMembers = members.filter((m) => m.collection === 'projectContents');

  let projectId: string;
  if (projectMember) {
    projectId = uuidv7();
  } else {
    const first = fileMembers[0];
    if (!first) return; // a card always holds a project or a file
    projectId = first.parentRef?.id ?? (first.row as FileMeta).projectId;
    if (!(await db.projects.get(projectId))) throw projectNotFound(projectId);
  }

  // Within-card duplicates: the newest delete keeps the path.
  const byPath = new Map<string, TrashRow[]>();
  for (const m of fileMembers) {
    const path = (m.row as FileMeta).path;
    const group = byPath.get(path);
    if (group) group.push(m);
    else byPath.set(path, [m]);
  }
  const pathOf = new Map<string, string>();
  const displaced: TrashRow[] = [];
  for (const [path, group] of byPath) {
    group.sort(newestFirst);
    const [keeper, ...rest] = group;
    if (keeper) pathOf.set(keeper.id, path);
    displaced.push(...rest);
  }

  const kept = [...byPath.keys()];
  const live = new Set(
    (
      await db.projectFiles
        .where('[projectId+path]')
        .anyOf(kept.map((p) => [projectId, p]))
        .toArray()
    ).map((f) => f.path),
  );
  const collisions = kept.filter((p) => live.has(p));
  const [firstCollision] = collisions;
  if (firstCollision !== undefined) {
    throw fsError('AlreadyExists', { path: firstCollision, others: collisions.length - 1 });
  }

  const date = localDate(now);
  const taken = new Set(kept);
  displaced.sort((a, b) => {
    const pa = (a.row as FileMeta).path;
    const pb = (b.row as FileMeta).path;
    return pa < pb ? -1 : pa > pb ? 1 : newestFirst(a, b);
  });
  for (const m of displaced) {
    const path = (m.row as FileMeta).path;
    let candidate = restoredPath(path, date, 1);
    for (let n = 2; taken.has(candidate) || (await fileByPath(projectId, candidate)); n++) {
      candidate = restoredPath(path, date, n);
    }
    taken.add(candidate);
    pathOf.set(m.id, candidate);
  }

  if (projectMember) {
    const row = structuredClone(projectMember.row) as ProjectRow;
    await db.projects.put({ ...row, id: projectId, updatedAt: now });
  } else {
    await db.projects.update(projectId, { updatedAt: now });
  }

  const newFileIdByOld = new Map<string, string>();
  for (const m of fileMembers) {
    const fileId = uuidv7();
    newFileIdByOld.set(m.key, fileId);
    const { batch: _batch, ...row } = structuredClone(m.row) as FileMeta & { batch?: unknown };
    await db.projectFiles.put({
      ...row,
      id: fileId,
      projectId,
      path: pathOf.get(m.id) ?? row.path,
    });
    await rekeyRevisions(tx, m.key, fileId);
  }
  for (const m of contentMembers) {
    const fileId = newFileIdByOld.get(m.parentRef?.id ?? m.key);
    if (fileId === undefined) continue; // a content row always folds into its file's card
    const row = structuredClone(m.row) as ProjectContentRow;
    await db.projectContents.put({ ...row, fileId });
  }

  await db.trash.bulkDelete(members.map((m) => m.id));
}
