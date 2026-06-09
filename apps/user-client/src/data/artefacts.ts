// SPDX-License-Identifier: AGPL-3.0-only
import type { ImageModelConfig } from '@chatsundere/llm-unified';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { uuidv7 } from 'uuidv7';
import { type ArtefactRow, getClientDataDb } from '../boot/client-data-db.js';
import { fenceToArtefactMeta } from '../lib/fence-to-artefact.js';
import { normaliseTags } from '../lib/treasury-filter.js';
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

/** Title = the prompt's first five words (renameable later, like every artefact). */
export function titleFromPrompt(prompt: string): string {
  const words = prompt.trim().split(/\s+/).slice(0, 5).join(' ');
  return words.length > 0 ? words : 'Generated image';
}

function extensionForMime(mime: string): string {
  return mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
}

export interface AddGeneratedImageArtefactInput {
  chatId: string;
  personaId: string;
  prompt: string;
  modelRef: string;
  modelLabel: string;
  configSnapshot: ImageModelConfig;
  bytes: Blob;
  mime: string;
  thumbBlob: Blob;
  width: number;
  height: number;
}

/** Insert one generated image as a kind:'image' artefact and return its id. */
export async function addGeneratedImageArtefact(
  input: AddGeneratedImageArtefactInput,
): Promise<string> {
  const id = uuidv7();
  const now = Date.now();
  const title = titleFromPrompt(input.prompt);
  const row: ArtefactRow = {
    id,
    chatId: input.chatId,
    personaId: input.personaId,
    projectId: null,
    origin: 'generated',
    kind: 'image',
    format: 'image',
    title,
    fileName: `${slugify(title)}.${extensionForMime(input.mime)}`,
    mime: input.mime,
    content: '',
    tags: [],
    favourite: false,
    createdAt: now,
    updatedAt: now,
    blob: input.bytes,
    thumbBlob: input.thumbBlob,
    width: input.width,
    height: input.height,
    genMeta: {
      prompt: input.prompt,
      modelRef: input.modelRef,
      modelLabel: input.modelLabel,
      configSnapshot: input.configSnapshot,
    },
  };
  await getClientDataDb().artefacts.add(row);
  return id;
}

export interface AddSavedMessageArtefactInput {
  chatId: string;
  personaId: string;
  title: string;
  /** Concatenated visible message text (markdown). */
  content: string;
}

/** Save a message's visible text as a Markdown artefact. Returns its id. */
export async function addSavedMessageArtefact(
  input: AddSavedMessageArtefactInput,
): Promise<string> {
  const id = uuidv7();
  const now = Date.now();
  const row: ArtefactRow = {
    id,
    chatId: input.chatId,
    personaId: input.personaId,
    projectId: null,
    origin: 'saved-message',
    kind: 'text',
    format: 'markdown',
    title: input.title,
    fileName: `${slugify(input.title)}.md`,
    mime: 'text/markdown',
    content: input.content,
    tags: [],
    favourite: false,
    createdAt: now,
    updatedAt: now,
  };
  await getClientDataDb().artefacts.add(row);
  return id;
}

export interface AddSavedCodeBlockArtefactInput {
  chatId: string;
  personaId: string;
  title: string;
  content: string;
  /** Fence language token, e.g. 'python', 'html', 'mermaid'. */
  lang: string;
}

/** Save a fenced code block (or Mermaid diagram) as an artefact whose
 *  format/MIME/extension derive from the fence language. Returns its id. */
