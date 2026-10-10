# Project Filesystem (Stage 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local, Unix-style project filesystem in the user-client's Dexie database, with revisions, trash integration, zip backup and a preview-flagged UI harness.

**Architecture:** Four new tables in `chatsundere_client_data` (v37). A framework-free module `apps/user-client/src/projects/` holds paths, errors, file operations, revisions, scan and zip; project deletes plug into the existing app-wide trash (`src/trash/`). Thin React hooks and three routes form the harness, gated by `settings.previews.projects`.

**Tech Stack:** TypeScript strict, Dexie 4, `uuidv7`, `fflate`, React 18 + React Router, TanStack Query, Tailwind v4, Vitest + fake-indexeddb, Vitest browser mode (Playwright provider).

**Spec:** `superpowers/specs/2026-10-09-project-filesystem-design.md` — read it before your task; section numbers below refer to it.

## Global Constraints

- All repo text is **British English** (code, comments, copy, commits). Copy strings quoted in the spec are used **verbatim**.
- Every new source file starts with `// SPDX-License-Identifier: AGPL-3.0-only`.
- `strict` + `noUncheckedIndexedAccess`; no `any` without an inline reason. One-line JSDoc on every exported function.
- **Inside a Dexie transaction, await only Dexie operations.** `crypto.subtle`, `fetch`, timers and any other promise run before `db.transaction(...)`. Synchronous `uuidv7()`/`TextEncoder` are fine inside.
- Project rows **never** reach the sync engine: no `syncOutbox` writes, no `enqueueSync`, no `isDeadKey` lookups for project collections. No change to `packages/shared-types`, `apps/sync-service` or `packages/crypto`.
- Limits: path ≤ **1024** UTF-16 units, segment ≤ **255**, revisions **20** per file, scan batch **100**.
- Tests: `pnpm --filter @chatsundere/user-client exec vitest run <path>`; tests import `'fake-indexeddb/auto'` and reset with `_resetClientDataDbForTests()` in `beforeEach`, `openClientDataDb()` after.
- Commit after each task: free-form imperative subject, capitalised, no prefix; trailer `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`. **Subagents commit on the current branch only — never push, merge, rebase or switch branches.**
- Lefthook runs Biome on staged files at commit; fix, don't bypass.

## Review Focus

1. **Unicode and odd names** — a path with combining characters typed as NFD finds the NFC file; spaces, emoji and `#`/`?` in names survive list, move, zip round trip and the `?path=` URL (encode with `encodeURIComponent`). → Task 2 (NFD/NFC test), Task 5 (zip with `/Notizen/Größe café.md` and emoji), Task 9 (URL round trip with `#` and `?`).
2. **Prefix confusion** — moving or deleting `/a` must not touch `/ab.md` or `/a-b/x.md` (range is `'/a/'`…, never `'/a'`…). → Task 4 and Task 6 tests.
3. **Move onto itself / no-op** — `move('/a.md', '/a.md')` is a no-op (no new version); `move('/a', '/a')` likewise; moving a file onto an existing directory path → `IsDirectory`. → Task 4.
4. **Very large single file** — a 5 MB Markdown write and read works and its revision is stored; the textarea stays usable (no per-keystroke DB work). → Task 3 test (5 MB round trip), Task 9 (save only on Save).
5. **Import of hostile zips** — entries with `../`, absolute Windows paths (`C:\x.md`), backslashes, duplicate paths after normalisation, or a zip with no Markdown at all → clear refusal or toast, nothing half-written. → Task 5.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/boot/client-data-db.ts` (modify) | v37 tables, row types, `SettingsRow.previews`, `TrashRow.batch`, `TrashRow.collection: LocalCollection` |
| `src/projects/errors.ts` | `ProjectFsError`, codes, messages |
| `src/projects/path.ts` | normalisation, validation, path helpers, `.md` helper |
| `src/projects/fs.ts` | projects + file operations |
| `src/projects/revisions.ts` | revision capture, cap, list/read/restore, orphan sweep |
| `src/projects/scan.ts` | batched content iteration |
| `src/projects/zip.ts` | export/import |
| `src/projects/trash.ts` | soft delete of files/folders/projects, undo handles, card restore of project members |
| `src/projects/persistence.ts` | `persist()` / `estimate()` wrappers |
| `src/projects/hooks.ts` | React hooks (only file importing React) |
| `src/trash/trash-model.ts`, `trash-repo.ts`, `delete-toast.ts` (modify) | `LocalCollection`, new kinds, batch cards, file counts, project restore delegation, error toasts |
| `src/routes/app/account/recently-deleted.tsx` (modify) | nouns, counts, purge copy, `onError` |
| `src/routes/app/settings/previews.tsx` | Previews page |
| `src/routes/app/projects/list.tsx`, `tree.tsx`, `file.tsx` | harness routes |
| `src/routes/app/projects/PathDialog.tsx`, `StorageCard.tsx` | shared harness pieces |

---

### Task 1: Schema v37 and types

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts` (row types near the other interfaces; `ClientDataDb` table declarations ~line 818; new `this.version(37)` after v36 ~line 1567)
- Modify: `apps/user-client/src/trash/trash-model.ts` (add `LocalCollection`)
- Test: `apps/user-client/tests/projects/schema.test.ts`

