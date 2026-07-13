// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { useAccountLinkStore, useConnectivityStore, useSessionStore } from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ChatRow,
  DocumentRow,
  LibraryRow,
  MemoryJournalRow,
  MessageRow,
  SeedTemplateRow,
  SyncOutboxRow,
} from '../../src/boot/client-data-db.js';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import type { VectorStoreLike } from '../../src/boot/knowledge-vectors-db.js';
import { setBookmarkLabel } from '../../src/data/bookmarks.js';
import { deleteChatCascade, setChatLibraries } from '../../src/data/chats.js';
import {
  deleteDocumentCascade,
  deleteLibraryCascade,
  updateDocument,
  updateLibrary,
} from '../../src/data/knowledge.js';
import {
  createSeedTemplate,
  deleteSeedTemplate,
  updateSeedTemplate,
} from '../../src/data/seed-templates.js';
import { advanceCursor, rejectEntry, saveBody } from '../../src/memory/repo.js';
import { SyncOfflineError, setImmediateDrain } from '../../src/sync/enqueue.js';
import { _resetTriggersForTests, _setTriggerCycle } from '../../src/sync/triggers.js';

// ── Store helpers ────────────────────────────────────────────────────────────

/** Linked + reachable + unlocked → Class-2 writes are allowed (isClass2Allowed). */
function setOnline(): void {
  useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
  useConnectivityStore.setState({ state: { kind: 'linked_online' } });
  useSessionStore.setState({ mk: { key: 'fake-mk' } as never });
}
/** Linked but unreachable → Class-2 writes are disallowed (offline). */
function setOffline(): void {
  useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
  useConnectivityStore.setState({ state: { kind: 'server_unreachable' } });
  useSessionStore.setState({ mk: { key: 'fake-mk' } as never });
}
function setLocalOnly(): void {
  useAccountLinkStore.setState({ linkStatus: 'local-only', baseUrl: null });
  useSessionStore.setState({ mk: null });
}

async function outbox(): Promise<SyncOutboxRow[]> {
  return getClientDataDb().syncOutbox.toArray();
}
function stamps(rows: SyncOutboxRow[]): string[] {
  return rows.map((r) => `${r.collection}:${r.key}:${r.op}`).sort();
}

// ── Row seeders (minimal shapes) ─────────────────────────────────────────────

async function seedChat(id: string): Promise<void> {
  await getClientDataDb().chats.add({
    id,
    personaId: 'p1',
    title: null,
    resolvedMindspaceId: 'ms-1',
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
    bookmarkedMessageCount: 0,
    draftInput: '',
    libraryIds: [],
  } as unknown as ChatRow);
}
async function seedMessage(id: string, chatId: string): Promise<void> {
  await getClientDataDb().messages.add({
    id,
    chatId,
    role: 'user',
    contentBlocks: [{ type: 'text', text: 'hi' }],
    createdAt: 1,
    updatedAt: 1,
    bookmarked: false,
    kind: 'normal',
    streamingState: 'complete',
  } as unknown as MessageRow);
}
async function seedLibrary(id: string): Promise<void> {
  await getClientDataDb().libraries.add({
    id,
    name: 'L',
    description: '',
    nsfw: false,
    createdAt: 1,
    updatedAt: 1,
  } as unknown as LibraryRow);
}
async function seedDocument(id: string, libraryId: string): Promise<void> {
  await getClientDataDb().documents.add({
    id,
    libraryId,
    title: 'D',
    content: 'body',
    embeddingStatus: 'embedded',
    embeddingError: null,
    chunkCount: 0,
    triggerPhrases: [],
    createdAt: 1,
    updatedAt: 1,
  } as unknown as DocumentRow);
}
async function seedSeedTemplate(id: string): Promise<void> {
  await getClientDataDb().seedTemplates.add({
    id,
    name: 'T',
    description: '',
    nsfw: false,
    greeting: null,
    body: [],
    createdAt: 1,
    updatedAt: 1,
  } as unknown as SeedTemplateRow);
}
async function seedJournal(id: string): Promise<void> {
  await getClientDataDb().memoryJournal.add({
    id,
    personaId: 'p1',
    content: 'a fact',
    category: null,
    state: 'uncommitted',
    isCorrection: false,
    createdAt: 1,
    committedAt: null,
    autoCommitted: false,
    archivedByDreamId: null,
  } as unknown as MemoryJournalRow);
}

/** A no-op vector store so knowledge cascades never touch the embeddings DB.
 *  `scan` yields no chunks, so a cascade carries no `vectors` tombstones. */
const noopStore = {
  scan: async () => [],
  deleteWhere: async () => undefined,
} as unknown as VectorStoreLike;

/**
 * A vector store stub whose `scan` returns fake chunk rows per document. Each id
 * is a real `vectors` sync key (`` `${documentId}#${chunkIndex}` ``,
 * `sync-keys.ts`) — a `VectorRow`'s primary key IS its sync key — so a cascade
 * tombstone lands on exactly the blind id the push path would upsert.
 */
