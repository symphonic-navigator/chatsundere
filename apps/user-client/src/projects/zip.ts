// SPDX-License-Identifier: AGPL-3.0-only
import { strToU8, unzipSync, zipSync } from 'fflate';
import { uuidv7 } from 'uuidv7';
import {
  type ProjectContentRow,
  type ProjectFileRow,
  type ProjectRow,
  getClientDataDb,
} from '../boot/client-data-db.js';
import { fsError, projectNotFound } from './errors.js';
import { mapQuota, sha256B64Url } from './fs.js';
import { normalisePath } from './path.js';
import { scan } from './scan.js';

export const MANIFEST_NAME = 'chatsundere-project.json';

const DEFAULT_NAME = 'Imported project';
const MARKDOWN_ENTRY = /\.(md|markdown)$/i;

export interface ImportResult {
  project: ProjectRow;
  imported: number;
  skipped: string[];
}

/** Exports every live file of a project (hidden ones included; no revisions or trash) as a zip. */
export async function exportZip(projectId: string): Promise<Blob> {
  const project = await getClientDataDb().projects.get(projectId);
  if (!project) throw projectNotFound(projectId);

  const entries: Record<string, Uint8Array> = {};
  for await (const { meta, text } of scan(projectId, { includeHidden: true })) {
    entries[meta.path.slice(1)] = strToU8(text);
  }
  entries[MANIFEST_NAME] = strToU8(
    JSON.stringify({ format: 'chatsundere-project', version: 1, name: project.name }),
  );
  return new Blob([zipSync(entries) as BlobPart], { type: 'application/zip' });
}

function manifestName(bytes: Uint8Array | undefined): string | undefined {
  if (!bytes) return undefined;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const name = (parsed as { name?: unknown } | null)?.name;
    return typeof name === 'string' && name.trim() ? name : undefined;
  } catch {
    return undefined;
  }
}

function rejectEntry(name: string): never {
  throw fsError('InvalidPath', { path: name });
}

/**
 * Creates a new project from a zip. Every entry is validated before anything
 * is written, so a hostile or malformed archive creates nothing. Non-Markdown
 * and non-UTF-8 entries are reported in `skipped`.
 */
export async function importZip(blob: Blob, opts: { name?: string } = {}): Promise<ImportResult> {
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const decoder = new TextDecoder('utf-8', { fatal: true });

  const accepted = new Map<string, string>();
  const skipped: string[] = [];
  let manifest: Uint8Array | undefined;
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('/')) continue;
    if (name.includes('\\') || /^[A-Za-z]:/.test(name)) rejectEntry(name);
    let path: string;
    try {
      path = normalisePath(`/${name}`);
    } catch {
      rejectEntry(name);
    }
    if (path === `/${MANIFEST_NAME}`) {
      manifest = data;
      continue;
    }
    if (!MARKDOWN_ENTRY.test(path)) {
      skipped.push(name);
      continue;
    }
    let text: string;
    try {
      text = decoder.decode(data);
    } catch {
      skipped.push(name);
      continue;
    }
    if (accepted.has(path)) rejectEntry(name);
    accepted.set(path, text);
  }

  const fileName = (blob as { name?: unknown }).name;
  const fromFile = typeof fileName === 'string' ? fileName.replace(/\.zip$/i, '').trim() : '';
  const name = opts.name?.trim() || manifestName(manifest) || fromFile || DEFAULT_NAME;

  const now = Date.now();
  const project: ProjectRow = { id: uuidv7(), name, createdAt: now, updatedAt: now };
  const encoder = new TextEncoder();
  const rows: ProjectFileRow[] = [];
  const contents: ProjectContentRow[] = [];
  for (const [path, text] of accepted) {
    const bytes = encoder.encode(text);
    const id = uuidv7();
    rows.push({
      id,
      projectId: project.id,
      path,
      kind: 'markdown',
      size: bytes.byteLength,
      version: uuidv7(),
      contentHash: await sha256B64Url(bytes),
      createdAt: now,
      updatedAt: now,
    });
    contents.push({ fileId: id, text });
  }

  const db = getClientDataDb();
  await mapQuota(
    db.transaction('rw', db.projects, db.projectFiles, db.projectContents, async () => {
      await db.projects.add(project);
      await db.projectFiles.bulkAdd(rows);
      await db.projectContents.bulkAdd(contents);
    }),
  );
  return { project, imported: rows.length, skipped };
}