**Interfaces:**
- Produces (exported from `client-data-db.ts`): `ProjectRow`, `ProjectFileRow`, `ProjectContentRow`, `ProjectRevisionRow` exactly as spec §3; tables `projects`, `projectFiles`, `projectContents`, `projectRevisions` with the spec §3 index strings; `SettingsRow.previews?: { projects?: boolean }`; `TrashRow.batch?: { key: string; title: string; kind: TrashEntityKind }`.
- Produces (from `trash-model.ts`): `type ProjectCollection = 'projects' | 'projectFiles' | 'projectContents'`; `type LocalCollection = SyncCollection | ProjectCollection`; `isProjectCollection(c: string): c is ProjectCollection`; `isSyncCollection(c: LocalCollection): c is SyncCollection`. `TrashRow.collection` becomes `LocalCollection`. `TrashEntityKind` gains `'project' | 'projectFile' | 'projectFolder'`.

- [ ] **Step 1: Write the failing test** `schema.test.ts`:
  - `it('opens at v37 with the project tables')` → `db.verno === 37`; each of the four tables exists.
  - `it('enforces a unique path per project')` → put two `ProjectFileRow`s with the same `[projectId+path]` → second `add` rejects with `ConstraintError`; same path in a different `projectId` succeeds.
  - `it('keeps existing trash rows valid')` → a `TrashRow` without `batch` round-trips unchanged.
- [ ] **Step 2: Run** `pnpm --filter @chatsundere/user-client exec vitest run tests/projects/schema.test.ts` — expect FAIL.
- [ ] **Step 3: Implement.** `this.version(37).stores({...})` with the four tables only, no upgrade function. Fix every compile error the `LocalCollection` widening causes in `src/trash/*` and `src/sync/*` by narrowing with `isSyncCollection` where a `SyncCollection` is required (never by casting). Add `isSyncCollection` guards in `restoreCard` around `enqueueSync`/`blobFieldsOf`/`enqueueBlobPut`.
- [ ] **Step 4: Run** the test and `pnpm --filter @chatsundere/user-client typecheck` — expect PASS; then `pnpm --filter @chatsundere/user-client exec vitest run tests/trash tests/sync` — all PASS.
- [ ] **Step 5: Commit** "Add project tables to the client database".

### Task 2: Paths and errors

**Files:**
- Create: `apps/user-client/src/projects/errors.ts`, `apps/user-client/src/projects/path.ts`
- Test: `apps/user-client/tests/projects/path.test.ts`, `tests/projects/errors.test.ts`

**Interfaces:**
- Produces `errors.ts`:
  ```ts
  export type ProjectFsErrorCode = 'NotFound' | 'AlreadyExists' | 'VersionConflict' | 'InvalidPath'
    | 'EscapesRoot' | 'IsDirectory' | 'NotDirectory' | 'QuotaExceeded';
  export type InvalidPathReason = 'not-absolute' | 'control-character' | 'too-long' | 'root'
    | 'into-self' | 'extension';
  export interface ProjectFsErrorDetail { path?: string; current?: string; passed?: string;
    reason?: InvalidPathReason; others?: number }
  export class ProjectFsError extends Error { readonly code: ProjectFsErrorCode; readonly detail: ProjectFsErrorDetail }
  export function isProjectFsError(e: unknown, code?: ProjectFsErrorCode): e is ProjectFsError;
  export function fsError(code: ProjectFsErrorCode, detail: ProjectFsErrorDetail): ProjectFsError; // builds the message
  ```
  `name = 'ProjectFsError'`; `message` starts with `<code>: ` and is actionable. Fixed forms: VersionConflict → `` `VersionConflict: ${path} is at version ${current}, you passed ${passed}; re-read the file before writing.` ``; NotFound → `` `NotFound: ${path} does not exist.` ``; AlreadyExists → `` `AlreadyExists: ${path} already exists.` ``; QuotaExceeded → `'QuotaExceeded: this device is out of space for projects; export a project to keep a copy, then free some space.'`.
- Produces `path.ts`: `MAX_PATH_LENGTH = 1024`, `MAX_SEGMENT_LENGTH = 255`, `normalisePath(input: string): string`, `normaliseFilePath(input: string): string` (normalise + refuses `/` with reason `root` + extension check), `withMarkdownExtension(input: string): string` (appends `.md` when the final segment has no extension, throws `InvalidPath{reason:'extension'}` for any extension other than `md`/`markdown`, case-insensitive), `dirname(p)`, `basename(p)`, `isHiddenPath(p): boolean` (any segment starts with `.`), `isUnder(p: string, dir: string): boolean` (strict descendant; `isUnder('/ab.md','/a') === false`), `prefixRange(dir): [string, string]` returning `[dir === '/' ? '/' : dir + '/', <same> + '\uffff']`.
  Extension = text after the last `.` of the final segment when that `.` is not at index 0 (`.hidden` has none).

