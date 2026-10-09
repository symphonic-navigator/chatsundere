// SPDX-License-Identifier: AGPL-3.0-only
import { uuidv7 } from 'uuidv7';
import { type ProjectFileRow, type ProjectRow, getClientDataDb } from '../boot/client-data-db.js';
import { type ProjectFsError, fsError, isProjectFsError, projectNotFound } from './errors.js';
import {
  dirname,
  isHiddenPath,
  isUnder,
  normaliseFilePath,
  normalisePath,
  prefixRange,
} from './path.js';
import { recordRevision } from './revisions.js';

/** File metadata only; content is never part of it. */
export type FileMeta = ProjectFileRow;

export type Entry = { type: 'file'; meta: FileMeta } | { type: 'dir'; path: string };

export interface ListOptions {
  recursive?: boolean;
  includeHidden?: boolean;
  sort?: 'name' | 'mtime';
}

export interface WriteOptions {
  ifVersion?: string;
  createOnly?: boolean;
}

const UNTITLED = 'Untitled project';

let faultHook: ((step: string, n: number) => void) | null = null;

/** Test-only: installs a hook that multi-step operations call between steps to inject failures. */
export function _setFaultHookForTests(hook: ((step: string, n: number) => void) | null): void {
  faultHook = hook;
}

/** Calls the test fault hook, if any; a throw from it aborts the enclosing transaction. */
export function fault(step: string, n: number): void {
  faultHook?.(step, n);
}

let asyncFaultHook: (() => Promise<void>) | null = null;

/**
 * Test-only: installs an async hook awaited inside the `writeText` and `move`
 * transactions, so a test can prove a non-Dexie await there aborts the write.
 */
export function _setAsyncFaultHookForTests(hook: (() => Promise<void>) | null): void {
  asyncFaultHook = hook;
}

/** Base64url (unpadded) SHA-256 of `bytes`. Call outside Dexie transactions. */
export async function sha256B64Url(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource);
  let binary = '';
  for (const b of new Uint8Array(digest)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function isQuotaError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const { name, inner } = e as { name?: unknown; inner?: unknown };
  return name === 'QuotaExceededError' || (inner !== undefined && isQuotaError(inner));
}

/** Rethrows an IndexedDB quota failure (also when wrapped by Dexie) as `QuotaExceeded`. */
export async function mapQuota<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (!isProjectFsError(e) && isQuotaError(e)) throw fsError('QuotaExceeded', {});
    throw e;
  }
}

function cleanName(name: string): string {
  return name.trim() || UNTITLED;
}

/** Creates an empty project; a blank name becomes "Untitled project". */
export async function createProject(name: string): Promise<ProjectRow> {
  const now = Date.now();
  const row: ProjectRow = { id: uuidv7(), name: cleanName(name), createdAt: now, updatedAt: now };
  await mapQuota(getClientDataDb().projects.add(row));
  return row;
}

/** All projects, most recently changed first. */
export async function listProjects(): Promise<ProjectRow[]> {
  return getClientDataDb().projects.orderBy('updatedAt').reverse().toArray();
}

/** One project by id, or undefined. */
export async function getProject(projectId: string): Promise<ProjectRow | undefined> {
  return getClientDataDb().projects.get(projectId);
}

/** Renames a project (trimmed; blank becomes "Untitled project"); `NotFound` if missing. */
export async function renameProject(projectId: string, name: string): Promise<void> {
  const changed = await mapQuota(
    getClientDataDb().projects.update(projectId, { name: cleanName(name) }),
  );
  if (changed === 0) throw projectNotFound(projectId);
}

/** Throws `NotFound` naming the project when it does not exist; call inside a transaction. */
async function requireProject(projectId: string): Promise<void> {
  if (!(await getClientDataDb().projects.get(projectId))) throw projectNotFound(projectId);
}

/** The file at the normalised `path`, or undefined; usable inside a transaction. */
export function fileByPath(projectId: string, path: string): Promise<FileMeta | undefined> {
  return getClientDataDb().projectFiles.where('[projectId+path]').equals([projectId, path]).first();
}

/** Every file strictly below the normalised directory `dir`, as a Dexie collection. */
export function filesUnder(projectId: string, dir: string) {
  const [lo, hi] = prefixRange(dir);
  return getClientDataDb()
    .projectFiles.where('[projectId+path]')
    .between([projectId, lo], [projectId, hi], true, true);
}

/** Metadata of the file at `path`, or null (directories and missing paths). Never reads content. */
export async function stat(projectId: string, path: string): Promise<FileMeta | null> {
  return (await fileByPath(projectId, normalisePath(path))) ?? null;
}

/** Metadata of the file with this id, or null. Never reads content. */
export async function statById(fileId: string): Promise<FileMeta | null> {
  return (await getClientDataDb().projectFiles.get(fileId)) ?? null;
}