function vectorStoreWith(chunksByDoc: Record<string, string[]>): VectorStoreLike {
  return {
    scan: async (req: { filter?: { tags?: { documentId?: string } } }) => {
      const docId = req.filter?.tags?.documentId;
      const ids = docId ? (chunksByDoc[docId] ?? []) : Object.values(chunksByDoc).flat();
      return ids.map((id) => ({ id }));
    },
    deleteWhere: async () => undefined,
  } as unknown as VectorStoreLike;
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  _setTriggerCycle(async () => undefined);
  setImmediateDrain(async () => undefined); // drain is a no-op; we assert the outbox
});

afterEach(async () => {
  _resetTriggersForTests();
  setImmediateDrain(async () => undefined);
  await _resetClientDataDbForTests();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ mk: null });
});

// ── Online: edits and deletes enqueue the right op ───────────────────────────

describe('Class-2 write sites — online mutation round-trips', () => {
  it('a chat rename (title) enqueues a chats upsert', async () => {
    setOnline();
    await seedChat('c1');
    await setChatLibraries('c1', ['lib-x']);
    expect(stamps(await outbox())).toEqual(['chats:c1:upsert']);
  });

  it('a bookmark-label edit enqueues a messages upsert', async () => {
    setOnline();
    await seedMessage('m1', 'c1');
    await setBookmarkLabel({ messageId: 'm1', label: 'star' });
    expect(stamps(await outbox())).toEqual(['messages:m1:upsert']);
  });

  it('a document edit enqueues a documents upsert; a delete enqueues a delete op', async () => {
    setOnline();
    await seedLibrary('l1');
    await seedDocument('d1', 'l1');
    await updateDocument('d1', { title: 'renamed' });
    expect(stamps(await outbox())).toEqual(['documents:d1:upsert']);

    await getClientDataDb().syncOutbox.clear();
    await deleteDocumentCascade('d1', noopStore);
    expect(stamps(await outbox())).toEqual(['documents:d1:delete']);
  });

  it('a seed-template edit upserts; a delete enqueues a delete op', async () => {
    setOnline();
    await seedSeedTemplate('s1');
    await updateSeedTemplate('s1', { name: 'renamed' });
    expect(stamps(await outbox())).toEqual(['seedTemplates:s1:upsert']);

    await getClientDataDb().syncOutbox.clear();
    await deleteSeedTemplate('s1');
    expect(stamps(await outbox())).toEqual(['seedTemplates:s1:delete']);
  });

  it('a library edit upserts', async () => {
    setOnline();
    await seedLibrary('l1');
    await updateLibrary('l1', { name: 'renamed' });
    expect(stamps(await outbox())).toEqual(['libraries:l1:upsert']);
  });

  it('rejecting a journal entry enqueues a memoryJournal delete', async () => {
    setOnline();
    await seedJournal('j1');
    await rejectEntry('j1');
    expect(stamps(await outbox())).toEqual(['memoryJournal:j1:delete']);
    expect(await getClientDataDb().memoryJournal.get('j1')).toBeUndefined();
  });

  it('awaits the immediate drain after the atomic write+enqueue', async () => {
    setOnline();
    await seedLibrary('l1');
    const drain = vi.fn(async () => undefined);
    setImmediateDrain(drain);
    await updateLibrary('l1', { name: 'renamed' });
    expect(drain).toHaveBeenCalledTimes(1);
    expect(drain).toHaveBeenCalledWith({ collection: 'libraries', key: 'l1' });
  });
});

// ── Cascade deletes tombstone the synced children (spec §7.3a) ───────────────

describe('Class-2 cascade deletes enqueue child tombstones', () => {
  it('a chat delete tombstones the chat and each synced message', async () => {
    setOnline();
    await seedChat('c1');
    await seedMessage('m1', 'c1');
    await seedMessage('m2', 'c1');

    await deleteChatCascade('c1');

    expect(stamps(await outbox())).toEqual([
      'chats:c1:delete',
      'messages:m1:delete',
      'messages:m2:delete',
    ]);
    // Local rows are gone immediately.
    expect(await getClientDataDb().chats.get('c1')).toBeUndefined();
    expect(await getClientDataDb().messages.count()).toBe(0);
  });

  it('a library delete tombstones the library and each synced document', async () => {
    setOnline();
    await seedLibrary('l1');
    await seedDocument('d1', 'l1');
    await seedDocument('d2', 'l1');

    await deleteLibraryCascade('l1', noopStore);

    expect(stamps(await outbox())).toEqual([
      'documents:d1:delete',
      'documents:d2:delete',
      'libraries:l1:delete',
    ]);
  });
});