- [ ] **Step 1: Write failing table-driven tests** in `path.test.ts`:
  - normalise: `'/a//b/'→'/a/b'`, `'/a/./b'→'/a/b'`, `'/a/b/../c'→'/a/c'`, `'/'→'/'`, NFD `'/cafe\u0301.md'` → NFC `'/caf\u00e9.md'`.
  - reject: `''` and `'a/b'` → InvalidPath `not-absolute`; `'/../x'` and `'/a/../../x'` → EscapesRoot; `'/a\u0007b'` and `'/a\u007fb'` → `control-character`; 1025-char path and 256-char segment → `too-long`; `normaliseFilePath('/')` → `root`; `normaliseFilePath('/notes/x.txt')` → `extension`; `normaliseFilePath('/todo')` → `extension`.
  - `withMarkdownExtension`: `'/todo'→'/todo.md'`, `'/.hidden'→'/.hidden.md'`, `'/a.MD'` unchanged, `'/x.markdown'` unchanged, `'/x.txt'` throws `extension`.
  - `isUnder('/a/x.md','/a')` true; `isUnder('/ab.md','/a')` false; `isUnder('/a','/a')` false; everything is under `/`.
  - errors: `fsError('VersionConflict', {path:'/n.md', current:'B', passed:'A'}).message === 'VersionConflict: /n.md is at version B, you passed A; re-read the file before writing.'`
- [ ] **Step 2: Run** both test files — FAIL.
- [ ] **Step 3: Implement** both modules (pure, no imports from Dexie or React).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** "Add project path normalisation and typed errors".

### Task 3: Core file operations and revision capture

**Files:**
- Create: `apps/user-client/src/projects/fs.ts`, `apps/user-client/src/projects/revisions.ts` (capture + cap only in this task)
- Test: `apps/user-client/tests/projects/fs.test.ts`, `tests/projects/revisions-capture.test.ts`

**Interfaces:**
- Consumes: Task 1 tables, Task 2 `normalisePath`, `normaliseFilePath`, `fsError`, `isUnder`, `prefixRange`, `isHiddenPath`.
- Produces `fs.ts`:
  ```ts
  export type FileMeta = ProjectFileRow;
  export type Entry = { type: 'file'; meta: FileMeta } | { type: 'dir'; path: string };
  export interface ListOptions { recursive?: boolean; includeHidden?: boolean; sort?: 'name' | 'mtime' }
  export interface WriteOptions { ifVersion?: string; createOnly?: boolean }
  export function createProject(name: string): Promise<ProjectRow>;      // trimmed; empty → 'Untitled project'
  export function listProjects(): Promise<ProjectRow[]>;                 // updatedAt desc
  export function getProject(projectId: string): Promise<ProjectRow | undefined>;
  export function renameProject(projectId: string, name: string): Promise<void>; // NotFound if missing
  export function stat(projectId: string, path: string): Promise<FileMeta | null>;
  export function statById(fileId: string): Promise<FileMeta | null>;
  export function list(projectId: string, dir: string, opts?: ListOptions): Promise<Entry[]>;
  export function readText(projectId: string, path: string): Promise<{ meta: FileMeta; text: string }>;
  export function writeText(projectId: string, path: string, text: string, opts?: WriteOptions): Promise<FileMeta>;
  export function sha256B64Url(bytes: Uint8Array): Promise<string>;     // shared with zip/trash
  export function mapQuota<T>(p: Promise<T>): Promise<T>;               // Dexie QuotaExceededError → fsError('QuotaExceeded')
  export function _setFaultHookForTests(hook: ((step: string, n: number) => void) | null): void;
  ```
- Produces `revisions.ts` (this task): `export const REVISION_CAP = 20;` `export function recordRevision(tx: Transaction, fileId: string, version: string, text: string, size: number, now: number): Promise<void>` — puts the row, then deletes the oldest beyond 20 via `[fileId+createdAt]`.

Semantics (spec §4.2–4.5): `writeText` normalises with `normaliseFilePath`; pre-computes `contentHash` (SHA-256, base64url) and `size` (UTF-8 bytes) **before** the transaction; inside one `rw` over `projects, projectFiles, projectContents, projectRevisions`: `NotFound` if the project is missing; `IsDirectory` if any file is under `path`; `NotDirectory` if any ancestor of `path` is a file; existing file → `createOnly` → `AlreadyExists`, `ifVersion` mismatch → `VersionConflict`, same `contentHash` → return current meta unchanged, else `recordRevision` of the old content, new `version = uuidv7()`; missing file with `ifVersion` → `NotFound`; bump `projects.updatedAt`. `list(dir)` throws `NotDirectory` when `dir` is a file and `NotFound` when `dir` ≠ `/` has no files under it; `list` and `stat` **never** read `projectContents`. `sort:'name'` = directories first, then code-point order of basename; `'mtime'` = directories first (by name), files by `updatedAt` desc. Default `sort: 'name'`.

