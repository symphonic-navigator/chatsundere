// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { DocumentRow } from '../../../boot/client-data-db.js';
import { TagEditor } from '../../../components/artefact/TagEditor.js';
import { ModelDownloadBanner } from '../../../components/knowledge/ModelDownloadBanner.js';
import { Badge } from '../../../components/ui/Badge.js';
import { Button } from '../../../components/ui/Button.js';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog.js';
import { OverflowMenu } from '../../../components/ui/OverflowMenu.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { Pill } from '../../../components/ui/Pill.js';
import { useHelp } from '../../../content/help/use-help.js';
import {
  useAddDocuments,
  useDeleteDocument,
  useDocuments,
  useLibraries,
  useRetryDocument,
  useUpdateDocument,
} from '../../../data/knowledge.js';
import { STATUS_LABEL, STATUS_TONE } from '../../../lib/knowledge-status.js';
import { normalisePhrases } from '../../../lib/treasury-filter.js';

/** Outer shell — resolves loading / not-found states before rendering the form. */
export function KnowledgeDocumentPage(): JSX.Element {
  const { libraryId, documentId } = useParams();
  const docs = useDocuments(libraryId ?? '');

  if (docs.isLoading) {
    return (
      <PageScaffold
        crumbs={[{ label: 'My Knowledge', to: '/app/knowledge' }, { label: '…' }]}
        back={`/app/knowledge/${libraryId}`}
      >
        <p className="px-4 pt-2 text-sm text-paper-soft">Loading…</p>
      </PageScaffold>
    );
  }

  const all = docs.data ?? [];
  const existing = documentId ? all.find((d) => d.id === documentId) : undefined;

  if (documentId && documentId !== 'new' && !existing) {
    return (
      <PageScaffold
        crumbs={[{ label: 'My Knowledge', to: '/app/knowledge' }, { label: 'Not found' }]}
        back={`/app/knowledge/${libraryId}`}
      >
        <p className="px-4 pt-2 text-sm text-paper-soft">
          We can&apos;t find that document — it may have been deleted.
        </p>
      </PageScaffold>
    );
  }

  // Sibling phrases power TagEditor autocomplete suggestions.
  const suggestions = Array.from(
    new Set(all.filter((d) => d.id !== documentId).flatMap((d) => d.triggerPhrases)),
  );

  return (
    <DocumentForm
      key={existing?.id ?? 'new'}
      libraryId={libraryId ?? ''}
      existing={existing}
      suggestions={suggestions}
    />
  );
}

// ---- Inner form component ----