function compareCodePoints(a: string, b: string): number {
  const ia = a[Symbol.iterator]();
  const ib = b[Symbol.iterator]();
  for (;;) {
    const x = ia.next();
    const y = ib.next();
    if (x.done || y.done) return x.done ? (y.done ? 0 : -1) : 1;
    const d = (x.value.codePointAt(0) ?? 0) - (y.value.codePointAt(0) ?? 0);
    if (d !== 0) return d;
  }
}

function entryPath(e: Entry): string {
  return e.type === 'dir' ? e.path : e.meta.path;
}

function compareEntries(sort: 'name' | 'mtime') {
  return (a: Entry, b: Entry): number => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    if (sort === 'mtime' && a.type === 'file' && b.type === 'file') {
      const d = b.meta.updatedAt - a.meta.updatedAt;
      if (d !== 0) return d;
    }
    return compareCodePoints(entryPath(a), entryPath(b));
  };
}

/**
 * Entries below `dir`: direct children (files plus derived directories) or, with
 * `recursive`, every file. Dot-named segments below `dir` are omitted unless
 * `includeHidden`. Never reads content.
 */
export async function list(
  projectId: string,
  dir: string,
  opts: ListOptions = {},
): Promise<Entry[]> {
  const d = normalisePath(dir);
  const db = getClientDataDb();
  const rows = await db.transaction('r', db.projects, db.projectFiles, async () => {
    await requireProject(projectId);
    if (d !== '/' && (await fileByPath(projectId, d))) throw fsError('NotDirectory', { path: d });
    const found = await filesUnder(projectId, d).toArray();
    if (d !== '/' && found.length === 0) throw fsError('NotFound', { path: d });
    return found;
  });

  const base = prefixRange(d)[0];
  const entries: Entry[] = [];
  const dirs = new Set<string>();
  for (const meta of rows) {
    const rest = meta.path.slice(base.length);
    if (!opts.includeHidden && isHiddenPath(rest)) continue;
    const slash = rest.indexOf('/');
    if (opts.recursive || slash === -1) {
      entries.push({ type: 'file', meta });
    } else {
      const child = base + rest.slice(0, slash);
      if (!dirs.has(child)) {
        dirs.add(child);
        entries.push({ type: 'dir', path: child });
      }
    }
  }
  return entries.sort(compareEntries(opts.sort ?? 'name'));
}

/** Reads a file's metadata and text; `NotFound` when no file is at `path`. */
export async function readText(
  projectId: string,
  path: string,
): Promise<{ meta: FileMeta; text: string }> {
  const p = normalisePath(path);
  const db = getClientDataDb();
  return db.transaction('r', db.projects, db.projectFiles, db.projectContents, async () => {
    await requireProject(projectId);
    const meta = await fileByPath(projectId, p);
    if (!meta) throw fsError('NotFound', { path: p });
    const content = await db.projectContents.get(meta.id);
    return { meta, text: content?.text ?? '' };
  });
}

function ancestors(p: string): string[] {
  const out: string[] = [];
  for (let a = dirname(p); a !== '/'; a = dirname(a)) out.push(a);
  return out;
}

/**
 * Creates or replaces a Markdown file. `ifVersion` and `createOnly` guard
 * concurrent writers; identical content is a no-op returning the current meta.
 * The replaced content is kept as a revision.
 */
export async function writeText(
  projectId: string,
  path: string,
  text: string,
  opts: WriteOptions = {},
): Promise<FileMeta> {
  const p = normalisePath(path);
  // The extension check is deferred so that naming an existing folder reports
  // IsDirectory rather than a less helpful extension error.
  let extensionError: ProjectFsError | null = null;
  try {
    normaliseFilePath(p);
  } catch (e) {
    if (p === '/' || !isProjectFsError(e)) throw e;
    extensionError = e;
  }

  const bytes = new TextEncoder().encode(text);
  const size = bytes.byteLength;
  const contentHash = await sha256B64Url(bytes);
  const now = Date.now();
  const db = getClientDataDb();

  return mapQuota(
    db.transaction(
      'rw',
      [db.projects, db.projectFiles, db.projectContents, db.projectRevisions],
      async (tx) => {
        await requireProject(projectId);
        if (asyncFaultHook) await asyncFaultHook();
        if ((await filesUnder(projectId, p).count()) > 0) throw fsError('IsDirectory', { path: p });
        const above = ancestors(p);
        if (above.length > 0) {
          const blocking = await db.projectFiles
            .where('[projectId+path]')
            .anyOf(above.map((a) => [projectId, a]))
            .first();
          if (blocking) throw fsError('NotDirectory', { path: blocking.path });
        }
        if (extensionError) throw extensionError;

        const existing = await fileByPath(projectId, p);
        let meta: FileMeta;
        if (existing) {
          if (opts.createOnly) throw fsError('AlreadyExists', { path: p });
          if (opts.ifVersion !== undefined && opts.ifVersion !== existing.version) {
            throw fsError('VersionConflict', {
              path: p,
              current: existing.version,
              passed: opts.ifVersion,
            });
          }
          if (existing.contentHash === contentHash) return existing;
          const old = await db.projectContents.get(existing.id);
          await recordRevision(
            tx,
            existing.id,
            existing.version,
            old?.text ?? '',
            existing.size,
            now,
          );
          meta = { ...existing, size, contentHash, version: uuidv7(), updatedAt: now };
        } else {
          if (opts.ifVersion !== undefined) throw fsError('NotFound', { path: p });
          meta = {
            id: uuidv7(),
            projectId,
            path: p,
            kind: 'markdown',
            size,
            version: uuidv7(),
            contentHash,
            createdAt: now,
            updatedAt: now,
          };
        }
        await db.projectFiles.put(meta);
        await db.projectContents.put({ fileId: meta.id, text });
        await db.projects.update(projectId, { updatedAt: now });
        return meta;
      },
    ),
  );
}