- [ ] **Step 1: Write failing tests** in `fs.test.ts`:
  - create/list/rename projects; `listProjects` order by `updatedAt`.
  - `writeText('/notes/plan.md')` then `list('/')` → `[{type:'dir', path:'/notes'}]`; `list('/', {recursive:true})` → the file; `list('/notes')` → the file.
  - dotfile `/.ideas.md` hidden from `list('/')`, present with `includeHidden: true`.
  - `IsDirectory` writing `/notes`; `NotDirectory` writing `/notes/plan.md/x.md`; `list('/notes/plan.md')` → NotDirectory; `list('/nope')` → NotFound.
  - `createOnly` on existing → AlreadyExists; `ifVersion: 'stale'` → VersionConflict with `detail.current === meta.version`, and `readText` still returns the old text; `ifVersion` on a missing path → NotFound and `stat` stays null.
  - identical content → same `version`, no revision row.
  - **no content reads:** wrap `db.projectContents` read methods via `vi.spyOn(db.projectContents, 'get')`, `'bulkGet'`, `'toArray'`, `'where'` → `list` (both modes) and `stat` leave all spies at 0 calls.
  - 5 MB string round-trips; the second write stores a 5 MB revision.
  - two Dexie instances: open a second `new ClientDataDb()` on the same name; write via module A, stale write through instance B's path (call `writeText` with the earlier version) → VersionConflict.
- [ ] **Step 2: Write failing tests** in `revisions-capture.test.ts`: 25 writes → exactly 20 revisions, the oldest 5 gone; each revision holds the content its version had.
- [ ] **Step 3: Run** — FAIL.
- [ ] **Step 4: Implement** `fs.ts` and `recordRevision`.
- [ ] **Step 5: Run** — PASS. **Step 6: Commit** "Add project file operations with optimistic versions".

### Task 4: Move and revision API

**Files:**
- Modify: `apps/user-client/src/projects/fs.ts` (add `move`), `apps/user-client/src/projects/revisions.ts`
- Test: `tests/projects/move.test.ts`, `tests/projects/revisions.test.ts`

**Interfaces:**
- Produces: `move(projectId: string, from: string, to: string, opts?: { ifVersion?: string }): Promise<void>`;
  `export interface RevisionMeta { version: string; size: number; createdAt: number }`;
  `listRevisions(projectId, path): Promise<RevisionMeta[]>` (newest first);
  `readRevision(projectId, path, version): Promise<string>` (NotFound when absent);
  `restoreRevision(projectId, path, version, opts?: { ifVersion?: string }): Promise<FileMeta>` (delegates to `writeText` with the revision text, so it records the replaced content and gets a new version).

`move` per spec §4.5: `from` a file → target via `normaliseFilePath`; `from` a directory → every file under `prefixRange(from)` rewritten in **one** `rw` transaction; target paths validated (length/extension) and checked against the index **before any put** (first collision → `AlreadyExists{path}`); `to` under `from` → `InvalidPath{reason:'into-self'}`; file onto an existing directory → `IsDirectory`; `from === to` → no-op; `ifVersion` with a directory → `IsDirectory`; every moved file gets a fresh `uuidv7()` version and `updatedAt`; `projects.updatedAt` bumped. Call the Task 3 fault hook as `faultHook('move-put', i)` before each put.

- [ ] **Step 1: Write failing tests** `move.test.ts`: file rename keeps `id`, changes `version`; directory move of 200 files; **atomicity:** `_setFaultHookForTests((s, n) => { if (s === 'move-put' && n === 100) throw new Error('injected'); })` → move rejects, and every path, version and `projects.updatedAt` equals the pre-move snapshot; collision with an existing target → AlreadyExists, nothing moved; into-self; `move('/a','/b')` leaves `/ab.md` and `/a-b/x.md` untouched; `move('/a.md','/a.md')` keeps the version; file onto existing dir → IsDirectory.
- [ ] **Step 2: Write failing tests** `revisions.test.ts`: list newest first; read a revision; restore creates a new version whose text equals the revision and adds the replaced text as a revision; history survives `move` of the file and of its parent directory.
- [ ] **Step 3: Run** — FAIL. **Step 4: Implement.** **Step 5: Run** — PASS.
- [ ] **Step 6: Commit** "Add atomic project moves and revision restore".

### Task 5: Scan and zip

**Files:**
- Create: `apps/user-client/src/projects/scan.ts`, `apps/user-client/src/projects/zip.ts`
- Test: `tests/projects/scan.test.ts`, `tests/projects/zip.test.ts`

