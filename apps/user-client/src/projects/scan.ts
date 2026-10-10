// SPDX-License-Identifier: AGPL-3.0-only
import { getClientDataDb } from '../boot/client-data-db.js';
import { projectNotFound } from './errors.js';
import type { FileMeta } from './fs.js';
import { isHiddenPath, normalisePath, prefixRange } from './path.js';

const BATCH_SIZE = 100;

export interface ScanOptions {
  prefix?: string;
  kind?: 'markdown';
  /** Include dot-named files even when `prefix` is not hidden (used by backups). */
  includeHidden?: boolean;
}

/**
 * Iterates the text of every file under `prefix` (default the whole project) in
 * path order. Metadata comes from the index; content is read in batches of 100,
 * one read transaction per batch. Hidden files are skipped unless `prefix` is
 * itself hidden or `includeHidden` is set.
 */
export async function* scan(
  projectId: string,
  opts: ScanOptions = {},
): AsyncIterable<{ meta: FileMeta; text: string }> {
  const prefix = normalisePath(opts.prefix ?? '/');
  const db = getClientDataDb();
  const [lo, hi] = prefixRange(prefix);
  const includeHidden = opts.includeHidden === true || isHiddenPath(prefix);

  const metas = await db.transaction('r', db.projects, db.projectFiles, async () => {
    if (!(await db.projects.get(projectId))) throw projectNotFound(projectId);
    const rows = await db.projectFiles
      .where('[projectId+path]')
      .between([projectId, lo], [projectId, hi], true, true)
      .toArray();
    return rows.filter(
      (m) =>
        (includeHidden || !isHiddenPath(m.path)) &&
        (opts.kind === undefined || m.kind === opts.kind),
    );
  });

  for (let i = 0; i < metas.length; i += BATCH_SIZE) {
    const batch = metas.slice(i, i + BATCH_SIZE);
    const contents = await db.transaction('r', db.projectContents, () =>
      db.projectContents.bulkGet(batch.map((m) => m.id)),
    );
    for (const [n, meta] of batch.entries()) {
      yield { meta, text: contents[n]?.text ?? '' };
    }
  }
}