function DocumentForm(props: {
  libraryId: string;
  existing: DocumentRow | undefined;
  suggestions: string[];
}): JSX.Element {
  const { libraryId, existing, suggestions } = props;
  const navigate = useNavigate();
  const add = useAddDocuments(libraryId);
  const update = useUpdateDocument(libraryId);
  const del = useDeleteDocument(libraryId);
  const retry = useRetryDocument(libraryId);
  const { onHelp, helpOverlay } = useHelp('knowledge-document');
  const librariesQuery = useLibraries();
  const libraryName =
    librariesQuery.data?.find((l) => l.id === libraryId)?.name ??
    (librariesQuery.isLoading ? '…' : 'Library');

  const [title, setTitle] = useState(existing?.title ?? '');
  const [content, setContent] = useState(existing?.content ?? '');
  const [phrases, setPhrases] = useState<string[]>(existing?.triggerPhrases ?? []);
  const [companion, setCompanion] = useState(existing?.triggerOnCompanion ?? false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isCreate = existing === undefined;
  const companionDisabled = phrases.length === 0;
  const backTo = `/app/knowledge/${libraryId}`;

  function mark(): void {
    setDirty(true);
  }

  async function onSave(): Promise<void> {
    setSaveError(null);
    setSaving(true);
    // Companion flag must not persist when there are no trigger phrases.
    const effectiveCompanion = phrases.length > 0 ? companion : false;
    try {
      if (isCreate) {
        const ids = await add.mutateAsync([{ title: title.trim() || 'Untitled', content }]);
        const newId = ids[0];
        if (newId !== undefined && (phrases.length > 0 || effectiveCompanion)) {
          await update.mutateAsync({
            id: newId,
            patch: { triggerPhrases: phrases, triggerOnCompanion: effectiveCompanion },
          });
        }
      } else {
        const patch: {
          title?: string;
          content?: string;
          triggerPhrases?: string[];
          triggerOnCompanion?: boolean;
        } = {
          title: title.trim() || 'Untitled',
          triggerPhrases: phrases,
          triggerOnCompanion: effectiveCompanion,
        };
        // Include content ONLY when it actually changed — content presence triggers re-embed.
        if (content !== existing.content) patch.content = content;
        await update.mutateAsync({ id: existing.id, patch });
      }
      setDirty(false);
      navigate(backTo);
    } catch {
      setSaveError('Could not save — your changes are kept. Try again.');
    } finally {
      setSaving(false);
    }
  }

  const crumbLabel = isCreate ? 'New document' : existing.title;

  return (
    <PageScaffold
      crumbs={[
        { label: 'My Knowledge', to: '/app/knowledge' },
        { label: libraryName, to: backTo },
        { label: crumbLabel },
      ]}
      back={backTo}
      onHelp={onHelp}
      dirty={dirty}
    >
      {helpOverlay}
      <div className="flex flex-col gap-5 px-4 pb-8 pt-2">
        {/* Status row + overflow */}
        <div className="flex items-center justify-between gap-2">
          {existing ? (
            <span className="flex items-center gap-2">
              <Badge tone={STATUS_TONE[existing.embeddingStatus]}>
                {STATUS_LABEL[existing.embeddingStatus]}
              </Badge>
              {dirty ? <Badge tone="warning">● Unsaved</Badge> : null}
            </span>
          ) : (
            <span>{dirty ? <Badge tone="warning">● Unsaved</Badge> : null}</span>
          )}
          {existing ? (
            <OverflowMenu
              items={[
                {
                  label: 'Delete document',
                  tone: 'destructive',
                  onSelect: () => setConfirmDelete(true),
                },
              ]}
            />
          ) : null}
        </div>

        {/* Failure banner with Retry */}
        {existing?.embeddingStatus === 'failed' ? (
          <div className="flex flex-col gap-2 rounded-md border border-amber-400/30 bg-amber-400/5 p-3">
            <p className="text-[12px] text-amber-200/90">
              Indexing failed: {existing.embeddingError ?? 'unknown error'}
            </p>
            <div>
              <Pill variant="add" onClick={() => retry.mutate(existing.id)}>
                Retry
              </Pill>
            </div>
          </div>
        ) : null}

        <ModelDownloadBanner />

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-paper-soft">Title</span>
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              mark();
            }}
            placeholder="Untitled"
            className="rounded-md border border-paper-soft/30 bg-white/5 px-3 py-2 text-sm text-paper"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-paper-soft">Content</span>
          <textarea
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              mark();
            }}
            rows={12}
            className="rounded-md border border-paper-soft/30 bg-white/5 px-3 py-2 text-sm text-paper"
          />
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-wider text-paper-soft">
            Trigger phrases
          </span>
          <TagEditor
            mode="edit"
            value={phrases}
            suggestions={suggestions}
            onChange={(next) => {
              setPhrases(next);
              mark();
            }}
            normalise={normalisePhrases}
          />
        </div>

        {/* Companion toggle */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm text-paper">Let the companion trigger this too</div>
            {companionDisabled ? (
              <p className="text-[11px] text-paper-soft">Add a trigger phrase first.</p>
            ) : (
              <p className="text-[11px] text-paper-soft">
                The companion may surface this note when a phrase matches.
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Let the companion trigger this too"
            aria-pressed={companion}
            disabled={companionDisabled}
            aria-disabled={companionDisabled}
            onClick={() => {
              if (!companionDisabled) {
                setCompanion((v) => !v);
                mark();
              }
            }}
            className={`h-6 w-12 shrink-0 rounded-full border ${
              companion ? 'border-paper bg-paper/30' : 'border-paper-soft/30 bg-white/5'
            } ${companionDisabled ? 'opacity-40' : ''}`}
          >
            <span
              className={`block h-5 w-5 rounded-full bg-paper transition-transform ${
                companion ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        <div>
          <Button
            tone="primary"
            onClick={() => void onSave()}
            disabled={saving || (isCreate ? content.trim().length === 0 : !dirty)}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
          {saveError ? <p className="mt-2 text-[11px] text-amber-300/80">{saveError}</p> : null}
        </div>
      </div>

      {existing ? (
        <ConfirmDialog
          open={confirmDelete}
          title={`Delete ${existing.title}?`}
          body="This document is removed from the library."
          confirmLabel="Delete"
          cancelLabel="Keep"
          destructive
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            del.mutate(existing.id);
            navigate(backTo);
          }}
        />
      ) : null}
    </PageScaffold>
  );
}
