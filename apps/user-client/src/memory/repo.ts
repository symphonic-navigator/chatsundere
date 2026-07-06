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
import { enqueueSync, isLinkedForSync, mutateSynced } from '../sync/enqueue.js';
import { isClass2Allowed } from '../sync/gate.js';
import { scheduleClass1Sync } from '../sync/triggers.js';
import { snapshotRowIntoTrash } from '../trash/snapshot.js';
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
  if (rows.length) {
    const db = getClientDataDb();
    const linked = isLinkedForSync();
    // Class-1 append: journal rows + their outbox rows commit atomically.
    await db.transaction('rw', [db.memoryJournal, db.syncOutbox], async (tx) => {
      await db.memoryJournal.bulkAdd(rows);
      if (linked) for (const r of rows) enqueueSync(tx, 'memoryJournal', r.id, 'upsert');
    });
    if (linked) scheduleClass1Sync();
  }
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
  const db = getClientDataDb();
  // Class-2-by-background-job journal transition (spec §5): offline-defer — the
  // enqueue only runs when a Class-2 write is currently allowed, so the auto-commit
  // never breaks the memory pipeline while the sync server is unreachable. When it
  // does sync, `memoryJournal` resolves by state precedence (§7.5).
  const linked = isClass2Allowed();
  await db.transaction('rw', [db.memoryJournal, db.syncOutbox], async (tx) => {
    for (const r of toCommit) {
      await db.memoryJournal.update(r.id, {
        state: 'committed',
        committedAt: now,
        autoCommitted: true,
      });
      if (linked) enqueueSync(tx, 'memoryJournal', r.id, 'upsert');
    }
  });
  if (linked) scheduleClass1Sync();
  return toCommit.length;
}

export async function archiveCommitted(personaId: string, dreamId: string): Promise<number> {
  const committed = await listJournal(personaId, 'committed');
  if (!committed.length) return 0;
  const db = getClientDataDb();
  // Class-2-by-background-job journal transition (spec §5): offline-defer, same
  // shape as the auto-commit above — coupled to the dream's `memoryBody` save.
  const linked = isClass2Allowed();
  await db.transaction('rw', [db.memoryJournal, db.syncOutbox], async (tx) => {
    for (const r of committed) {
      await db.memoryJournal.update(r.id, {
        state: 'archived',
        archivedByDreamId: dreamId,
      });
      if (linked) enqueueSync(tx, 'memoryJournal', r.id, 'upsert');
    }
  });
  if (linked) scheduleClass1Sync();
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
  const existing = await db.memoryBody.where('personaId').equals(personaId).toArray();
  const current = existing.reduce<MemoryBodyRow | undefined>(
    (acc, b) => (acc === undefined || b.version > acc.version ? b : acc),
    undefined,
  );
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
  // Prune-to-MAX after the add: the freshest row (highest version) is never
  // pruned, so it is always retained and its outbox `upsert` is meaningful.
  const pruneIds = [...existing, row]
    .sort((a, b) => b.version - a.version)
    .slice(MAX_BODY_VERSIONS)
    .map((s) => s.id);

  // memoryBody creation is the spec §5 Class-2 exception, coupled to the dream's
  // journal transitions above. Both the dream (background) and the manual editor
  // reach here, so it OFFLINE-DEFERS: the body persists locally regardless, and
  // enqueues (new version → upsert; pruned versions → delete tombstones) only
  // when a Class-2 write is currently allowed. CAS + re-dream converge the rest.
  const linked = isClass2Allowed();
  await db.transaction('rw', [db.memoryBody, db.syncOutbox], async (tx) => {
    await db.memoryBody.add(row);
    if (pruneIds.length > 0) await db.memoryBody.bulkDelete(pruneIds);
    if (linked) {
      enqueueSync(tx, 'memoryBody', row.id, 'upsert');
      for (const id of pruneIds) enqueueSync(tx, 'memoryBody', id, 'delete');
    }
  });
  if (linked) scheduleClass1Sync();
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
  // `lastExtractedMessageId` is a synced chat field advanced by the background
  // extraction job (spec §5, Class-2-by-background-job). Offline-defer so the
  // pipeline never loses the cursor when the sync server is unreachable; the
  // `updatedAt` bump lets the advance propagate under LWW, and CAS converges it
  // (worst case another device re-extracts, which the dedup pass tolerates).
  await mutateSynced({
    collection: 'chats',
    key: chatId,
    tables: ['chats'],
    deferWhenOffline: true,
    write: async (tx) => {
      await tx
        .table('chats')
        .update(chatId, { lastExtractedMessageId: messageId, updatedAt: Date.now() });
    },
  });
}

/** Manually commit one journal entry (user action in the Memory screen). Class-2 edit. */
export async function commitEntry(id: string): Promise<void> {
  await mutateSynced({
    collection: 'memoryJournal',
    key: id,
    tables: ['memoryJournal'],
    write: async (tx) => {
      await tx.table('memoryJournal').update(id, {
        state: 'committed',
        committedAt: Date.now(),
        autoCommitted: false,
      });
    },
  });
}

/** Reject (delete) one journal entry (user action). Class-2 delete. `opts.intoTrash`
 *  (default off → current behaviour byte-identical) snapshots the entry into
 *  `db.trash` before the row goes (§3.4). */
export async function rejectEntry(id: string, opts?: { intoTrash?: boolean }): Promise<void> {
  const entry = opts?.intoTrash ? await getClientDataDb().memoryJournal.get(id) : undefined;
  await mutateSynced({
    collection: 'memoryJournal',
    key: id,
    op: 'delete',
    tables: opts?.intoTrash ? ['memoryJournal', 'trash'] : ['memoryJournal'],
    write: async (tx) => {
      if (opts?.intoTrash && entry)
        await snapshotRowIntoTrash(tx, Date.now(), 'memoryJournal', id, entry);
      await tx.table('memoryJournal').delete(id);
    },
  });
}

/** Edit one journal entry's content (user action). Class-2 edit. */
export async function updateEntryContent(id: string, content: string): Promise<void> {
  await mutateSynced({
    collection: 'memoryJournal',
    key: id,
    tables: ['memoryJournal'],
    write: async (tx) => {
      await tx.table('memoryJournal').update(id, { content });
    },
  });
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
