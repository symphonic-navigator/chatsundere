// apps/user-client/src/routes/app/knowledge/library.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { DocumentRow, LibraryRow } from '../../../boot/client-data-db.js';
import { ModelDownloadBanner } from '../../../components/knowledge/ModelDownloadBanner.js';
import { Badge } from '../../../components/ui/Badge.js';
import { Button } from '../../../components/ui/Button.js';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog.js';
import { ListRow } from '../../../components/ui/ListRow.js';
import { OverflowMenu } from '../../../components/ui/OverflowMenu.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';
import { exportLibrary } from '../../../data/chatsundere-export.js';
import {
  useAddDocuments,
  useCreateLibrary,
  useDeleteLibrary,
  useDocuments,
  useLibraries,
  useUpdateLibrary,
} from '../../../data/knowledge.js';
import { useAdultMode } from '../../../data/settings.js';
import { slug, triggerDownload } from '../../../lib/download.js';
import { STATUS_LABEL, STATUS_TONE } from '../../../lib/knowledge-status.js';
import { toastStore } from '../../../state/toast.store.js';
import { useClass2Gate } from '../../../sync/gate.js';
import { InlineEditRow } from '../account/InlineEditRow.js';
import { InlineEditTextarea } from '../settings/InlineEditTextarea.js';

async function readTextFiles(
  files: FileList,
): Promise<{ ok: { title: string; content: string }[]; failed: string[] }> {
  const ok: { title: string; content: string }[] = [];
  const failed: string[] = [];
  for (const file of Array.from(files)) {
    try {
      const content = await file.text();
      if (content.trim().length === 0) {
        failed.push(file.name);
        continue;
      }
      ok.push({ title: file.name.replace(/\.(md|markdown|txt)$/i, ''), content });
    } catch {
      failed.push(file.name);
    }
  }
  return { ok, failed };
}

export function KnowledgeLibraryPage(): JSX.Element {
  const { libraryId } = useParams();
  return libraryId ? <EditLibrary libraryId={libraryId} /> : <CreateLibrary />;
}

