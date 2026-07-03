// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { useAccountLinkStore } from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  CompactionCheckpointRow,
  PersonaRow,
  SyncOutboxRow,
} from '../../src/boot/client-data-db.js';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { writeCheckpoint } from '../../src/compaction/repo.js';
import { importChatsuneSessions } from '../../src/data/chatsune-import.js';
import { createLibrary } from '../../src/data/knowledge.js';
import type { ChatsuneSessionExport } from '../../src/lib/chatsune-import/types.js';
import { addJournalEntries } from '../../src/memory/repo.js';
import { _resetTriggersForTests, _setTriggerCycle } from '../../src/sync/triggers.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function setLinked(): void {
  useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
}
function setLocalOnly(): void {
  useAccountLinkStore.setState({ linkStatus: 'local-only', baseUrl: null });
}

async function outbox(): Promise<SyncOutboxRow[]> {
  return getClientDataDb().syncOutbox.toArray();
}
function stamps(rows: SyncOutboxRow[]): string[] {
  return rows.map((r) => `${r.collection}:${r.key}:${r.op}`).sort();
}

/** A persona with a mindspace set — enough for the importer to snapshot without
 *  needing the settings singleton seeded. */
async function seedPersona(id: string): Promise<void> {
  await getClientDataDb().personas.add({ id, mindspaceId: 'ms-1' } as unknown as PersonaRow);
}

const SESSION: ChatsuneSessionExport = {
  original_id: 'sess-1',
  session_fields: { title: 'Imported' },
  messages: [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi there' },
  ],
};

function makeCheckpoint(id: string, chatId: string): CompactionCheckpointRow {
  return {
    id,
    chatId,
    createdAt: Date.now(),
    modelId: 'test-model',
    summaryMarkdown: 'summary',
    lastMessageIdBefore: 'm-0',
    tailStartMessageId: 'm-1',
    tokensBefore: 100,
    tokensAfter: 10,
  } as CompactionCheckpointRow;
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  // Any debounced Class-1 kick is a no-op in tests — we assert on the outbox,
  // not on drain behaviour.
  _setTriggerCycle(async () => undefined);
});

afterEach(async () => {
  _resetTriggersForTests();
  await _resetClientDataDbForTests();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
});

// ── Linked account: Class-1 creation-inserts / appends enqueue ───────────────

describe('Class-1 write sites — linked account enqueues', () => {
  it('createLibrary enqueues a single libraries upsert', async () => {
    setLinked();
    const lib = await createLibrary({ name: 'L', description: '', nsfw: false });
    expect(stamps(await outbox())).toEqual([`libraries:${lib.id}:upsert`]);
  });

  it('an import enqueues creation-insert upserts for chats and completed messages', async () => {
    setLinked();
    await seedPersona('p1');
    const res = await importChatsuneSessions('p1', [SESSION]);
    expect(res.imported).toBe(1);

    const rows = await outbox();
    const chatRows = rows.filter((r) => r.collection === 'chats');
    const msgRows = rows.filter((r) => r.collection === 'messages');
    expect(chatRows).toHaveLength(1);
    expect(chatRows[0]?.op).toBe('upsert');
    expect(msgRows).toHaveLength(2);
    expect(msgRows.every((r) => r.op === 'upsert')).toBe(true);

    // The enqueued message keys match the persisted (completed) message rows.
    const msgs = await getClientDataDb().messages.toArray();
    expect(msgs.every((m) => m.streamingState === 'complete')).toBe(true);
    expect(new Set(msgRows.map((r) => r.key))).toEqual(new Set(msgs.map((m) => m.id)));
  });

  it('addJournalEntries enqueues a memoryJournal upsert per entry', async () => {
    setLinked();
    const created = await addJournalEntries('p1', [
      { content: 'a fact', category: null, isCorrection: false },
    ]);
    const rows = await outbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      collection: 'memoryJournal',
      key: created[0]?.id,
      op: 'upsert',
    });
  });

  it('writeCheckpoint enqueues the checkpoint but NOT the derived chats pointer', async () => {
    setLinked();
    await writeCheckpoint(makeCheckpoint('cp-1', 'c-1'));
    const rows = await outbox();
    expect(stamps(rows)).toEqual(['compactionCheckpoints:cp-1:upsert']);
    expect(rows.some((r) => r.collection === 'chats')).toBe(false);
  });
});

// ── Device-local / Class-2 field writes never enqueue here ───────────────────

describe('device-local writes do not enqueue (Class-1 sweep only)', () => {
  it('a draftInput keystroke on an existing chat adds no outbox row', async () => {
    setLinked();
    await seedPersona('p1');
    await importChatsuneSessions('p1', [SESSION]);
    const before = (await outbox()).length;

    const chats = await getClientDataDb().chats.toArray();
    const chatId = chats[0]?.id;
    expect(chatId).toBeDefined();
    if (chatId) await getClientDataDb().chats.update(chatId, { draftInput: 'typing…' });

    expect((await outbox()).length).toBe(before);
  });
});

// ── Local-only account: the engine does not exist ────────────────────────────

describe('local-only account — no outbox rows (spec §5)', () => {
  it('createLibrary writes the library locally with no outbox row', async () => {
    setLocalOnly();
    const lib = await createLibrary({ name: 'L', description: '', nsfw: false });
    expect(await getClientDataDb().libraries.get(lib.id)).toBeDefined();
    expect(await outbox()).toHaveLength(0);
  });

  it('an import writes completed messages locally but enqueues nothing', async () => {
    setLocalOnly();
    await seedPersona('p1');
    const res = await importChatsuneSessions('p1', [SESSION]);
    expect(res.imported).toBe(1);
    expect(await getClientDataDb().messages.count()).toBe(2);
    expect(await outbox()).toHaveLength(0);
  });
});
