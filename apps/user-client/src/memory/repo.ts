// SPDX-License-Identifier: AGPL-3.0-only
import { uuidv7 } from 'uuidv7';
import {
  type MemoryBodyRow,
  type MemoryBodySource,
  type MemoryJournalRow,
  type MemoryJournalState,
  getClientDataDb,
} from '../boot/client-data-db.js';
import { estimateTokens } from '../lib/token-estimator.js';
import { assembleMemoryContext } from './assembly.js';
import { MAX_BODY_VERSIONS, MEMORY_INJECTION_MAX_TOKENS } from './config.js';
import type { ExtractedEntry } from './extraction-parse.js';

/** Journal rows for a persona (optionally filtered by state), sorted oldest-first. */
export async function listJournal(
  personaId: string,
  state?: MemoryJournalState,
): Promise<MemoryJournalRow[]> {
  const db = getClientDataDb();
  const rows = state
    ? await db.memoryJournal.where('[personaId+state]').equals([personaId, state]).toArray()
    : await db.memoryJournal.where('personaId').equals(personaId).toArray();
  rows.sort((a, b) => a.createdAt - b.createdAt);
  return rows;
}

export async function countJournal(personaId: string, state: MemoryJournalState): Promise<number> {
  return getClientDataDb()
    .memoryJournal.where('[personaId+state]')
    .equals([personaId, state])
    .count();
}

export async function addJournalEntries(
  personaId: string,
  entries: ExtractedEntry[],
): Promise<MemoryJournalRow[]> {
  const now = Date.now();
  const rows: MemoryJournalRow[] = entries.map((e) => ({
    id: uuidv7(),
    personaId,
    content: e.content,
    category: e.category,
    state: 'uncommitted',
    isCorrection: e.isCorrection,
    createdAt: now,
    committedAt: null,
    autoCommitted: false,
    archivedByDreamId: null,
  }));
  if (rows.length) await getClientDataDb().memoryJournal.bulkAdd(rows);
  return rows;
}

/** Promote the oldest uncommitted entries to committed, keeping `keepRecent` pending. */
export async function commitOldestUncommitted(
  personaId: string,
  keepRecent: number,
): Promise<number> {
  const uncommitted = await listJournal(personaId, 'uncommitted'); // oldest-first
  const toCommit = uncommitted.slice(0, Math.max(0, uncommitted.length - keepRecent));
  if (!toCommit.length) return 0;
  const now = Date.now();
  await Promise.all(
    toCommit.map((r) =>
      getClientDataDb().memoryJournal.update(r.id, {
        state: 'committed',
        committedAt: now,
        autoCommitted: true,
      }),
    ),
  );
  return toCommit.length;
}

export async function archiveCommitted(personaId: string, dreamId: string): Promise<number> {
  const committed = await listJournal(personaId, 'committed');
  if (!committed.length) return 0;
  await Promise.all(
    committed.map((r) =>
      getClientDataDb().memoryJournal.update(r.id, {
        state: 'archived',
        archivedByDreamId: dreamId,
      }),
    ),
  );
  return committed.length;
}

export async function getCurrentBody(personaId: string): Promise<MemoryBodyRow | undefined> {
  const bodies = await getClientDataDb().memoryBody.where('personaId').equals(personaId).toArray();
  if (!bodies.length) return undefined;
  bodies.sort((a, b) => b.version - a.version);
  return bodies[0];
}

/** Write a new body version (auto-incremented) and prune to MAX_BODY_VERSIONS. */
export async function saveBody(
  personaId: string,
  content: string,
  entriesProcessed: number,
  source: MemoryBodySource,
): Promise<MemoryBodyRow> {
  const db = getClientDataDb();
  const current = await getCurrentBody(personaId);
  const row: MemoryBodyRow = {
    id: uuidv7(),
    personaId,
    content,
    tokenCount: estimateTokens(content),
    version: (current?.version ?? 0) + 1,
    entriesProcessed,
    createdAt: Date.now(),
    source,
  };
  await db.memoryBody.add(row);
  const all = await db.memoryBody.where('personaId').equals(personaId).toArray();
  if (all.length > MAX_BODY_VERSIONS) {
    all.sort((a, b) => b.version - a.version);
    await Promise.all(all.slice(MAX_BODY_VERSIONS).map((s) => db.memoryBody.delete(s.id)));
  }
  return row;
}