**Interfaces:**
- Produces: `scan(projectId: string, opts?: { prefix?: string; kind?: 'markdown' }): AsyncIterable<{ meta: FileMeta; text: string }>` (metas via index, contents via `bulkGet` in batches of **100**, one read transaction per batch; hidden files skipped unless `prefix` itself is hidden).
  `export const MANIFEST_NAME = 'chatsundere-project.json';`
  `exportZip(projectId: string): Promise<Blob>` (fflate `zipSync`; entries = path without leading `/`, UTF-8 bytes; manifest `{"format":"chatsundere-project","version":1,"name":…}`; a live file at `/chatsundere-project.json` cannot exist because of the `.md` rule, so no refusal branch is needed).
  `export interface ImportResult { project: ProjectRow; imported: number; skipped: string[] }`
  `importZip(blob: Blob, opts?: { name?: string }): Promise<ImportResult>`.

Import (spec §7): unzip **before** any transaction; reject (InvalidPath naming the entry, nothing written) any entry whose name contains `\` or a drive prefix (`/^[A-Za-z]:/`), or that fails `normalisePath('/' + name)` (escape, control chars, length); ignore directory entries and the manifest; skip (into `skipped`) entries without a `.md`/`.markdown` extension and entries that are not valid UTF-8 (`new TextDecoder('utf-8', { fatal: true })`); duplicate paths after normalisation → InvalidPath naming the second; zero Markdown entries → still creates the project (empty) and reports `skipped`. Name: `opts.name` → manifest `name` → blob file name without `.zip` → `'Imported project'`. Hashes computed before the single `rw` transaction that writes the project and all files.

- [ ] **Step 1: Write failing tests** `scan.test.ts`: 1,000 files of ~8 KB → iterates all, asserts `elapsed < 3000` and logs the timing; prefix filter; hidden handling; `bulkGet` called ⌈n/100⌉ times.
- [ ] **Step 2: Write failing tests** `zip.test.ts`: round trip of `/a.md`, `/Notizen/Größe café.md`, `/emoji 🎸.md`, `/deep/x/y/z.md` → identical paths and texts (byte comparison), revisions and trash absent; manifest name used; entries `../x.md`, `C:\x.md`, `a\b.md` each reject with nothing created (`listProjects()` length unchanged); `notes.txt` and a binary `.md` (invalid UTF-8) land in `skipped`; duplicate `a.md` + `./a.md` rejects.
- [ ] **Step 3: Run** — FAIL. **Step 4: Implement.** **Step 5: Run** — PASS.
- [ ] **Step 6: Commit** "Add project scan and zip backup".

### Task 6: Trash — delete, cards and copy

**Files:**
- Create: `apps/user-client/src/projects/trash.ts`
- Modify: `src/trash/trash-model.ts` (`PARENT_FIELD_COLLECTION` gains `projectId: 'projects'`, `fileId: 'projectFiles'`; `deriveTrashMeta` cases for the three project collections), `src/trash/trash-repo.ts` (`cardKeyOf` batch rule, `TrashCard.counts.files?` and `earlierFiles?`, titles, batch cards), `src/trash/delete-toast.ts`, `src/routes/app/account/recently-deleted.tsx`
- Test: `tests/projects/trash-delete.test.ts`, extend `tests/trash/list-cards.test.ts`, `tests/routes/recently-deleted-projects.test.tsx`

**Interfaces:**
- Produces `projects/trash.ts`: `deletePath(projectId: string, path: string, opts?: { ifVersion?: string }): Promise<ProjectDeleteResult>`, `deleteProject(projectId: string): Promise<ProjectDeleteResult>` where `interface ProjectDeleteResult { cardKey: string; handle: TrashUndoHandle; message: string }`.
- Produces `delete-toast.ts`: `showCardDeleteToast(cardKey: string, handle: TrashUndoHandle, invalidate: () => void, message?: string): void`; `showDeleteToast` keeps its signature and delegates. Undo failures that are `isProjectFsError(e,'AlreadyExists')` show `describeRestoreError(e)` as a `tone: 'warn'` toast instead of rethrowing.
- Produces `trash/restore-error.ts`: `describeRestoreError(e: unknown): string | null` → for AlreadyExists: `` `Can't restore: ${path} already exists. Rename or move that file, then restore again.` ``, with `` ` (and ${others} more)` `` inserted after the path when `detail.others > 0`; else null.

Delete semantics (spec §5.2): one `rw` transaction over `projects, projectFiles, projectContents, trash`; `snapshotRowIntoTrash` for each file row and its content row (content `parentRef = {field:'fileId', id}`, file `parentRef = {field:'projectId', id}`), then delete them. Folder delete stamps every **file** row with `batch = { key: uuidv7(), title: '<dir without leading slash>/ — <project name>', kind: 'projectFolder' }`, `cardKey = 'batch:<key>'`, message `` `Moved ${dir}/ (${n} files) to Recently deleted` `` (dir without leading slash). File delete: `cardKey = 'projectFiles:<fileId>'`, message `'Moved to Recently deleted · recoverable for 30 days'`. Project delete snapshots the project row too, `cardKey = 'projects:<id>'`. `deletePath('/')` → InvalidPath `root`; `ifVersion` on a directory → IsDirectory; NotFound for nothing at the path. The returned handle's `restore()` re-puts the snapshots in place after checking every file path against the live `[projectId+path]` index (collision → `fsError('AlreadyExists', {path: first, others: rest})`, nothing restored) and deletes the added trash rows. `snapshotRowIntoTrash`'s `collection` parameter widens to `LocalCollection`.