// ── Document/library deletes tombstone their vectors server-side (§4, 2026-07-13)
describe('Class-2 cascade deletes tombstone document vectors', () => {
  it('a document delete tombstones the document AND each of its synced vector chunks', async () => {
    setOnline();
    await seedLibrary('l1');
    await seedDocument('d1', 'l1');

    await deleteDocumentCascade('d1', vectorStoreWith({ d1: ['d1#0', 'd1#1', 'd1#2'] }));

    expect(stamps(await outbox())).toEqual([
      'documents:d1:delete',
      'vectors:d1#0:delete',
      'vectors:d1#1:delete',
      'vectors:d1#2:delete',
    ]);
  });

  it('an UNLINKED document delete enqueues nothing (local-only removes vectors, no tombstones)', async () => {
    setLocalOnly();
    await seedLibrary('l1');
    await seedDocument('d1', 'l1');

    await deleteDocumentCascade('d1', vectorStoreWith({ d1: ['d1#0', 'd1#1'] }));

    expect(await getClientDataDb().documents.get('d1')).toBeUndefined();
    expect(await outbox()).toHaveLength(0);
  });

  it('a library delete cascades vector tombstones per contained document', async () => {
    setOnline();
    await seedLibrary('l1');
    await seedDocument('d1', 'l1');
    await seedDocument('d2', 'l1');

    await deleteLibraryCascade('l1', vectorStoreWith({ d1: ['d1#0'], d2: ['d2#0', 'd2#1'] }));

    expect(stamps(await outbox())).toEqual([
      'documents:d1:delete',
      'documents:d2:delete',
      'libraries:l1:delete',
      'vectors:d1#0:delete',
      'vectors:d2#0:delete',
      'vectors:d2#1:delete',
    ]);
  });
});

// ── Offline-defer sites never throw and never enqueue (spec §5) ──────────────

describe('offline-defer background writes', () => {
  it('advanceCursor writes locally and enqueues nothing while offline', async () => {
    setOffline();
    await seedChat('c1');
    await advanceCursor('c1', 'm-42');
    expect((await getClientDataDb().chats.get('c1'))?.lastExtractedMessageId).toBe('m-42');
    expect(await outbox()).toHaveLength(0);
  });

  it('advanceCursor enqueues a chats upsert while online', async () => {
    setOnline();
    await seedChat('c1');
    await advanceCursor('c1', 'm-42');
    expect(stamps(await outbox())).toEqual(['chats:c1:upsert']);
  });

  it('saveBody persists the body offline with no outbox row, then enqueues online', async () => {
    setOffline();
    const body = await saveBody('p1', 'remembered', 3, 'dream');
    expect(await getClientDataDb().memoryBody.get(body.id)).toBeDefined();
    expect(await outbox()).toHaveLength(0);

    setOnline();
    const body2 = await saveBody('p1', 'remembered more', 4, 'dream');
    expect(stamps(await outbox())).toEqual([`memoryBody:${body2.id}:upsert`]);
  });
});

// ── The disabled-UI backstop: a user-facing Class-2 write throws offline ──────

describe('offline throw backstop (spec §5)', () => {
  it('a chat-libraries edit throws SyncOfflineError when linked + offline', async () => {
    setOffline();
    await seedChat('c1');
    await expect(setChatLibraries('c1', ['lib-x'])).rejects.toBeInstanceOf(SyncOfflineError);
    // The local row is untouched — the write never ran.
    expect((await getClientDataDb().chats.get('c1'))?.libraryIds).toEqual([]);
  });

  it('a document delete throws SyncOfflineError when linked + offline', async () => {
    setOffline();
    await seedLibrary('l1');
    await seedDocument('d1', 'l1');
    await expect(deleteDocumentCascade('d1', noopStore)).rejects.toBeInstanceOf(SyncOfflineError);
  });
});

// ── Local-only account: the engine does not exist (spec §5) ──────────────────

describe('local-only account — plain local writes, no outbox', () => {
  it('an edit writes locally with no outbox row', async () => {
    setLocalOnly();
    await seedLibrary('l1');
    await updateLibrary('l1', { name: 'renamed' });
    expect((await getClientDataDb().libraries.get('l1'))?.name).toBe('renamed');
    expect(await outbox()).toHaveLength(0);
  });

  it('a cascade delete removes rows locally with no outbox row', async () => {
    setLocalOnly();
    await seedChat('c1');
    await seedMessage('m1', 'c1');
    await deleteChatCascade('c1');
    expect(await getClientDataDb().chats.get('c1')).toBeUndefined();
    expect(await getClientDataDb().messages.count()).toBe(0);
    expect(await outbox()).toHaveLength(0);
  });

  it('createSeedTemplate writes locally with no outbox row', async () => {
    setLocalOnly();
    const id = await createSeedTemplate({
      name: 'T',
      description: '',
      nsfw: false,
      greeting: null,
      body: [],
    } as never);
    expect(await getClientDataDb().seedTemplates.get(id)).toBeDefined();
    expect(await outbox()).toHaveLength(0);
  });
});
