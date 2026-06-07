// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Dexie from 'dexie';
import { uuidv7 } from 'uuidv7';
import { type DocumentRow, type LibraryRow, getClientDataDb } from '../boot/client-data-db.js';
import {
  KNOWLEDGE_COLLECTION,
  type VectorStoreLike,
  getKnowledgeVectorStore,
} from '../boot/knowledge-vectors-db.js';
import { enqueueDocument } from '../knowledge/start-ingestion.js';
import { QK } from './queryKeys.js';
import { useAdultMode } from './settings.js';

// ---- Libraries: plain async helpers (used by hooks + tests) ----

export async function listLibraries(): Promise<LibraryRow[]> {
  const rows = await getClientDataDb().libraries.toArray();
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

export async function createLibrary(
  input: Omit<LibraryRow, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<LibraryRow> {
  const now = Date.now();
  const row: LibraryRow = { id: uuidv7(), createdAt: now, updatedAt: now, ...input };
  await getClientDataDb().libraries.add(row);
  return row;
}

export async function updateLibrary(
  id: string,
  patch: Partial<Omit<LibraryRow, 'id' | 'createdAt'>>,
): Promise<void> {
  await getClientDataDb().libraries.update(id, { ...patch, updatedAt: Date.now() });
}

/** Delete every vector belonging to a document. */
export async function deleteDocumentVectors(
  documentId: string,
  store: VectorStoreLike = getKnowledgeVectorStore(),
): Promise<void> {
  await store.deleteWhere({
    collection: KNOWLEDGE_COLLECTION,
    filter: { tags: { documentId } },
  });
}

/** Delete a document row and its vectors. */
export async function deleteDocumentCascade(
  id: string,
  store: VectorStoreLike = getKnowledgeVectorStore(),
): Promise<void> {
  await deleteDocumentVectors(id, store);
  await getClientDataDb().documents.delete(id);
}

/** Delete a library, all its documents, and all their vectors. */
export async function deleteLibraryCascade(
  id: string,
  store: VectorStoreLike = getKnowledgeVectorStore(),
): Promise<void> {
  const db = getClientDataDb();
  const docs = await db.documents.where('libraryId').equals(id).toArray();
  for (const doc of docs) await deleteDocumentVectors(doc.id, store);
  await db.documents.where('libraryId').equals(id).delete();
  await db.libraries.delete(id);
}

// ---- Libraries: React-Query hooks ----

export function useLibraries() {
  return useQuery({ queryKey: QK.libraries, queryFn: listLibraries });
}

/**
 * Libraries filtered by the current adult-mode setting — the hook every list/
 * count surface must use (mirrors `useFilteredPersonas`). The empty state for an
 * all-NSFW list in SFW mode must render identically to "no libraries exist".
 */
export function useFilteredLibraries() {
  const libraries = useLibraries();
  const { mode } = useAdultMode();
  const data = libraries.data?.filter((l) => mode === 'nsfw' || !l.nsfw);
  return { ...libraries, data } as typeof libraries;
}

export function useCreateLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<LibraryRow, 'id' | 'createdAt' | 'updatedAt'>) => createLibrary(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.libraries }),
  });
}

export function useUpdateLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; patch: Partial<Omit<LibraryRow, 'id' | 'createdAt'>> }) =>
      updateLibrary(args.id, args.patch),
    onSuccess: (_v, args) => {
      qc.invalidateQueries({ queryKey: QK.libraries });
      qc.invalidateQueries({ queryKey: QK.library(args.id) });
    },
  });
}

export function useDeleteLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteLibraryCascade(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.libraries });
      qc.invalidateQueries({ queryKey: ['documents'] });
    },
  });
}

// ---- Documents ----

export async function listDocuments(libraryId: string): Promise<DocumentRow[]> {
  return getClientDataDb()
    .documents.where('[libraryId+createdAt]')
    .between([libraryId, Dexie.minKey], [libraryId, Dexie.maxKey])
    .toArray();
}

export async function getDocument(id: string): Promise<DocumentRow | undefined> {
  return getClientDataDb().documents.get(id);
}

/** Count documents per library, in one pass. */
export async function documentCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  await getClientDataDb().documents.each((d) => {
    counts[d.libraryId] = (counts[d.libraryId] ?? 0) + 1;
  });
  return counts;
}

export interface NewDocumentInput {
  title: string;
  content: string;
}

/** Insert non-empty documents as `pending` and enqueue each for embedding. */
export async function addDocuments(
  libraryId: string,
  inputs: NewDocumentInput[],
): Promise<string[]> {
  const now = Date.now();
  const rows: DocumentRow[] = [];
  for (const input of inputs) {
    if (input.content.trim().length === 0) continue;
    rows.push({
      id: uuidv7(),
      libraryId,
      title: input.title.trim() || 'Untitled',
      content: input.content,
      embeddingStatus: 'pending',
      embeddingError: null,
      chunkCount: 0,
      triggerPhrases: [],
      createdAt: now,
      updatedAt: now,
    });
  }
  if (rows.length === 0) return [];
  await getClientDataDb().documents.bulkAdd(rows);
  for (const row of rows) enqueueDocument(row.id);
  return rows.map((r) => r.id);
}

/** Update a document. A `content` change re-queues embedding; title-only does not. */
export async function updateDocument(
  id: string,
  patch: { title?: string; content?: string },
): Promise<void> {
  const db = getClientDataDb();
  const now = Date.now();
  if (patch.content !== undefined) {
    await db.documents.update(id, {
      ...patch,
      embeddingStatus: 'pending',
      embeddingError: null,
      updatedAt: now,
    });
    enqueueDocument(id);
  } else {
    await db.documents.update(id, { ...patch, updatedAt: now });
  }
}

// ---- Documents: React-Query hooks ----

function hasInFlight(docs: DocumentRow[] | undefined): boolean {
  return !!docs?.some((d) => d.embeddingStatus === 'pending' || d.embeddingStatus === 'embedding');
}

export function useDocuments(libraryId: string) {
  return useQuery({
    queryKey: QK.documents(libraryId),
    queryFn: () => listDocuments(libraryId),
    // Poll while anything is embedding so status badges update live.
    refetchInterval: (query) => (hasInFlight(query.state.data as DocumentRow[]) ? 800 : false),
  });
}

export function useDocumentCounts() {
  return useQuery({ queryKey: QK.documentCounts, queryFn: documentCounts });
}

export function useAddDocuments(libraryId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (inputs: NewDocumentInput[]) => addDocuments(libraryId, inputs),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.documents(libraryId) });
      qc.invalidateQueries({ queryKey: QK.documentCounts });
    },
  });
}

export function useUpdateDocument(libraryId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; patch: { title?: string; content?: string } }) =>
      updateDocument(args.id, args.patch),
    onSuccess: (_v, args) => {
      qc.invalidateQueries({ queryKey: QK.documents(libraryId) });
      qc.invalidateQueries({ queryKey: QK.document(args.id) });
    },
  });
}

export function useDeleteDocument(libraryId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteDocumentCascade(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.documents(libraryId) });
      qc.invalidateQueries({ queryKey: QK.documentCounts });
    },
  });
}

/** Manual retry for a failed document — reset to pending and re-enqueue. */
export function useRetryDocument(libraryId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await getClientDataDb().documents.update(id, {
        embeddingStatus: 'pending',
        embeddingError: null,
        updatedAt: Date.now(),
      });
      enqueueDocument(id);
    },
    onSuccess: (_v, id) => {
      qc.invalidateQueries({ queryKey: QK.documents(libraryId) });
      qc.invalidateQueries({ queryKey: QK.document(id) });
    },
  });
}