Cards (spec §5.2): `cardKeyOf` walks `parentRef` as today; if the top row carries `batch`, return `'batch:' + batch.key`. `listTrashCards` builds batch cards from `batch.title`/`batch.kind` with `deletedAt` of the newest member. Titles: `projectFiles` → path without leading `/`; `projects` → `name`. `counts.files` = number of `projectFiles` members (content rows never counted, `items` excludes them too); `counts.earlierFiles` = file members whose `deletedAt` is older than the root's. Recently deleted: `ENTITY_NOUN` gains `project: 'project'`, `projectFile: 'file'`, `projectFolder: 'folder'`; `countSummary` renders `'1 file'`/`'N files'` when `files` is set, plus `' · includes N files deleted earlier'`; `purgeBody` for folder/project reads `` `Permanently delete this ${noun} and its ${n} files? This cannot be undone.` ``; file card subtitle shows the project name (look it up from the live project or the card's project snapshot). The `restore` mutation gains `onError` → `toastStore.show({ message: describeRestoreError(e) ?? 'Could not restore. Please try again.', tone: 'warn', durationMs: 8000 })`.

- [ ] **Step 1: Write failing tests** `trash-delete.test.ts`: file delete removes meta+content, adds 2 trash rows, `listTrashCards()` shows one card titled `notes/plan.md` with `counts.files === 1`; folder delete of 3 files → one card `notes/ — P` with `files === 3`, `/notesX.md` untouched; project delete → one card with `files === N`; delete `/a.md`, then delete project → project card has `earlierFiles === 1`; undo restores in place with the same `fileId`s; undo after a new file took the path → AlreadyExists, nothing restored, trash rows kept; revisions untouched by delete; no `syncOutbox` rows written in any case.
- [ ] **Step 2: Write failing UI test** `recently-deleted-projects.test.tsx`: render the page with a folder card → shows "3 files"; purge confirm body text exact; restore that throws AlreadyExists shows the `Can't restore: …` toast and the card stays.
- [ ] **Step 3: Run** — FAIL. **Step 4: Implement.** **Step 5: Run** these plus `tests/trash` — PASS.
- [ ] **Step 6: Commit** "Route project deletes through Recently deleted".

### Task 7: Trash — card restore and revision sweep

**Files:**
- Modify: `src/projects/trash.ts` (add `restoreProjectMembers`), `src/trash/trash-repo.ts` (`RESTORE_SCOPE` gains the four project tables; `restoreCard` delegates when every member is a project collection; `purgeCard` calls the sweep), `src/sync/worker.ts` (`purgeTrash` calls the sweep after its delete), `src/boot/activate-session.ts` (fire-and-forget sweep), `src/projects/revisions.ts`
- Test: `tests/projects/trash-restore.test.ts`

**Interfaces:**
- Produces: `restoreProjectMembers(tx: Transaction, members: TrashRow[], now: number): Promise<void>`; `sweepOrphanRevisions(): Promise<number>` (deletes revisions whose `fileId` has neither a live `projectFiles` row nor a `projectFiles:<fileId>` trash row; reads keys only; returns the count).

`restoreProjectMembers` (spec §5.3): mint `uuidv7()` for the project (if in the card) and each file; content rows follow their file's new id; `projectId` → new project id, else the live parent id from `parentRef`; within-card duplicate paths: the file with the newest `deletedAt` keeps the path, others become `` `${stem} (restored ${YYYY-MM-DD of now})${ext}` `` and then `` ` 2` ``, `` ` 3` ``… before the extension until free in both card and live index; then any collision with **live** files of the target project → `fsError('AlreadyExists', {path, others})` (aborts the transaction); re-key `projectRevisions` from old to new `fileId` (put new, delete old); bump the project's `updatedAt`; strip `batch` from restored rows; never enqueue sync.

- [ ] **Step 1: Write failing tests**: restore file card → new `fileId`, same path, content and **revisions re-keyed** (count equal, old key gone); folder (batch) card restore; project card restore with an earlier-deleted `/a.md` and a live-at-delete `/a.md` → paths `/a.md` and `/a (restored 2026-10-09).md` (fake the date with `vi.setSystemTime`); restore onto a live collision → rejects AlreadyExists with `detail.others`, nothing changed, card kept; `purgeCard` → revisions gone, other projects' revisions intact; `sweepOrphanRevisions` keeps revisions of trashed files.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** plus `tests/trash tests/sync` — PASS.
- [ ] **Step 5: Commit** "Restore project cards with history and sweep orphan revisions".

