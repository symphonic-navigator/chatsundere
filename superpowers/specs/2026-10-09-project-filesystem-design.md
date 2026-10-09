# Project Filesystem (Stage 1) — Design Specification

**Date:** 2026-10-09 · **Author:** Liz, brainstormed with Chris · **Status:** design approved in conversation (2026-10-09), Laura spec-pass done (6 hard, 11 soft, all incorporated; Chris's picks 2026-10-09), awaiting written-spec review
**Input:** Chris's project brief "Project Filesystem Layer (Chatsundere)", Stage 1 of 3 (brainstormed with Claude on the web).

## 1. Purpose and Scope

### 1.1 Why

Projects are the one deliberately deferred client feature. A project is a
container of files that both the user and (from Stage 2) the agent work with.
Markdown is the centre of gravity; images follow later at low priority.

The brief splits the work into three stages: **1** the filesystem layer,
**2** agent tools on top (`ls`, `cat`, `write`, `edit`, `rg`, `mv`, `rm`,
outline reads), **3** E2EE sync. This spec covers **Stage 1 only**, designed
so that Stages 2 and 3 need neither a data migration nor a rewrite.

### 1.2 What changed against the brief, and why

The brief was written without the repository at hand. Three of its
assumptions do not hold, and the design follows the repository instead
(agreed with Chris, 2026-10-09):

1. **The E2EE sync engine already exists** (`apps/user-client/src/sync/`):
   per-row sealing, blind ids per `(collection, key)`, an outbox, CAS on
   `baseRev`, `deadKeys` tombstones, a backfill for late-linked devices.
   Project data therefore lives in the main Dexie database as ordinary tables
   that can later become sync collections. The brief's own `changelog`,
   `tombstones` and `device` stores are **dropped**: the outbox, `deadKeys` and
   the sync identity cover them in Stage 3. The brief's acceptance criteria on
   changelog entries fall away with them.
2. **The app already has a trash** (Account → *Recently deleted*,
   `apps/user-client/src/trash/`) with undo toast, grouped cards, 30-day purge
   and sync-aware tombstones. Project files use it. The brief's
   `/.trash/` path, its suffix collision rule and the `restore`/`purge` FS
   APIs are **dropped**. Chris and Liz judged an agent restoring from the
   trash a function that would barely be used; a narrow Stage 2 tool over the
   same trash remains possible without migration.
3. **Conventions differ:** the repository uses Dexie 4 (not `idb`), `uuidv7`
   (not ULID; same properties: time-ordered, globally unique) and already
   ships `fflate`.

The brief's "one opaque payload per file" becomes **two** payloads per file:
metadata and content are separate rows joined by the stable `fileId`, so a
rename or move never re-uploads content once sync exists. Chris explicitly
preferred this.

### 1.3 In scope

- Four new Dexie tables in `chatsundere_client_data` (v37).
- A framework-free FS module under `apps/user-client/src/projects/` with
  path normalisation, typed errors, optimistic concurrency, revisions,
  atomic directory moves, `scan()`, zip export/import.
- Trash integration: project, file and folder deletes as trash cards.
- A minimal UI harness behind a preview flag.
- `navigator.storage.persist()` request and a storage display.

### 1.4 Out of scope

- **Sync.** Deliberately deferred to a dedicated session with Chris
  (2026-10-10): whether and when project tables join `SYNC_COLLECTIONS`, the
  Markdown conflict model (last-writer-wins with conflict copies vs three-way
  merge), and whether revisions sync. Stage 1 writes nothing to `syncOutbox`
  and must not pre-empt any of these decisions.
- Agent tools and tool schemas (Stage 2). Search / `rg` (Stage 2).
- Image implementation. The schema admits `kind: 'image'` with Blob content;
  no code path writes images.
- Empty directories, permissions, symlinks.
- Local encryption at rest (see §2.3).
- Relationship to artefacts: **direction only**. Artefacts stay separate;
  `ArtefactRow.projectId` stays reserved and `null`. Whether artefacts become
  project files is decided with Stage 2.
- The final projects IA. The harness must not pre-empt it (STATUS: projects
  need Chris's project-oriented-memory model and the new IA).

## 2. Existing Data and Constraints

### 2.1 Database

`chatsundere_client_data` (Dexie 4, `apps/user-client/src/boot/client-data-db.ts`)
is at v36. Convention: non-indexed fields are added without a version bump.
Tests use `fake-indexeddb` via `apps/user-client/tests/setup.ts` and reset with
`_resetClientDataDbForTests()`.

### 2.2 Multi-tab

Dexie 4 propagates committed writes to `liveQuery` observers in every tab of
the origin and closes the connection on `versionchange` by default. No own
`BroadcastChannel` is needed. Concurrent writes from two tabs are resolved by
`ifVersion`, not by locking.

### 2.3 Encryption at rest

Client data is plaintext in IndexedDB; only individual secrets are sealed
(`lib/secrets.ts`). The browser profile is the trust boundary. Project data
follows that convention, which keeps `scan()` fast. Nothing in this design
prevents adding local sealing later: content lives in its own table.

### 2.4 Trash mechanics relevant here

- `softDelete` (`trash/delete-flow.ts`) dispatches to a per-family cascade
  collector, which snapshots rows into `db.trash` inside its delete
  transaction; the returned handle restores **in place** (same ids).
- `restoreCard` (`trash/trash-repo.ts`) restores a card as a **new-identity**
  cascade (fresh `uuidv7` ids) because a drained delete has a dead key.
- Cards group by the highest trashed ancestor, walking `parentRef` via
  `PARENT_FIELD_COLLECTION`.
- `TrashRow.collection`, `deriveTrashMeta`, `PARENT_FIELD_COLLECTION`,
  `RESTORE_SCOPE` and `softDelete` are typed on `SyncCollection`.
- The 30-day auto-purge (`purgeTrash` in `sync/worker.ts`) runs only inside a
  sync cycle, so it never runs for an unlinked user. This is pre-existing
  behaviour for every family; see §9.

## 3. Data Model

Dexie **v37** adds four tables. All ids and versions are `uuidv7`.

```ts
projects:         'id, updatedAt'
projectFiles:     'id, &[projectId+path], [projectId+updatedAt], projectId'
projectContents:  'fileId'
projectRevisions: '[fileId+version], fileId, [fileId+createdAt]'
```

```ts
interface ProjectRow {
  id: string;            // projectId
  name: string;
  createdAt: number;
  updatedAt: number;     // bumped by any file mutation in the project
}

interface ProjectFileRow {
  id: string;            // fileId — stable across rename/move
  projectId: string;
  path: string;          // normalised absolute path, e.g. '/notes/plan.md'
  kind: 'markdown' | 'image';
  size: number;          // UTF-8 bytes for markdown
  version: string;       // uuidv7, new on every content write or move
  contentHash: string;   // base64url SHA-256 of the content bytes
  createdAt: number;
  updatedAt: number;
}

interface ProjectContentRow {
  fileId: string;
  text?: string;         // markdown
  blob?: Blob;           // image (schema only in Stage 1)
}

interface ProjectRevisionRow {
  fileId: string;
  version: string;       // the version this content HAD
  text: string;
  size: number;
  createdAt: number;     // when it was superseded
}
```

Rules:

- **Path uniqueness** is a real unique index. Deleted files leave
  `projectFiles` (their state lives in the trash snapshot), so no `deletedAt`
  is needed. The FS checks first and throws a typed `AlreadyExists`; the
  index is the last line of defence.
- **Metadata never requires content.** `list`, `stat` and the tree never
  touch `projectContents`.
- **`version`** changes on every content write *and* on a move, because both
  change what a reader of the path sees. A rename of the project does not
  touch file versions.
- **`contentHash`** is computed with `crypto.subtle` *before* the
  transaction opens.
- **`ProjectRow.updatedAt`** is bumped in the same transaction as any file
  mutation, for "recently active" sorting of the project list.
- The meta/content split is the future sync shape: `projectFiles` and
  `projectContents` become two collections keyed by `fileId`; `projects`
  becomes a third. `projectRevisions` stays local unless Chris decides
  otherwise.

## 4. FS Module

### 4.1 Layout

```
apps/user-client/src/projects/
  path.ts        pure: normalise + validate, dirname/basename helpers
  errors.ts      ProjectFsError with a typed code
  fs.ts          project + file operations (Dexie, no React)
  revisions.ts   list/read/restore, cap enforcement
  scan.ts        AsyncIterable over content in batches
  zip.ts         export/import via fflate
  trash.ts       project collectors for the shared trash
  hooks.ts       useProjects, useProjectTree, useProjectFile (liveQuery)
```

Only `hooks.ts` imports React. Stage 2 tools call `fs.ts`, `revisions.ts` and
`scan.ts` directly.

### 4.2 Paths

`normalisePath(input): string` throws `InvalidPath` or `EscapesRoot`:

1. Must start with `/`; otherwise `InvalidPath { reason: 'not-absolute' }`.
2. Unicode NFC.
3. Collapse repeated `/`.
4. Resolve `.` and `..`; a `..` above the root throws `EscapesRoot`.
5. Strip a trailing `/` (the root `/` itself stays `/`).
6. Reject control characters (U+0000–U+001F, U+007F) →
   `InvalidPath { reason: 'control-character' }`.
7. Reject a path longer than **1024** UTF-16 code units or a segment longer
   than **255** → `InvalidPath { reason: 'too-long' }`.

8. A Markdown file's final segment must end in `.md` or `.markdown` →
   otherwise `InvalidPath { reason: 'extension' }`. This keeps every file
   representable in the zip round trip (§7); the UI appends `.md` for the user
   (§6.3).

Case-sensitive. A file path must not be `/`. Segments beginning with `.` are
hidden *from the API listings*: `list` omits them unless `includeHidden:
true`; `scan` includes them only when `prefix` names them explicitly. This is
groundwork for the Stage 2 tools (`ls`, `rg`). The human UI always passes
`includeHidden: true` and never hides a file (§6.3).

**Implicit directories:** a directory exists iff at least one file path has it
as a proper prefix. Writing a file whose path is an existing directory throws
`IsDirectory`; writing below an existing file (e.g. `/a.md/b.md`) throws
`NotDirectory`.

### 4.3 API

All functions are async, take a normalised-or-raw path (normalised
internally), and throw `ProjectFsError`. Every package-public function carries
JSDoc.

```ts
// projects
createProject(name: string): Promise<ProjectRow>;
listProjects(): Promise<ProjectRow[]>;                 // by updatedAt desc
renameProject(projectId: string, name: string): Promise<void>;
deleteProject(projectId: string): Promise<TrashUndoHandle>;   // → trash

// files
stat(projectId, path): Promise<FileMeta | null>;
list(projectId, dir, opts?: { recursive?: boolean; includeHidden?: boolean;
     sort?: 'name' | 'mtime' }): Promise<Entry[]>;
readText(projectId, path): Promise<{ meta: FileMeta; text: string }>;
writeText(projectId, path, text, opts?: { ifVersion?: string;
          createOnly?: boolean }): Promise<FileMeta>;
move(projectId, from, to, opts?: { ifVersion?: string }): Promise<void>;
deletePath(projectId, path, opts?: { ifVersion?: string }):
  Promise<TrashUndoHandle>;                            // file or directory → trash

// revisions
listRevisions(projectId, path): Promise<RevisionMeta[]>;   // newest first
readRevision(projectId, path, version): Promise<string>;
restoreRevision(projectId, path, version,
                opts?: { ifVersion?: string }): Promise<FileMeta>;

// Stage 2 groundwork
scan(projectId, opts?: { prefix?: string; kind?: 'markdown' }):
  AsyncIterable<{ meta: FileMeta; text: string }>;

// backup
exportZip(projectId): Promise<Blob>;
importZip(blob: Blob, opts?: { name?: string }): Promise<ProjectRow>;
```

`Entry = { type: 'file'; meta: FileMeta } | { type: 'dir'; path: string }`.
`FileMeta` is the `ProjectFileRow` shape (metadata only, never content).
A non-recursive `list` returns direct children: files at depth+1 and
directories derived from deeper paths, de-duplicated. `sort: 'name'` puts
directories first, then names by code point; `'mtime'` sorts files by
`updatedAt` desc with directories first.

`deletePath` on `/` is refused (`InvalidPath { reason: 'root' }`); deleting a
whole project is `deleteProject`.

As built, `deletePath` and `deleteProject` live in `projects/trash.ts` (not
`fs.ts`) and return `ProjectDeleteResult { cardKey, handle, message }` — the
trash card, the in-place Undo handle and the toast text — rather than a bare
`TrashUndoHandle`. `importZip` returns `ImportResult { project, imported,
skipped }` rather than the `ProjectRow` alone. `subscribe` from the brief is dropped:
`liveQuery` covers React, and Stage 2 tools do not subscribe.

### 4.4 Optimistic concurrency

- `ifVersion` applies to files only. Passed with a directory path →
  `IsDirectory`.
- On mismatch: `VersionConflict { path, current, passed }`, and **nothing is
  written** (the check happens inside the write transaction before any put).
- `createOnly: true` on an existing path → `AlreadyExists`.
- `ifVersion` on a non-existent path → `NotFound`; a write that names a
  version never creates a file.
- `writeText` with identical content (same `contentHash`) is a no-op that
  returns the current meta: no new version, no revision.

### 4.5 Transactions

IndexedDB auto-commits when no request is pending, and Dexie aborts a
transaction that awaits a foreign promise. Therefore:

- Hashing (`crypto.subtle`) and every other promise-returning non-Dexie
  call happen **before** `db.transaction(...)` opens. Synchronous work
  (`uuidv7()`, `TextEncoder`, path maths) is safe inside.
- A transaction body awaits only Dexie operations.
- Every mutation is one `rw` transaction over exactly the tables it needs.

**Directory move** `move('/a', '/b')`: in one `rw` transaction over
`projectFiles` and `projects`:

1. Read every file under `/a/` via the `[projectId+path]` range
   `['/a/', '/a/￿']`.
2. Reject moving a directory into itself (`/a` → `/a/x`) with `InvalidPath
   { reason: 'into-self' }`.
3. Compute all target paths; validate each (length limits); check every target
   against the index. Any collision → `AlreadyExists` naming the first
   colliding path, nothing written.
4. Rewrite every path with a fresh `uuidv7()` version (synchronous, so
   minted inside the transaction).

`move` on a single file is the same with one row. Revisions are keyed by
`fileId` and are untouched by any move.

### 4.6 Revisions

- On every content change (`writeText`, `restoreRevision`), the *previous*
  content goes into `projectRevisions` in the same transaction.
- Cap **20 per file**: after inserting, delete the oldest beyond 20 (via
  `[fileId+createdAt]`). No per-project size cap until real numbers exist.
- `restoreRevision` is a normal write with a new version (accepts
  `ifVersion`); the content it replaces becomes a revision itself.
- Revisions survive rename and move (keyed by `fileId`).

### 4.7 scan()

Read-only. Collects matching metas via the path range (prefix) or the
`projectId` index, then reads contents with `bulkGet` in batches of **100**,
one short read transaction per batch, yielding between batches. Images are
skipped when `kind: 'markdown'`.

Target: **1,000 files of ~8 KB each in under 1 s** under fake-indexeddb in
Vitest (asserted with generous CI headroom: the test fails above 3 s and
logs the timing).

### 4.8 Errors

```ts
type ProjectFsErrorCode =
  | 'NotFound' | 'AlreadyExists' | 'VersionConflict' | 'InvalidPath'
  | 'EscapesRoot' | 'IsDirectory' | 'NotDirectory' | 'QuotaExceeded';
```

`ProjectFsError extends Error` with `code` and a code-specific `detail`
(`VersionConflict` carries `current` and `passed`; `InvalidPath` carries
`reason`). Messages are British English and actionable for a model, e.g.
`VersionConflict: /notes/plan.md is at version 0192…, you passed 0191…; re-read the file before writing.`
A Dexie `QuotaExceededError` is mapped to `QuotaExceeded` with a message
pointing at export.

## 5. Trash Integration

### 5.1 Types

- A client-side `LocalCollection = SyncCollection | 'projects' | 'projectFiles'
  | 'projectContents'` type. `TrashRow.collection`, `deriveTrashMeta`,
  `snapshotRowIntoTrash`, `softDelete`, `PARENT_FIELD_COLLECTION` and
  `RESTORE_SCOPE` widen to it. Sync-only paths (`isDeadKey`, `enqueueSync`,
  outbox lookups) are guarded with an `isSyncCollection()` predicate, so
  project rows never reach the sync engine. No server or `shared-types`
  change.
- `TrashEntityKind` gains `'project' | 'projectFile' | 'projectFolder'`.
- `PARENT_FIELD_COLLECTION` gains `projectId: 'projects'`.

### 5.2 Snapshots

- **File delete:** snapshot the `projectFiles` row and its `projectContents`
  row (content `parentRef` → the file via a new `fileId: 'projectFiles'`
  mapping), then delete both. One card, titled by the file's full path
  without the leading slash (`notes/plan.md`), subtitle the project name.
- **Folder delete:** every file under the prefix, as above, in one
  transaction. To make the folder **one card**, `TrashRow` gains an optional,
  non-indexed `batch?: { key: string; title: string; kind: TrashEntityKind }`.
  `cardKeyOf` returns `batch:<key>` when the row's own parent chain ends
  untrashed and a batch is present; `listTrashCards` renders a batch card from
  `batch.title` (the full folder path, `notes/ideas/ — Project X`). Restoring or
  purging a batch card acts on all members. Existing rows carry no `batch` and
  behave exactly as before.
- **Project delete:** snapshot the project, all its files and contents. The
  files' `parentRef` → the project, so the existing ancestor walk makes it one
  card (`Project X`, *N files*).

Revisions are **not** snapshotted; they stay keyed by `fileId` (§5.4).

**Counts and copy.** Card counts tally `projectFiles` rows only; content rows
are never counted. `TrashCard.counts` gains `files?`. Card lines: file card →
project name · deleted …; folder card → *"3 files"*; project card →
*"12 files"*, plus *"includes 3 files deleted earlier"* when the card folded
in earlier file or folder deletes. `ENTITY_NOUN` gains `project: 'project'`,
`projectFile: 'file'`, `projectFolder: 'folder'`. Purge bodies read e.g.
*"Permanently delete this folder and its 3 files? This cannot be undone."*

**Toasts.** The folder-delete toast reads *"Moved notes/ (3 files) to Recently
deleted"*; its Undo and Delete permanently act on the whole batch.
`showDeleteToast` is widened to accept a card key instead of
`(collection, key)` for project deletes.

### 5.3 Restore

- **Undo toast** (in place, same ids): before re-putting, check every
  restored file path against the live index. A collision aborts the whole
  undo with `AlreadyExists`; nothing is restored.
- **Card restore** (new identity, `restoreCard`): same collision check in the
  same transaction, plus — for project rows — the fresh project id is mapped
  into each file's `projectId`, the fresh file id into each content row's
  `fileId`, and **revisions are re-keyed** from the old to the new `fileId`
  in the same transaction (`projectRevisions` joins `RESTORE_SCOPE`). History
  survives a restore. A file restored while its project is live goes back into
  that project; a file whose project is gone restores only as part of the
  project card (it folds into it by the ancestor walk).
- **Collisions within one card** are resolved deterministically, never
  refused (Chris, 2026-10-09). The file that was live when the project or
  folder was deleted keeps its path. An earlier-deleted file with the same
  path comes back as `<stem> (restored YYYY-MM-DD)<ext>` (with a numeric
  suffix if that is taken too). Only collisions against **live** rows abort.
- **A refused restore is never silent.** From the Undo toast or a Recently
  deleted card, an error toast names the path and the way out: *"Can't
  restore: /notes/plan.md already exists. Rename or move that file, then
  restore again."* For a folder or project card it names the first colliding
  path and the count of others. The card stays. `RecentlyDeletedPage`'s
  restore mutation gains the `onError` handler it lacks today, and
  `showDeleteToast` maps `AlreadyExists` to this toast instead of rethrowing.

### 5.4 Purge

Card purge and auto-purge only delete trash rows. A **revision orphan
sweep** removes every `projectRevisions` row whose `fileId` has neither a live
`projectFiles` row nor a `projectFiles:<fileId>` trash snapshot. It runs after
`purgeCard`, after `purgeTrash`, and once at boot (idempotent, cheap: it
reads keys only).

## 6. UI Harness

Mobile-first at 380 px, no desktop-specific work. User-facing styling per
CLAUDE.md §11, kept plain: this is a harness, not the final UX.

### 6.1 Preview flag

- New non-indexed settings field `previews?: { projects?: boolean }`.
- My Settings gains a permanent **Previews** tile (meta *"try early
  features"*) → `/app/settings/previews`, one toggle "Projects (preview)" with
  a one-line explanation: *"An early look at project files. Projects live on
  this device only for now."* When the flag is on and projects exist, a line
  under the toggle reads *"Turning this off hides Projects; your N projects
  stay on this device and return when you turn it back on."*
- When on, a **"Projects (preview)"** tile appears in the My Settings grid
  linking to `/app/projects`. When off, the tile is **hidden**, not disabled
  (Chris, 2026-10-09: an opt-in preview should not advertise itself; the
  permanent Previews tile is the discoverable entry). The project routes
  redirect to Previews with a one-line notice: *"Projects is a preview — turn
  it on here."*

### 6.2 `/app/projects`

- Storage card at the top: persistence state (*"Storage is persistent"* or
  one calm sentence *"The browser may clear this data when space runs low —
  export projects you care about."* with an inline Export hint, never a
  banner), origin-wide usage from `navigator.storage.estimate()`
  (*"Chatsundere uses 12 MB of about 2 GB available"*), and *"Projects live
  on this device only for now."*
- Project list (by `updatedAt`), each row: name, file count, last change.
- "New project" button → name prompt → project page.
- Per-project menu (the existing `OverflowMenu` ⋯ on each row; long-press
  may open it too but is never the only way): Rename, Export as .zip, Delete
  (undo toast).
- "Import .zip" button → file picker → new project named after the archive's
  `chatsundere-project.json` (or the file name), with a success toast.

### 6.3 `/app/projects/:id`

- Header with project name and a menu: Rename, Export as .zip, Delete.
  Deleting from here navigates to `/app/projects`, where the undo toast shows.
- File tree: directories collapsible (collapsed state per session in
  `sessionStorage`), files open the file page. **Every file is shown**;
  dotfiles and dot-directories are visually dimmed (Chris, 2026-10-09: the
  human always sees everything; hiding is a Stage 2 tool concern).
- The top-level "New file" prefills `/`; each directory's menu offers **New
  file here** (prefilled `/<dir>/`). Placeholder: *"e.g. /notes/plan.md —
  folders are created for you."* It creates an empty Markdown file and opens
  it in edit mode.
- **Extensions:** New file and Rename / Move append `.md` when the final
  segment has no extension; any other extension is refused inline: *"Projects
  hold Markdown files (.md) for now."* (Chris, 2026-10-09.)
- Per-file and per-directory `OverflowMenu` (⋯): "Rename / Move" (path
  dialog, prefilled with the full current path), "Delete" (undo toast).
- Path dialogs show `AlreadyExists`, `InvalidPath` (incl. into-self,
  too-long, extension) and `EscapesRoot` inline in plain words; the dialog
  stays open with the input intact.
- Empty state: *"No files yet"* with the "New file" button.

### 6.4 `/app/projects/:id/file?path=…`

- The page tracks the file by **`fileId`**; `?path=` only resolves it on
  entry.
- View mode: Markdown rendered with the existing `MarkdownDoc` renderer.
- "Edit" → a full-height textarea; "Save" writes with `ifVersion` = the
  version loaded. Edit mode reuses the knowledge editor's dirty guard
  (`PageScaffold` `dirty`) and "● Unsaved" badge; leaving with changes asks
  first, and "Cancel" with changes asks *"Discard your changes?"*. In edit
  mode, live updates never replace the buffer; they surface as the conflict
  notice on Save.
- On `VersionConflict`: an inline notice *"This file changed elsewhere. If you
  keep yours, the other version stays in History."* with **Use theirs
  (discard my edit)** and **Keep mine** (re-save with the new current
  version).
- Any other failed save keeps the editor open with the buffer intact and an
  inline message; `QuotaExceeded` reads *"This device is out of space for
  projects — export a project to keep a copy, then free some space."*
- **Moved while open** (rename, folder move, another tab, later the agent):
  the page follows the `fileId`, updates the URL and shows a quiet note
  *"Moved to /archive/plan.md."*; an edit in progress continues and saves to
  the new path.
- **Deleted while open:** *"This file was deleted."* with a link to the
  project. An edit in progress keeps its buffer and offers **Save as new
  file** (path prompt prefilled with the old path) and **Discard**.
- A collapsible **History** section: revisions newest first (time, size),
  each with "View" and "Restore". Restore confirms, then writes.

### 6.5 Persistence request

`navigator.storage.persist()` is requested after each successful
`createProject` or `importZip` while `navigator.storage.persisted()` is false.
Chromium decides silently (no prompt), so a retry costs the user nothing;
Firefox prompts once and remembers the answer, so it is not asked again. The
result is shown on the storage card only; no modal. Browsers without the API
show the "may clear" line.

## 7. Zip Format

- One entry per live file at its path without the leading `/`, content as
  UTF-8 bytes; images (none in Stage 1) as raw bytes.
- A root entry `chatsundere-project.json`:
  `{ "format": "chatsundere-project", "version": 1, "name": "…" }`.
  On import, a file entry with that exact path is treated as the manifest,
  never as a project file. A real project file of that name at the root is
  therefore not representable; export refuses it with a clear message.
- Revisions and trash are not exported.
- Import always creates a **new** project. Every entry path is normalised;
  any rejected path (escape, control characters, length) aborts the import
  with `InvalidPath` naming the entry. Directory entries are ignored.
  Non-Markdown entries (by extension `.md`/`.markdown`; anything else) are
  skipped and reported in the result toast. Import writes everything in one
  transaction.
- An import with zero accepted Markdown entries is refused and creates
  nothing; the list page shows the warning toast "No Markdown files found in
  that .zip." (ruling F-M3, final review).
- Round trip: paths and contents byte-identical.

## 8. Testing

### 8.1 Headless (Vitest + fake-indexeddb, in CI)

- `path.ts`: table-driven normalisation and rejection cases (NFC, `//`, `.`,
  `..`, escape, control characters, length limits, empty input, trailing
  slash, root).
- `fs.ts`: CRUD; implicit directories; `IsDirectory`/`NotDirectory`;
  recursive and flat `list` with derived subdirectories, hidden dotfiles and
  both sorts; `createOnly`; identical-content no-op.
- `VersionConflict`: nothing written, error carries `current` and `passed`.
- **Atomic directory move:** 200 files, a fault injected after the 100th put
  (test seam on the transaction body); afterwards every path, version and the
  project's `updatedAt` are unchanged. Collision and into-self cases.
- **Listing never loads content:** a Dexie hook / table spy on
  `projectContents` counts reads; `list`, `stat` and `useProjectTree`'s query
  stay at 0.
- **Auto-commit guard:** a multi-step write sequence that fails if anything
  inside the transaction awaits a non-Dexie promise (a deliberately broken
  variant behind a test seam proves the test catches it).
- Revisions: cap at 20, restore creates a new version and a revision of the
  replaced content, history survives rename and directory move.
- Trash: file, folder (one batch card) and project delete; undo in place;
  card restore with new ids and re-keyed revisions; restore onto an occupied
  path → `AlreadyExists`, nothing restored; orphan sweep after purge.
- Multi-tab: two Dexie instances on the same fake database; a stale write
  from the second → `VersionConflict`; a `liveQuery` on one sees the other's
  write.
- Zip: round trip byte-identical; manifest handling; rejected entry paths;
  skipped non-Markdown entries.
- `scan()`: 1,000 × ~8 KB under the §4.7 bound; prefix and hidden handling.
- Trash copy: counts tally files only; nouns for the three new kinds; batch
  toast acts on the whole folder; within-card collision gets the
  `(restored …)` suffix; a live collision shows the named error toast from
  both Undo and the Recently deleted card, and the card stays.
- `ifVersion` on a missing path → `NotFound`, nothing created; a path without
  `.md`/`.markdown` → `InvalidPath { reason: 'extension' }`.
- UI: preview flag gates tile and routes, Previews tile always present,
  turn-off copy; tree shows dimmed dotfiles; New file appends `.md` and
  refuses other extensions; path dialog errors inline; conflict notice offers
  both actions; dirty guard and Cancel confirm; file page follows a move and
  offers Save as new file after a delete; storage card renders persisted /
  not persisted / unsupported.

### 8.2 Real browser

The repository has no browser test setup. Add **Vitest browser mode** with
the Playwright provider as a separate script `test:browser` in
`apps/user-client` (not part of `pnpm test` or CI). One smoke test against
real IndexedDB in Chromium: create a project, write files in nested
directories, move a directory, close and reopen the database, read back.

### 8.3 Gate

`pnpm run build`, forced typecheck, Biome, user-client suite, and
`test:browser` once locally before the squash.

## 9. Audits and Follow-ups

- **Laura:** spec-pass on §6 before the plan; pre-squash pass on the built
  harness.
- **Larissa:** not summoned. No change touches `auth-service`,
  `sync-service`, `proxy-service` or `packages/crypto`, nothing crosses the
  network, and project rows are guarded out of the sync engine (§5.1). If the
  trash widening ends up touching sync code paths beyond the guards, that
  judgement is revisited.
- **Follow-up (pre-existing, not fixed here):** trash auto-purge runs only in
  a sync cycle, so unlinked users never auto-purge any family. Logged in
  `obsidian/insights/follow-ups-index.md`.
- **Follow-up:** the sync decision session (§1.4).

## 10. Manual Verification

Chris, on the phone and on desktop:

1. My Settings → Previews → enable "Projects (preview)"; the tile appears.
2. Create a project; the storage card shows the persistence result and usage.
3. Create `/notes/plan.md` and `/notes/ideas/one.md`; the tree shows `notes/`
   and `notes/ideas/`.
4. Edit and save `plan.md` three times; History lists three revisions;
   restore the first; the content matches and History grew.
5. Rename `/notes` to `/archive`; both files moved; `plan.md`'s History is
   intact.
6. Open `plan.md` in two tabs, edit and save in tab A; tab B's view updates;
   edit in tab B from the stale buffer and save → conflict notice; try both
   "Use theirs (discard my edit)" and "Keep mine".
7. Delete `one.md`, tap Undo → back. Delete the folder `/archive`; Recently
   deleted shows one folder card; restore it; files and History are back.
8. Delete the project; Recently deleted shows one project card with its file
   count; restore it.
9. Export as .zip, import it; the new project matches (open a file in each).
10. Reload the app and restart the PWA; everything is still there.
11. Disable the preview flag with projects present; the turn-off line names
    the count; the tile disappears and `/app/projects` redirects to Previews
    with the notice. Turn it back on; the projects are back.
12. Create `/.hidden.md`; it shows dimmed in the tree.
13. Create `/todo`; it becomes `/todo.md`. Try `/x.txt`; refused inline.
    Export and import; `todo.md` is in the new project.
14. Delete `plan.md`, create a new `plan.md`, tap Undo: the named-collision
    toast appears. Rename the new file, restore from the card: it works.
15. Delete `/a.md`, create a new `/a.md`, delete the project, restore the
    project card: both come back, the older as `a (restored …).md`.
16. Check card wording ("3 files", "12 files") and the purge confirm naming
    files; the folder-delete toast's Delete permanently removes the whole
    folder card.
17. Edit `plan.md` in tab A while tab B renames its folder: tab A follows and
    saves to the new path. Repeat with a delete in tab B: Save as new file is
    offered.
18. Cancel with unsaved changes asks first; in-app Back is guarded; reload/tab
    close warn.
19. Check the persistence line in Firefox (prompt) and Chromium (silent).
