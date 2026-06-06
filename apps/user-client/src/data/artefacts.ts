// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { uuidv7 } from 'uuidv7';
import { type ArtefactRow, getClientDataDb } from '../boot/client-data-db.js';
import { QK } from './queryKeys.js';

/** Convert a human title into a URL/filename-safe slug. */
export function slugify(title: string): string {
  const s = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.length > 0 ? s : 'artefact';
}

export interface AddGeneratedArtefactInput {
  chatId: string;
  personaId: string;
  title: string;
  content: string;
}

/** Insert a new AI-generated HTML artefact and return its id. */
export async function addGeneratedArtefact(input: AddGeneratedArtefactInput): Promise<string> {
  const id = uuidv7();
  const now = Date.now();
  const row: ArtefactRow = {
    id,
    chatId: input.chatId,
    personaId: input.personaId,
    projectId: null,
    origin: 'generated',
    kind: 'text',
    format: 'html',
    title: input.title,
    fileName: `${slugify(input.title)}.html`,
    mime: 'text/html',
    content: input.content,
    tags: [],
    favourite: false,
    createdAt: now,
    updatedAt: now,
  };
  await getClientDataDb().artefacts.add(row);
  return id;
}

/** Update the title and/or fileName of an artefact. */
export async function renameArtefact(
  id: string,
  patch: { title?: string; fileName?: string },
): Promise<void> {
  const changes: Partial<ArtefactRow> = { updatedAt: Date.now() };
  if (patch.title !== undefined) changes.title = patch.title;
  if (patch.fileName !== undefined) changes.fileName = patch.fileName;
  await getClientDataDb().artefacts.update(id, changes);
}

/** Replace the full text content of an artefact. */
export async function updateArtefactContent(id: string, content: string): Promise<void> {
  await getClientDataDb().artefacts.update(id, { content, updatedAt: Date.now() });
}

/** Toggle the favourite flag on an artefact. */
export async function setArtefactFavourite(id: string, favourite: boolean): Promise<void> {
  await getClientDataDb().artefacts.update(id, { favourite, updatedAt: Date.now() });
}

/** Permanently delete an artefact by id. */
export async function deleteArtefact(id: string): Promise<void> {
  await getClientDataDb().artefacts.delete(id);
}

/** Count of artefacts a chat owns — for the delete-confirmation warning. */
export async function countChatArtefacts(chatId: string): Promise<number> {
  return getClientDataDb().artefacts.where('chatId').equals(chatId).count();
}

/**
 * Return all artefacts for a chat, newest first.
 * Ties in createdAt are broken by id descending (uuidv7 ids are time-monotonic),
 * so ordering is stable even when two rows share the same millisecond timestamp.
 */
export async function listChatArtefacts(chatId: string): Promise<ArtefactRow[]> {
  const rows = await getClientDataDb().artefacts.where('chatId').equals(chatId).toArray();
  return rows.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/** Fetch a single artefact by id. Returns undefined if not found. */
export async function getArtefact(id: string): Promise<ArtefactRow | undefined> {
  return getClientDataDb().artefacts.get(id);
}

// ---- React hooks ----

/** Query hook that reactively lists all artefacts for the given chat, newest first. */
export function useChatArtefacts(chatId: string) {
  return useQuery({ queryKey: QK.chatArtefacts(chatId), queryFn: () => listChatArtefacts(chatId) });
}

/**
 * Query hook that fetches only the artefact count for a chat.
 * Use in preference to `useChatArtefacts` when the full list is not needed,
 * e.g. the delete-confirmation warning in HistoryRow.
 */
export function useChatArtefactCount(chatId: string, enabled = true) {
  return useQuery({
    queryKey: [...QK.chatArtefacts(chatId), 'count'] as const,
    enabled,
    queryFn: () => countChatArtefacts(chatId),
  });
}

/** Query hook that reactively fetches a single artefact by id. Pass null to skip. */
export function useArtefact(id: string | null) {
  return useQuery({
    queryKey: QK.artefact(id ?? ''),
    enabled: id !== null,
    queryFn: () => (id ? getArtefact(id) : undefined),
  });
}

function useArtefactInvalidation(chatId: string) {
  const qc = useQueryClient();
  return (id?: string) => {
    void qc.invalidateQueries({ queryKey: QK.chatArtefacts(chatId) });
    if (id) void qc.invalidateQueries({ queryKey: QK.artefact(id) });
  };
}

/** Mutation hook that renames an artefact and invalidates the relevant queries. */
export function useRenameArtefact(chatId: string) {
  const invalidate = useArtefactInvalidation(chatId);
  return useMutation({
    mutationFn: (v: { id: string; patch: { title?: string; fileName?: string } }) =>
      renameArtefact(v.id, v.patch),
    onSuccess: (_r, v) => invalidate(v.id),
  });
}

/** Mutation hook that replaces artefact content and invalidates the relevant queries. */
export function useUpdateArtefactContent(chatId: string) {
  const invalidate = useArtefactInvalidation(chatId);
  return useMutation({
    mutationFn: (v: { id: string; content: string }) => updateArtefactContent(v.id, v.content),
    onSuccess: (_r, v) => invalidate(v.id),
  });
}

/** Mutation hook that toggles an artefact's favourite flag and invalidates the relevant queries. */
export function useSetArtefactFavourite(chatId: string) {
  const invalidate = useArtefactInvalidation(chatId);
  return useMutation({
    mutationFn: (v: { id: string; favourite: boolean }) => setArtefactFavourite(v.id, v.favourite),
    onSuccess: (_r, v) => invalidate(v.id),
  });
}

/** Mutation hook that deletes an artefact and invalidates the relevant queries. */
export function useDeleteArtefact(chatId: string) {
  const invalidate = useArtefactInvalidation(chatId);
  return useMutation({
    mutationFn: (id: string) => deleteArtefact(id),
    onSuccess: (_r, id) => invalidate(id),
  });
}