### Task 8: Hooks, previews flag, project list and storage card

**Files:**
- Create: `src/projects/hooks.ts`, `src/projects/persistence.ts`, `src/routes/app/settings/previews.tsx`, `src/routes/app/projects/list.tsx`, `src/routes/app/projects/StorageCard.tsx`, `src/routes/app/projects/PathDialog.tsx`, `src/routes/app/projects/ProjectsGate.tsx`
- Modify: `src/routes/app/settings.tsx` (Previews tile always; Projects tile when flag on), `src/App.tsx` (routes), `src/data/settings.ts` (read the flag via `useSettings()`, write via `useUpdateSettings()`; add a tiny `usePreviewFlag('projects'): boolean` helper there)
- Test: `tests/routes/app/projects-list.test.tsx`, `tests/routes/app/settings-previews.test.tsx`

**Interfaces:**
- Produces `hooks.ts` (Dexie `liveQuery` via the hook pattern used in `src/data/*.ts`): `useProjects(): ProjectRow[] | undefined` with file counts as `useProjectFileCounts(): Map<string, number>`, `useProject(id)`, `useProjectTree(projectId): FileMeta[] | undefined` (metadata only, `includeHidden` semantics: all files), `useProjectFile(fileId): FileMeta | null | undefined`, `useRevisions(fileId): RevisionMeta[] | undefined`.
- Produces `persistence.ts`: `requestPersistence(): Promise<void>` (calls `navigator.storage.persist()` when `persisted()` is false; no-op without the API), `useStorageStatus(): { persisted: boolean | null; usage: number | null; quota: number | null }` (null = API missing).
- Produces `PathDialog.tsx`: `PathDialog({ title, initial, placeholder?, confirmLabel, onSubmit: (path: string) => Promise<void>, onClose })` — runs `withMarkdownExtension` before `onSubmit`, shows any thrown `ProjectFsError`/`InvalidPath` inline in plain words and stays open with the input intact.
- Produces `ProjectsGate.tsx`: wraps project routes; flag off → `<Navigate to="/app/settings/previews" state={{ notice: 'Projects is a preview — turn it on here.' }} />`.

Copy (verbatim, spec §6.1/6.2): Previews tile meta `try early features`; toggle label `Projects (preview)`; explanation `An early look at project files. Projects live on this device only for now.`; turn-off line `` `Turning this off hides Projects; your ${n} projects stay on this device and return when you turn it back on.` `` (only when flag on and n > 0); storage lines `Storage is persistent` / `The browser may clear this data when space runs low — export projects you care about.` (with an inline Export hint linking nothing — the per-project menu exports), usage `` `Chatsundere uses ${fmt(usage)} of about ${fmt(quota)} available` ``, `Projects live on this device only for now.`. List rows: name, `N files`, last change; "New project" (name prompt → `createProject` → `requestPersistence()` → navigate to the project); "Import .zip" (file input → `importZip` → `requestPersistence()` → toast `` `Imported ${imported} files` `` plus `` ` · skipped ${skipped.length}` `` when any); each row an `OverflowMenu` with Rename, Export as .zip (download via an object URL, file name `<name>.zip`), Delete (`deleteProject` → `showCardDeleteToast`). Routes: `/app/settings/previews`, `/app/projects`, `/app/projects/:projectId`, `/app/projects/:projectId/file` — the last two render placeholders until Tasks 9–10.

- [ ] **Step 1: Write failing tests**: Previews tile always present in My Settings; Projects tile only with the flag; toggling writes `settings.previews.projects`; turn-off line names the count; `/app/projects` with flag off redirects and the notice text shows; list renders projects with counts; New project calls `persist` once when `persisted()` is false (mock `navigator.storage`); storage card shows each of persisted / not persisted / unsupported texts; overflow Delete shows the undo toast.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** "Add projects preview flag and project list harness".

### Task 9: Project tree page

**Files:**
- Create: `src/routes/app/projects/tree.tsx`, `src/projects/tree-model.ts` (pure: build a nested tree from `FileMeta[]`)
- Test: `tests/projects/tree-model.test.ts`, `tests/routes/app/projects-tree.test.tsx`

**Interfaces:**
- Produces `tree-model.ts`: `interface TreeNode { type: 'dir' | 'file'; name: string; path: string; hidden: boolean; children?: TreeNode[]; meta?: FileMeta }`, `buildTree(files: FileMeta[]): TreeNode[]` (dirs first, then names by code point, recursively).

