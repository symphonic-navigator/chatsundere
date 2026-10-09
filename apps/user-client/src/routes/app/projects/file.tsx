// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { MarkdownDoc } from '../../../components/lightbox/previews/MarkdownDoc.js';
import { Badge } from '../../../components/ui/Badge.js';
import { Button } from '../../../components/ui/Button.js';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { formatBytes } from '../../../lib/treasury-filter.js';
import { isProjectFsError } from '../../../projects/errors.js';
import { readText, stat, writeText } from '../../../projects/fs.js';
import { useProject, useProjectFile, useRevisions } from '../../../projects/hooks.js';
import { basename } from '../../../projects/path.js';
import { type RevisionMeta, readRevision, restoreRevision } from '../../../projects/revisions.js';
import { PathDialog, QUOTA_COPY, describeProjectError } from './PathDialog.js';

const CONFLICT_COPY =
  'This file changed elsewhere. If you keep yours, the other version stays in History.';
const SAVE_FAILED_COPY = 'Could not save — your changes are kept. Try again.';

/** The text shown in view mode, pinned to the version it was read at. */
interface Loaded {
  version: string;
  text: string;
}

/** An edit in progress: `base` is the version the save is guarded against. */
interface Draft {
  base: string;
  baseHash: string;
  original: string;
  text: string;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * `/app/projects/:projectId/file?path=…` — one Markdown file with view, edit,
 * conflict handling and history (spec §6.4). The path only resolves the file
 * on entry; afterwards the page follows its `fileId` through moves.
 */
export function ProjectFilePage(): JSX.Element {
  const { projectId = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const urlPath = params.get('path') ?? '';
  const project = useProject(projectId);

  const [fileId, setFileId] = useState<string | null | undefined>(undefined);
  /** The path the page last saw the file at; a URL equal to it is our own doing. */
  const trackedPath = useRef<string | null>(null);
  const live = useProjectFile(fileId ?? '');
  // Until the fileId is resolved (and for the render after it changes) the live
  // value may describe nothing or a previous file; treat that as still loading.
  const meta = !fileId ? undefined : live && live.id !== fileId ? undefined : live;
  const revisions = useRevisions(fileId ?? '');

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [wantEdit, setWantEdit] = useState(() => params.get('edit') === '1');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ current: string } | null>(null);
  const [movedNote, setMovedNote] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [viewing, setViewing] = useState<{ version: string; text: string } | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<RevisionMeta | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const projectUrl = `/app/projects/${projectId}`;
  const fileUrl = useCallback(
    (path: string): string => `${projectUrl}/file?path=${encodeURIComponent(path)}`,
    [projectUrl],
  );

  // Resolve ?path= to a fileId on entry, and again only when the URL names a
  // path the page did not navigate to itself (e.g. a link to another file).
  useEffect(() => {
    if (urlPath === trackedPath.current) return;
    let cancelled = false;
    setFileId(undefined);
    setLoaded(null);
    setDraft(null);
    setViewing(null);
    setConflict(null);
    setSaveError(null);
    setMovedNote(null);
    void stat(projectId, urlPath)
      .catch(() => null)
      .then((m) => {
        if (cancelled) return;
        trackedPath.current = m ? m.path : urlPath;
        setFileId(m ? m.id : null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, urlPath]);

  // Follow a move: replace the URL and say where the file went.
  useEffect(() => {
    if (!meta || meta.path === trackedPath.current) return;
    trackedPath.current = meta.path;
    setMovedNote(`Moved to ${meta.path}.`);
    navigate(fileUrl(meta.path), { replace: true });
  }, [meta, navigate, fileUrl]);

  // A version change that kept the content (a move) must not turn the
  // in-progress edit into a conflict; a content change still does.
  useEffect(() => {
    if (!meta || !draft || meta.version === draft.base) return;
    if (meta.contentHash === draft.baseHash) setDraft({ ...draft, base: meta.version });
  }, [meta, draft]);

  const reload = useCallback(async (): Promise<void> => {
    if (!meta) return;
    try {
      const res = await readText(projectId, meta.path);
      if (res.meta.id === meta.id) setLoaded({ version: res.meta.version, text: res.text });
    } catch (e) {
      // NotFound means a move or delete raced the read; the live meta catches up.
      if (!isProjectFsError(e, 'NotFound')) console.warn('Project file read failed', e);
    }
  }, [meta, projectId]);

  // View mode follows live changes; edit mode never replaces the buffer.
  useEffect(() => {
    if (draft || !meta || loaded?.version === meta.version) return;
    void reload();
  }, [draft, meta, loaded?.version, reload]);

  // `?edit=1` opens the editor as soon as the text is in.
  useEffect(() => {
    if (!wantEdit || !loaded || !meta || loaded.version !== meta.version) return;
    setWantEdit(false);
    startEdit(loaded, meta.contentHash);
  });

  function startEdit(from: Loaded, hash: string): void {
    setViewing(null);
    setSaveError(null);
    setConflict(null);
    setDraft({ base: from.version, baseHash: hash, original: from.text, text: from.text });
  }

  function leaveEdit(): void {
    setDraft(null);
    setConflict(null);
    setSaveError(null);
  }

  async function save(ifVersion: string): Promise<void> {
    if (!draft || saving) return;
    const path = meta?.path ?? trackedPath.current;
    if (!path) return;
    setSaving(true);
    setSaveError(null);
    setConflict(null);
    const text = draft.text;
    try {
      const written = await writeText(projectId, path, text, { ifVersion });
      setLoaded({ version: written.version, text });
      setDraft(null);
    } catch (e) {
      if (isProjectFsError(e, 'VersionConflict') && e.detail.current !== undefined) {
        setConflict({ current: e.detail.current });
      } else if (isProjectFsError(e, 'QuotaExceeded')) {
        setSaveError(QUOTA_COPY);
      } else {
        if (!isProjectFsError(e)) console.warn('Project file save failed', e);
        setSaveError(SAVE_FAILED_COPY);
      }
    } finally {
      setSaving(false);
    }
  }

  async function view(rev: RevisionMeta): Promise<void> {
    if (!meta) return;
    setHistoryError(null);
    try {
      setViewing({
        version: rev.version,
        text: await readRevision(projectId, meta.path, rev.version),
      });
    } catch (e) {
      setHistoryError(describeProjectError(e) ?? 'Could not open that version. Please try again.');
    }
  }

  async function restore(rev: RevisionMeta): Promise<void> {
    if (!meta) return;
    setHistoryError(null);
    try {
      await restoreRevision(projectId, meta.path, rev.version, { ifVersion: meta.version });
      setViewing(null);
    } catch (e) {
      if (!isProjectFsError(e)) console.warn('Project revision restore failed', e);
      setHistoryError(describeProjectError(e) ?? 'Could not restore. Please try again.');
    }
  }

  const deleted = fileId === null || meta === null;
  const editing = draft !== null;
  const dirty = draft !== null && draft.text !== draft.original;
  const shownPath = meta?.path ?? trackedPath.current ?? urlPath;
  const projectName = project?.name ?? 'Project';

  return (
    <PageScaffold
      crumbs={[
        { label: 'Projects', to: '/app/projects' },
        { label: projectName, to: projectUrl },
        { label: basename(shownPath) || 'File' },
      ]}
      back={projectUrl}
      dirty={dirty}
    >
      {saveAsOpen && draft ? (
        <PathDialog
          title="Save as new file"
          initial={shownPath}
          confirmLabel="Save"
          onClose={() => setSaveAsOpen(false)}
          onSubmit={async (path) => {
            const written = await writeText(projectId, path, draft.text, { createOnly: true });
            trackedPath.current = written.path;
            setLoaded({ version: written.version, text: draft.text });
            setFileId(written.id);
            setSaveAsOpen(false);
            leaveEdit();
            setMovedNote(null);
            navigate(fileUrl(written.path), { replace: true });
          }}
        />
      ) : null}
      <div className="flex min-h-full flex-col gap-4 px-4 pb-8 pt-2">
        <div className="flex items-center justify-between gap-3">
          <h1 className="min-w-0 truncate font-mono text-sm text-paper">{shownPath}</h1>
          {dirty ? <Badge tone="warning">● Unsaved</Badge> : null}
        </div>
        {movedNote ? (
          <output className="block text-[11px] text-paper-soft">{movedNote}</output>
        ) : null}

        {deleted ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-paper-soft">This file was deleted.</p>
            <Link to={projectUrl} className="text-sm text-paper underline">
              Back to the project
            </Link>
          </div>
        ) : null}

        {editing ? (
          <>
            <textarea
              aria-label="File content"
              value={draft.text}
              spellCheck={false}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              className="min-h-[60dvh] w-full flex-1 resize-none rounded-md border border-paper-soft/30 bg-white/5 px-3 py-2 font-mono text-sm text-paper"
            />
            {conflict ? (
              <div className="flex flex-col gap-2 rounded-md border border-amber-400/30 bg-amber-400/5 p-3">
                <p role="alert" className="text-[12px] text-amber-200/90">
                  {CONFLICT_COPY}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => {
                      leaveEdit();
                      void reload();
                    }}
                  >
                    Use theirs (discard my edit)
                  </Button>
                  <Button
                    tone="primary"
                    disabled={saving}
                    onClick={() => void save(conflict.current)}
                  >
                    Keep mine
                  </Button>
                </div>
              </div>
            ) : null}
            {saveError ? (
              <p role="alert" className="text-[11px] text-amber-300/80">
                {saveError}
              </p>
            ) : null}
            <div className="flex gap-2">
              {deleted ? (
                <>
                  <Button tone="primary" priority onClick={() => setSaveAsOpen(true)}>
                    Save as new file
                  </Button>
                  <Button onClick={leaveEdit}>Discard</Button>
                </>
              ) : (
                <>
                  <Button onClick={() => (dirty ? setConfirmCancel(true) : leaveEdit())}>
                    Cancel
                  </Button>
                  <Button
                    tone="primary"
                    priority
                    disabled={saving || conflict !== null}
                    onClick={() => void save(draft.base)}
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </Button>
                </>
              )}
            </div>
          </>
        ) : null}

        {!editing && !deleted && meta && loaded ? (
          <>
            {viewing ? (
              <div className="flex flex-col gap-2">
                <p className="text-[11px] text-paper-soft">
                  An earlier version.{' '}
                  <button
                    type="button"
                    className="text-paper underline"
                    onClick={() => setViewing(null)}
                  >
                    Back to the current version
                  </button>
                </p>
                <MarkdownDoc content={viewing.text} />
              </div>
            ) : (
              <>
                <div>
                  <Button tone="primary" onClick={() => startEdit(loaded, meta.contentHash)}>
                    Edit
                  </Button>
                </div>
                <MarkdownDoc content={loaded.text} />
              </>
            )}
          </>
        ) : null}

        {!deleted && meta ? (
          <section className="flex flex-col gap-2">
            <button
              type="button"
              aria-expanded={historyOpen}
              className="self-start text-[11px] uppercase tracking-wider text-paper-soft"
              onClick={() => setHistoryOpen((o) => !o)}
            >
              {historyOpen ? '▾ ' : '▸ '}History
            </button>
            {historyOpen ? (
              revisions === undefined ? null : revisions.length === 0 ? (
                <p className="text-sm text-paper-soft">No earlier versions yet.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {revisions.map((rev) => (
                    <li key={rev.version} data-testid="revision" className="cs-row">
                      <span className="cs-row-body">
                        <span className="cs-row-title">{formatTime(rev.createdAt)}</span>
                        <span className="text-[11px] text-paper-soft">{formatBytes(rev.size)}</span>
                      </span>
                      <span className="cs-row-trailing flex gap-2">
                        <Button
                          disabled={editing}
                          title={editing ? 'Save or cancel your edit first.' : undefined}
                          onClick={() => void view(rev)}
                        >
                          View
                        </Button>
                        <Button
                          disabled={editing}
                          title={editing ? 'Save or cancel your edit first.' : undefined}
                          onClick={() => setRestoreTarget(rev)}
                        >
                          Restore
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
            {historyError ? (
              <p role="alert" className="text-[11px] text-amber-300/80">
                {historyError}
              </p>
            ) : null}
          </section>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmCancel}
        title="Discard your changes?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onCancel={() => setConfirmCancel(false)}
        onConfirm={() => {
          setConfirmCancel(false);
          leaveEdit();
        }}
      />
      <ConfirmDialog
        open={restoreTarget !== null}
        title="Restore this version?"
        body={
          restoreTarget
            ? `The version from ${formatTime(restoreTarget.createdAt)} becomes the current text. The current text stays in History.`
            : undefined
        }
        confirmLabel="Restore"
        onCancel={() => setRestoreTarget(null)}
        onConfirm={() => {
          const rev = restoreTarget;
          setRestoreTarget(null);
          if (rev) void restore(rev);
        }}
      />
    </PageScaffold>
  );
}