function NsfwToggle(props: {
  on: boolean;
  onToggle: () => void;
}): JSX.Element {
  const { mode } = useAdultMode();
  const disabled = mode === 'sfw';
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-sm text-paper">Adult library</div>
        {disabled ? (
          <p className="text-[11px] text-paper-soft">Switch to NSFW mode to mark this adult.</p>
        ) : (
          <p className="text-[11px] text-paper-soft">
            Marked libraries are hidden while sanitised mode is active.
          </p>
        )}
      </div>
      <button
        type="button"
        aria-label="Adult library"
        aria-pressed={props.on}
        disabled={disabled}
        aria-disabled={disabled}
        onClick={() => {
          if (!disabled) props.onToggle();
        }}
        className={`h-6 w-12 shrink-0 rounded-full border ${
          props.on ? 'border-paper bg-paper/30' : 'border-paper-soft/30 bg-white/5'
        } ${disabled ? 'opacity-40' : ''}`}
      >
        <span
          className={`block h-5 w-5 rounded-full bg-paper transition-transform ${
            props.on ? 'translate-x-6' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

function CreateLibrary(): JSX.Element {
  const navigate = useNavigate();
  const create = useCreateLibrary();
  const { onHelp, helpOverlay } = useHelp('knowledge-library');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [nsfw, setNsfw] = useState(false);

  async function onCreate(): Promise<void> {
    const row = await create.mutateAsync({
      name: name.trim(),
      description: description.trim(),
      nsfw,
    });
    navigate(`/app/knowledge/${row.id}`);
  }

  return (
    <PageScaffold
      crumbs={[{ label: 'My Knowledge', to: '/app/knowledge' }, { label: 'New library' }]}
      back="/app/knowledge"
      onHelp={onHelp}
    >
      {helpOverlay}
      <div className="flex flex-col gap-4 px-4 pb-8 pt-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-paper-soft">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Worldbuilding"
            className="rounded-md border border-paper-soft/30 bg-white/5 px-3 py-2 text-sm text-paper"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-paper-soft">Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="rounded-md border border-paper-soft/30 bg-white/5 px-3 py-2 text-sm text-paper"
          />
        </label>
        <NsfwToggle on={nsfw} onToggle={() => setNsfw((v) => !v)} />
        <div>
          <Button
            tone="primary"
            onClick={() => void onCreate()}
            disabled={name.trim().length === 0}
          >
            Create library
          </Button>
        </div>
      </div>
    </PageScaffold>
  );
}

function EditLibrary(props: { libraryId: string }): JSX.Element {
  const navigate = useNavigate();
  const libraries = useLibraries();
  const update = useUpdateLibrary();
  const del = useDeleteLibrary();
  const class2 = useClass2Gate();
  const { onHelp, helpOverlay } = useHelp('knowledge-library');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const docs = useDocuments(props.libraryId);
  const addDocs = useAddDocuments(props.libraryId);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const existing: LibraryRow | undefined = libraries.data?.find((l) => l.id === props.libraryId);
  const documents: DocumentRow[] = docs.data ?? [];

  async function onUpload(files: FileList): Promise<void> {
    setUploadError(null);
    const { ok, failed } = await readTextFiles(files);
    if (ok.length > 0) await addDocs.mutateAsync(ok);
    if (failed.length > 0) {
      setUploadError(
        `Could not read: ${failed.join(', ')}. Only non-empty .md/.markdown/.txt files are supported.`,
      );
    }
  }

  async function onExportLibrary(): Promise<void> {
    if (!existing) return;
    try {
      const blob = await exportLibrary(existing.id);
      triggerDownload(blob, `${slug(existing.name)}-chatsundere.tar.gz`);
      toastStore.show({ message: 'Library exported', tone: 'success', durationMs: 3000 });
    } catch (e) {
      toastStore.show({
        message: e instanceof Error ? e.message : 'Export failed',
        tone: 'warn',
        durationMs: 3500,
      });
    }
  }

  if (libraries.isLoading) {
    return (
      <PageScaffold
        crumbs={[{ label: 'My Knowledge', to: '/app/knowledge' }, { label: '…' }]}
        back="/app/knowledge"
      >
        <p className="px-4 pt-2 text-sm text-paper-soft">Loading…</p>
      </PageScaffold>
    );
  }
  if (!existing) {
    return (
      <PageScaffold
        crumbs={[{ label: 'My Knowledge', to: '/app/knowledge' }, { label: 'Not found' }]}
        back="/app/knowledge"
      >
        <p className="px-4 pt-2 text-sm text-paper-soft">
          We can&apos;t find that library — it may have been deleted. Head back to My Knowledge.
        </p>
      </PageScaffold>
    );
  }

  return (
    <PageScaffold
      crumbs={[{ label: 'My Knowledge', to: '/app/knowledge' }, { label: existing.name }]}
      back="/app/knowledge"
      onHelp={onHelp}
    >
      {helpOverlay}
      <div className="flex flex-col gap-5 px-4 pb-8 pt-2">
        <div className="flex justify-end">
          <OverflowMenu
            items={[
              {
                label: 'Export',
                onSelect: () => {
                  void onExportLibrary();
                },
              },
              {
                label: 'Delete library',
                tone: 'destructive',
                onSelect: () => setConfirmDelete(true),
                disabled: class2.disabled,
                disabledReason: class2.tooltip ?? undefined,
              },
            ]}
          />
        </div>

        <InlineEditRow
          label="Name"
          value={existing.name}
          validate={(v) => (v.trim().length === 0 ? 'Name cannot be empty' : null)}
          onSave={(v) => update.mutateAsync({ id: existing.id, patch: { name: v.trim() } })}
        />
        <InlineEditTextarea
          label="Description"
          value={existing.description}
          minRows={2}
          onSave={(v) => update.mutateAsync({ id: existing.id, patch: { description: v.trim() } })}
        />
        <NsfwToggle
          on={existing.nsfw}
          onToggle={() =>
            void update.mutateAsync({ id: existing.id, patch: { nsfw: !existing.nsfw } })
          }
        />

        <ModelDownloadBanner />

        <input
          ref={uploadRef}
          type="file"
          multiple
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) void onUpload(e.target.files);
            e.target.value = '';
          }}
        />

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm text-paper">Documents</h2>
            <OverflowMenu
              triggerLabel="Add ▾"
              variant="labelled"
              items={[
                { label: 'Upload files', onSelect: () => uploadRef.current?.click() },
                {
                  label: 'New document',
                  onSelect: () => navigate(`/app/knowledge/${existing.id}/new`),
                },
              ]}
            />
          </div>
          {uploadError ? <p className="text-[11px] text-amber-300/80">{uploadError}</p> : null}
          {documents.length === 0 ? (
            <p className="text-sm text-paper-soft">
              No documents yet — add one by upload, or write a new one.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {documents.map((doc) => (
                <ListRow
                  key={doc.id}
                  title={doc.title}
                  trailing={
                    <Badge tone={STATUS_TONE[doc.embeddingStatus]}>
                      {STATUS_LABEL[doc.embeddingStatus]}
                    </Badge>
                  }
                  onOpen={() => navigate(`/app/knowledge/${existing.id}/${doc.id}`)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${existing.name}?`}
        body="The library and all its documents are removed. Personas lose access to its knowledge."
        confirmLabel="Delete"
        cancelLabel="Keep"
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          del.mutate(existing.id);
          navigate('/app/knowledge');
        }}
      />
    </PageScaffold>
  );
}