export interface MoveOptions {
  ifVersion?: string;
}

interface MoveStep {
  source: FileMeta;
  target: string;
}

/**
 * Throws if writing `targets` would collide with a file that is not itself
 * moving: an existing file (`AlreadyExists`), a folder (`IsDirectory`) or a
 * file where a folder is needed (`NotDirectory`). `dst` is the move target,
 * whose subtree holds every file that could make a target a folder.
 */
async function checkMoveTargets(
  projectId: string,
  plan: readonly MoveStep[],
  dst: string,
): Promise<void> {
  const db = getClientDataDb();
  const moving = new Set(plan.map((m) => m.source.id));
  const targets = plan.map((m) => m.target);
  const stays = (f: FileMeta) => !moving.has(f.id);
  const occupied = new Set(
    (
      await db.projectFiles
        .where('[projectId+path]')
        .anyOf(targets.map((t) => [projectId, t]))
        .toArray()
    )
      .filter(stays)
      .map((f) => f.path),
  );
  const taken = targets.find((t) => occupied.has(t));
  if (taken !== undefined) throw fsError('AlreadyExists', { path: taken });

  const targetSet = new Set(targets);
  for (const f of (await filesUnder(projectId, dst).toArray()).filter(stays)) {
    const folder = ['/', ...ancestors(f.path)].find((a) => targetSet.has(a));
    if (folder !== undefined) throw fsError('IsDirectory', { path: folder });
  }

  const above = [...new Set(targets.flatMap(ancestors))];
  if (above.length > 0) {
    const blocking = (
      await db.projectFiles
        .where('[projectId+path]')
        .anyOf(above.map((a) => [projectId, a]))
        .toArray()
    ).find(stays);
    if (blocking) throw fsError('NotDirectory', { path: blocking.path });
  }
}

/**
 * Moves a file, or a directory with everything below it, in one transaction.
 * Every target is validated and checked before anything is written, so a
 * failed move changes nothing. Moved files keep their id (and so their
 * revisions) and get a fresh version; moving onto the same path is a no-op.
 * `ifVersion` applies to files only.
 */
export async function move(
  projectId: string,
  from: string,
  to: string,
  opts: MoveOptions = {},
): Promise<void> {
  const src = normalisePath(from);
  const dst = normalisePath(to);
  const now = Date.now();
  const db = getClientDataDb();

  await mapQuota(
    db.transaction('rw', db.projects, db.projectFiles, async () => {
      await requireProject(projectId);
      if (asyncFaultHook) await asyncFaultHook();
      const file = src === '/' ? undefined : await fileByPath(projectId, src);
      let plan: MoveStep[];
      if (file) {
        if (opts.ifVersion !== undefined && opts.ifVersion !== file.version) {
          throw fsError('VersionConflict', {
            path: src,
            current: file.version,
            passed: opts.ifVersion,
          });
        }
        if (src === dst) return;
        plan = [{ source: file, target: dst }];
      } else {
        const sources = await filesUnder(projectId, src).toArray();
        if (sources.length === 0) throw fsError('NotFound', { path: src });
        if (opts.ifVersion !== undefined) throw fsError('IsDirectory', { path: src });
        if (src === dst) return;
        if (isUnder(dst, src)) throw fsError('InvalidPath', { path: dst, reason: 'into-self' });
        const base = dst === '/' ? '' : dst;
        plan = sources.map((source) => ({
          source,
          target: normaliseFilePath(base + source.path.slice(src.length)),
        }));
      }

      await checkMoveTargets(projectId, plan, dst);
      // Checked after the folder checks so that naming a folder reports IsDirectory.
      if (file) normaliseFilePath(dst);

      // Moving a folder into an ancestor shortens every path by the same amount,
      // so a target can only be the current path of a shorter source; moving the
      // shorter paths first keeps the unique path index satisfied at every put.
      plan.sort((a, b) => a.source.path.length - b.source.path.length);
      for (const [n, { source, target }] of plan.entries()) {
        fault('move-put', n);
        await db.projectFiles.put({ ...source, path: target, version: uuidv7(), updatedAt: now });
      }
      await db.projects.update(projectId, { updatedAt: now });
    }),
  );
}