Behaviour (spec §6.3, verbatim copy): header with name + `OverflowMenu` (Rename, Export as .zip, Delete → navigate to `/app/projects`, then `showCardDeleteToast`); collapsible directories, collapse state in `sessionStorage` key `projects.tree.<projectId>` (wrap in try/catch); every file shown, hidden ones with reduced opacity; file tap → `/app/projects/:projectId/file?path=${encodeURIComponent(path)}`; top-level **New file** (PathDialog, initial `/`, placeholder `e.g. /notes/plan.md — folders are created for you.`, `writeText(..., '', { createOnly: true })`, then open the file page with `?edit=1`); per-directory `OverflowMenu`: **New file here** (initial `/<dir>/`), Rename / Move, Delete; per-file `OverflowMenu`: Rename / Move (initial = full path), Delete; empty state `No files yet` with the New file button. Deletes use `deletePath` + `showCardDeleteToast(result.cardKey, result.handle, …, result.message)`.

- [ ] **Step 1: Write failing tests**: `buildTree` ordering and nesting, hidden flag; page renders dirs/files, dotfile dimmed (class assertion) and present; New file `/todo` creates `/todo.md`; `/x.txt` shows the extension message inline and keeps the dialog open; rename a directory moves its files; folder delete shows `Moved notes/ (2 files) to Recently deleted`; file link encodes `/a #1?.md`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** "Add project tree harness page".

### Task 10: File page

**Files:**
- Create: `src/routes/app/projects/file.tsx`
- Test: `tests/routes/app/projects-file.test.tsx`

Behaviour (spec §6.4, verbatim copy): resolve `?path=` once to a `fileId` via `stat`, then track with `useProjectFile(fileId)`; when its `path` changes, `navigate(…, { replace: true })` to the new `?path=` and show `` `Moved to ${path}.` ``; when it becomes null, show `This file was deleted.` with a link to the project. View: `MarkdownDoc` with the text from `readText` (reload when `version` changes and not editing). Edit (`?edit=1` opens directly): full-height textarea, buffer local state only; `PageScaffold` `dirty` + "● Unsaved" badge like `src/routes/app/knowledge/document.tsx`; Cancel with changes → confirm `Discard your changes?`; Save → `writeText(projectId, currentPath, buffer, { ifVersion: loadedVersion })`. `VersionConflict` → inline `This file changed elsewhere. If you keep yours, the other version stays in History.` with **Use theirs (discard my edit)** (reload text, leave edit mode) and **Keep mine** (re-save with `ifVersion: err.detail.current`). `QuotaExceeded` → inline `This device is out of space for projects — export a project to keep a copy, then free some space.`; any other error → `Could not save — your changes are kept. Try again.`; the buffer is never cleared on failure. Deleted while editing → buttons **Save as new file** (PathDialog, initial = old path, `createOnly: true`) and **Discard**. Collapsible **History**: `useRevisions(fileId)` newest first with time and size, **View** (shows that revision's text in place of the view, with a Back link) and **Restore** (confirm, then `restoreRevision` with `ifVersion` = current version).

- [ ] **Step 1: Write failing tests**: view renders Markdown; edit + save writes and leaves edit mode; stale save shows the conflict notice, Use theirs restores their text, Keep mine saves; move by another writer while editing → URL updates, `Moved to …` shown, save lands on the new path; delete while editing → Save as new file creates the file; History lists revisions and Restore changes the text; Cancel with changes asks.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** "Add project file page with history and conflict handling".

### Task 11: Real-browser smoke test, docs and gate

**Files:**
- Create: `apps/user-client/vitest.browser.config.ts`, `apps/user-client/tests-browser/projects-smoke.test.ts`
- Modify: `apps/user-client/package.json` (devDeps `@vitest/browser` and `playwright` pinned to versions compatible with `vitest ^2.1`; script `"test:browser": "vitest run -c vitest.browser.config.ts"`), `apps/user-client/README.md` (Projects preview section: what it is, device-only, zip backup, `test:browser`), `obsidian/insights/follow-ups-index.md` (trash auto-purge never runs for unlinked users; project sync decision session)

Browser config: `browser: { enabled: true, provider: 'playwright', name: 'chromium', headless: true, providerOptions: { launch: { executablePath: process.env.CHROMIUM_PATH } } }`, `include: ['tests-browser/**/*.test.ts']`; no `fake-indexeddb`. Do **not** run `playwright install`; locally use the pre-installed Chromium (`CHROMIUM_PATH=/opt/pw-browsers/chromium-*/chrome-linux/chrome` — resolve the real path with `ls`).

- [ ] **Step 1: Write the smoke test**: open the client DB, create a project, write `/a/b/c.md` and `/a/d.md`, `move('/a','/z')`, `closeClientDataDb()`, reopen, `readText('/z/b/c.md')` equals the text, `list('/z')` has `b` and `d.md`.
- [ ] **Step 2: Run** `CHROMIUM_PATH=… pnpm --filter @chatsundere/user-client test:browser` — PASS (record the command in the README).
- [ ] **Step 3: Gate**: `pnpm run build`, `pnpm typecheck`, `pnpm exec biome check .`, `pnpm --filter @chatsundere/user-client test` — all green; record counts.
- [ ] **Step 4: Commit** "Add projects browser smoke test and documentation".
