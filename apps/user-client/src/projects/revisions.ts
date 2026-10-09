// SPDX-License-Identifier: AGPL-3.0-only
import Dexie, { type Transaction } from 'dexie';
import { type ProjectRevisionRow, getClientDataDb } from '../boot/client-data-db.js';
import { fsError, projectNotFound } from './errors.js';
import { type FileMeta, writeText } from './fs.js';
import { normalisePath } from './path.js';

/** Superseded versions kept per file; older ones are dropped on capture. */
export const REVISION_CAP = 20;

/** A superseded version of a file; `createdAt` is when it was superseded. */
export interface RevisionMeta {
  version: string;
  size: number;
  createdAt: number;
}

/**
 * Stores the content a file had at `version` and trims the file's revisions to
 * the newest {@link REVISION_CAP}. Must run inside the caller's `rw` transaction
 * that includes `projectRevisions`.
 */
export async function recordRevision(
  tx: Transaction,
  fileId: string,
  version: string,
  text: string,
  size: number,
  now: number,
): Promise<void> {
  const table = tx.table<ProjectRevisionRow, [string, string]>('projectRevisions');
  await table.put({ fileId, version, text, size, createdAt: now });
  const count = await table.where('fileId').equals(fileId).count();
  if (count <= REVISION_CAP) return;
  // Equal createdAt values fall back to primary-key order; uuidv7 versions are
  // time-ordered, so ties still drop the oldest first.
  const oldest = await table
    .where('[fileId+createdAt]')
    .between([fileId, Dexie.minKey], [fileId, Dexie.maxKey])
    .limit(count - REVISION_CAP)
    .primaryKeys();
  await table.bulkDelete(oldest);
}

/** The file at `p`; `NotFound` naming the project or the path. Call inside a transaction. */
async function fileAt(projectId: string, p: string): Promise<FileMeta> {
  const db = getClientDataDb();
  if (!(await db.projects.get(projectId))) throw projectNotFound(projectId);
  const meta = await db.projectFiles.where('[projectId+path]').equals([projectId, p]).first();
  if (!meta) throw fsError('NotFound', { path: p });
  return meta;
}

/** Superseded versions of the file at `path`, newest first (metadata only). */
export async function listRevisions(projectId: string, path: string): Promise<RevisionMeta[]> {
  const p = normalisePath(path);
  const db = getClientDataDb();
  const rows = await db.transaction(
    'r',
    db.projects,
    db.projectFiles,
    db.projectRevisions,
    async () => {
      const meta = await fileAt(projectId, p);
      // Equal createdAt values fall back to primary-key order, and uuidv7
      // versions are time-ordered, so reversing keeps ties newest first.
      return db.projectRevisions
        .where('[fileId+createdAt]')
        .between([meta.id, Dexie.minKey], [meta.id, Dexie.maxKey])
        .reverse()
        .toArray();
    },
  );
  return rows.map(({ version, size, createdAt }) => ({ version, size, createdAt }));
}

async function revisionOf(
  projectId: string,
  p: string,
  version: string,
): Promise<{ meta: FileMeta; text: string }> {
  const db = getClientDataDb();
  return db.transaction('r', db.projects, db.projectFiles, db.projectRevisions, async () => {
    const meta = await fileAt(projectId, p);
    const rev = await db.projectRevisions.get([meta.id, version]);
    if (!rev) throw fsError('NotFound', { path: `${p} (revision ${version})` });
    return { meta, text: rev.text };
  });
}

/** The text the file at `path` had at `version`; `NotFound` when no such revision is kept. */
export async function readRevision(
  projectId: string,
  path: string,
  version: string,
): Promise<string> {
  return (await revisionOf(projectId, normalisePath(path), version)).text;
}

/**
 * Writes the text of revision `version` back as a new version of the file;
 * the content it replaces becomes a revision. Without `ifVersion` the restore
 * is still pinned to the version read alongside the revision, so a change or
 * move in between fails with `VersionConflict` or `NotFound` rather than
 * writing over it.
 */
export async function restoreRevision(
  projectId: string,
  path: string,
  version: string,
  opts: { ifVersion?: string } = {},
): Promise<FileMeta> {
  const p = normalisePath(path);
  const { meta, text } = await revisionOf(projectId, p, version);
  return writeText(projectId, p, text, { ifVersion: opts.ifVersion ?? meta.version });
}