/**
 * User-message text newer than `afterId` (uuidv7 id comparison), oldest-first,
 * capped at `cap`. Returns the texts and the id of the newest message in the
 * batch (the new cursor), or the unchanged cursor when nothing qualifies.
 */
export async function getUnextractedUserText(
  chatId: string,
  afterId: string | null,
  cap: number,
): Promise<{ texts: string[]; newCursor: string | null }> {
  const db = getClientDataDb();
  const msgs = await db.messages.where('chatId').equals(chatId).toArray();
  const userMsgs = msgs
    .filter((m) => m.role === 'user' && m.streamingState === 'complete' && m.kind !== 'opener')
    .filter((m) => afterId == null || m.id > afterId)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!userMsgs.length) return { texts: [], newCursor: afterId };
  const batch = userMsgs.slice(0, cap);
  const texts = batch
    .map((m) =>
      m.contentBlocks
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('\n'),
    )
    .filter((t) => t.trim() !== '');
  const newCursor = batch.at(-1)?.id ?? afterId;
  return { texts, newCursor };
}

export async function advanceCursor(chatId: string, messageId: string): Promise<void> {
  await getClientDataDb().chats.update(chatId, { lastExtractedMessageId: messageId });
}

export async function commitEntry(id: string): Promise<void> {
  await getClientDataDb().memoryJournal.update(id, {
    state: 'committed',
    committedAt: Date.now(),
    autoCommitted: false,
  });
}

export async function rejectEntry(id: string): Promise<void> {
  await getClientDataDb().memoryJournal.delete(id);
}

export async function updateEntryContent(id: string, content: string): Promise<void> {
  await getClientDataDb().memoryJournal.update(id, { content });
}

/** All body versions for a persona, newest version first. */
export async function listBodyVersions(personaId: string): Promise<MemoryBodyRow[]> {
  const rows = await getClientDataDb().memoryBody.where('personaId').equals(personaId).toArray();
  rows.sort((a, b) => b.version - a.version);
  return rows;
}

/** Re-save the content of an existing version as a new newest version (manual). */
export async function rollbackBody(personaId: string, version: number): Promise<MemoryBodyRow> {
  const all = await listBodyVersions(personaId);
  const target = all.find((b) => b.version === version);
  if (!target)
    throw new Error(`rollbackBody: version ${version} not found for persona ${personaId}`);
  return saveBody(personaId, target.content, target.entriesProcessed, 'manual');
}

/** Count complete, non-opener user messages newer than the chat's extraction cursor. */
export async function countUnextractedUserMessages(chatId: string): Promise<number> {
  const db = getClientDataDb();
  const chat = await db.chats.get(chatId);
  const cursor = chat?.lastExtractedMessageId ?? null;
  const msgs = await db.messages.where('chatId').equals(chatId).toArray();
  return msgs.filter(
    (m) =>
      m.role === 'user' &&
      m.streamingState === 'complete' &&
      m.kind !== 'opener' &&
      (cursor == null || m.id > cursor),
  ).length;
}

/** Assemble the <usermemory> injection block for a persona (body + journal). */
export async function loadMemoryContext(personaId: string): Promise<string> {
  const [body, committed, uncommitted] = await Promise.all([
    getCurrentBody(personaId),
    listJournal(personaId, 'committed'),
    listJournal(personaId, 'uncommitted'),
  ]);
  return assembleMemoryContext({
    memoryBody: body?.content ?? '',
    committed: committed.map((c) => c.content),
    uncommitted: uncommitted.map((u) => u.content),
    maxTokens: MEMORY_INJECTION_MAX_TOKENS,
  });
}