export async function addSavedCodeBlockArtefact(
  input: AddSavedCodeBlockArtefactInput,
): Promise<string> {
  const id = uuidv7();
  const now = Date.now();
  const meta = fenceToArtefactMeta(input.lang);
  const row: ArtefactRow = {
    id,
    chatId: input.chatId,
    personaId: input.personaId,
    projectId: null,
    origin: 'saved-code-block',
    kind: 'text',
    format: meta.format,
    title: input.title,
    fileName: `${slugify(input.title)}.${meta.ext}`,
    mime: meta.mime,
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

/** Return every artefact across all chats, newest first (id tiebreaker). */
export async function listAllArtefacts(): Promise<ArtefactRow[]> {
  const rows = await getClientDataDb().artefacts.toArray();
  return rows.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/** Total artefact count across all chats — for the Entrance-Hall tile. */
export async function countAllArtefacts(): Promise<number> {
  return getClientDataDb().artefacts.count();
}

/** Replace an artefact's tags with a normalised set. */
export async function setArtefactTags(id: string, tags: string[]): Promise<void> {
  await getClientDataDb().artefacts.update(id, {
    tags: normaliseTags(tags),
    updatedAt: Date.now(),
  });
}

/** Union `tags` into each listed artefact's existing tags (normalised, no dupes). */
export async function addTagsToArtefacts(ids: string[], tags: string[]): Promise<void> {
  const add = normaliseTags(tags);
  if (ids.length === 0 || add.length === 0) return;
  const db = getClientDataDb();
  const now = Date.now();
  await db.transaction('rw', db.artefacts, async () => {
    for (const id of ids) {
      const row = await db.artefacts.get(id);
      if (!row) continue;
      await db.artefacts.update(id, { tags: normaliseTags([...row.tags, ...add]), updatedAt: now });
    }
  });
}

/** Delete many artefacts at once. */
export async function deleteArtefacts(ids: string[]): Promise<void> {
  await getClientDataDb().artefacts.bulkDelete(ids);
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
    // Also refresh global artefact surfaces (Treasury list/count) so chat-pill
    // rename/edit/delete/favourite stay consistent across the whole UI.
    void qc.invalidateQueries({ queryKey: ['artefacts'] });
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

// Create hooks invalidate the chat + global lists but pass no id: the artefact
// did not exist before, so there is no prior QK.artefact(id) query to refresh.
/** Mutation hook: save a message's text as a Markdown artefact. */
export function useSaveMessageArtefact(chatId: string) {
  const invalidate = useArtefactInvalidation(chatId);
  return useMutation({
    mutationFn: (v: { personaId: string; title: string; content: string }) =>
      addSavedMessageArtefact({ chatId, ...v }),
    onSuccess: () => invalidate(),
  });
}

/** Mutation hook: save a fenced code block (or Mermaid) as an artefact. */
export function useSaveCodeBlockArtefact(chatId: string) {
  const invalidate = useArtefactInvalidation(chatId);
  return useMutation({
    mutationFn: (v: { personaId: string; title: string; content: string; lang: string }) =>
      addSavedCodeBlockArtefact({ chatId, ...v }),
    onSuccess: () => invalidate(),
  });
}

/** Query hook listing all artefacts across chats, newest first. */
export function useAllArtefacts() {
  return useQuery({ queryKey: QK.allArtefacts, queryFn: listAllArtefacts });
}

/** Query hook for the global artefact count (Entrance-Hall tile). */
export function useAllArtefactCount() {
  return useQuery({ queryKey: [...QK.allArtefacts, 'count'] as const, queryFn: countAllArtefacts });
}

function useArtefactPrefixInvalidation() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ['artefacts'] });
}

/** Mutation: replace one artefact's tags. Invalidates all artefact queries. */
export function useSetArtefactTags() {
  const invalidate = useArtefactPrefixInvalidation();
  return useMutation({
    mutationFn: (v: { id: string; tags: string[] }) => setArtefactTags(v.id, v.tags),
    onSuccess: invalidate,
  });
}

/** Mutation: bulk-add tags to many artefacts. Invalidates all artefact queries. */
export function useAddTagsToArtefacts() {
  const invalidate = useArtefactPrefixInvalidation();
  return useMutation({
    mutationFn: (v: { ids: string[]; tags: string[] }) => addTagsToArtefacts(v.ids, v.tags),
    onSuccess: invalidate,
  });
}

/** Mutation: bulk-delete artefacts. Invalidates all artefact queries. */
export function useDeleteArtefacts() {
  const invalidate = useArtefactPrefixInvalidation();
  return useMutation({
    mutationFn: (ids: string[]) => deleteArtefacts(ids),
    onSuccess: invalidate,
  });
}

// ---- Cross-chat variants of the existing chat-scoped mutations ----
// The Treasury operates over artefacts from many chats at once, so these wrap
// the existing single-artefact functions but invalidate the whole `['artefacts']`
// prefix instead of one chat's query.

/** Favourite toggle for cross-chat surfaces (Treasury). */
export function useSetArtefactFavouriteGlobal() {
  const invalidate = useArtefactPrefixInvalidation();
  return useMutation({
    mutationFn: (v: { id: string; favourite: boolean }) => setArtefactFavourite(v.id, v.favourite),
    onSuccess: invalidate,
  });
}

/** Rename for cross-chat surfaces (Treasury lightbox). */
export function useRenameArtefactGlobal() {
  const invalidate = useArtefactPrefixInvalidation();
  return useMutation({
    mutationFn: (v: { id: string; patch: { title?: string; fileName?: string } }) =>
      renameArtefact(v.id, v.patch),
    onSuccess: invalidate,
  });
}

/** Content-edit for cross-chat surfaces (Treasury lightbox). */
export function useUpdateArtefactContentGlobal() {
  const invalidate = useArtefactPrefixInvalidation();
  return useMutation({
    mutationFn: (v: { id: string; content: string }) => updateArtefactContent(v.id, v.content),
    onSuccess: invalidate,
  });
}
