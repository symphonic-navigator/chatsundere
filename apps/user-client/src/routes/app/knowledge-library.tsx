// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AddDocumentMenu } from '../../components/knowledge/AddDocumentMenu.js';
import { DocumentEditor } from '../../components/knowledge/DocumentEditor.js';
import { DocumentStatusBadge } from '../../components/knowledge/DocumentStatusBadge.js';
import { ModelDownloadBanner } from '../../components/knowledge/ModelDownloadBanner.js';
import { LibrarySheet } from '../../components/knowledge/NewLibrarySheet.js';
import {
  useAddDocuments,
  useDeleteDocument,
  useDeleteLibrary,
  useDocuments,
  useLibraries,
  useRetryDocument,
  useUpdateLibrary,
} from '../../data/knowledge.js';

/** Library detail — level 2 of the My Knowledge room. */
export function KnowledgeLibrary(): JSX.Element {
  const { libraryId = '' } = useParams();
  const navigate = useNavigate();
  const libraries = useLibraries();
  const documents = useDocuments(libraryId);
  const addDocuments = useAddDocuments(libraryId);
  const retryDocument = useRetryDocument(libraryId);
  const deleteDocument = useDeleteDocument(libraryId);
  const updateLibrary = useUpdateLibrary();
  const deleteLibrary = useDeleteLibrary();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSheetOpen, setEditSheetOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const library = libraries.data?.find((l) => l.id === libraryId);
  const docs = documents.data ?? [];

  return (
    <section className="flex min-h-[80dvh] flex-col gap-4 px-4 pb-12 pt-6">
      <header className="flex items-center justify-between">
        <button type="button" className="knowledge-back" onClick={() => navigate('/app/knowledge')}>
          ← My Knowledge
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            className="knowledge-new-btn"
            onClick={() => setEditSheetOpen(true)}
          >
            Edit
          </button>
          <button
            type="button"
            className="knowledge-new-btn"
            onClick={() => setDeleteConfirmOpen(true)}
          >
            Delete
          </button>
        </div>
      </header>
      <h1 className="font-display text-2xl">{library?.name ?? 'Library'}</h1>

      {deleteConfirmOpen ? (
        <div className="flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
          <span className="text-sm">Delete this library?</span>
          <button
            type="button"
            className="knowledge-new-btn"
            onClick={() => {
              deleteLibrary.mutate(libraryId, {
                onSuccess: () => navigate('/app/knowledge'),
              });
            }}
          >
            Delete
          </button>
          <button
            type="button"
            className="knowledge-new-btn"
            onClick={() => setDeleteConfirmOpen(false)}
          >
            Cancel
          </button>
        </div>
      ) : null}

      <ModelDownloadBanner />
      <AddDocumentMenu onAdd={(d) => addDocuments.mutate(d)} />

      {docs.length === 0 ? (
        <p className="text-paper-soft">No documents yet — add one by upload or paste.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {docs.map((doc) => (
            <li key={doc.id} className="knowledge-document-row">
              <button
                type="button"
                className="flex-1 text-left"
                onClick={() => setEditingId(doc.id)}
              >
                {doc.title}
              </button>
              <DocumentStatusBadge
                status={doc.embeddingStatus}
                onRetry={() => retryDocument.mutate(doc.id)}
              />
              <button
                type="button"
                aria-label={`Delete ${doc.title}`}
                onClick={() => deleteDocument.mutate(doc.id)}
              >
                🗑
              </button>
            </li>
          ))}
        </ul>
      )}

      {editingId ? (
        <DocumentEditor
          libraryId={libraryId}
          documentId={editingId}
          onClose={() => setEditingId(null)}
        />
      ) : null}

      {editSheetOpen && library ? (
        <LibrarySheet
          title="Edit library"
          submitLabel="Save"
          initial={{ name: library.name, description: library.description, nsfw: library.nsfw }}
          onClose={() => setEditSheetOpen(false)}
          onSubmit={(v) => {
            updateLibrary.mutate({ id: libraryId, patch: v });
            setEditSheetOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}
