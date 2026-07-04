// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { useAccountLinkStore, useConnectivityStore, useSessionStore } from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  AttachmentRow,
  ChatRow,
  MessageRow,
  PersonaAvatarRow,
  PersonaRow,
  PillRow,
  SyncOutboxRow,
} from '../../src/boot/client-data-db.js';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { setImmediateDrain } from '../../src/sync/enqueue.js';
import { _resetTriggersForTests, _setTriggerCycle } from '../../src/sync/triggers.js';
import { permanentDelete, softDelete } from '../../src/trash/delete-flow.js';

// ── Store helpers ────────────────────────────────────────────────────────────

/** Linked + reachable + unlocked → Class-2 writes are allowed (isClass2Allowed). */
function setOnline(): void {
  useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
  useConnectivityStore.setState({ state: { kind: 'linked_online' } });
  useSessionStore.setState({ mk: { key: 'fake-mk' } as never });
}

// ── The `${collection}:${key}` id sets we compare (I-2) ──────────────────────

/** The set of trash primary keys (`${collection}:${key}`) currently held. */
async function trashIdSet(): Promise<Set<string>> {
  return new Set((await getClientDataDb().trash.toCollection().primaryKeys()) as string[]);
}
/** The set of `${collection}:${key}` that received a `delete`-op outbox entry. */
async function deleteOutboxIdSet(): Promise<Set<string>> {
  const rows = await getClientDataDb().syncOutbox.toArray();
  return new Set(rows.filter((r) => r.op === 'delete').map((r) => `${r.collection}:${r.key}`));
}
function stamps(rows: SyncOutboxRow[]): string[] {
  return rows.map((r) => `${r.collection}:${r.key}:${r.op}`).sort();
}

// ── Row seeders (minimal shapes) ─────────────────────────────────────────────

async function seedChat(id: string, personaId: string): Promise<void> {
  await getClientDataDb().chats.add({
    id,
    personaId,
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
async function seedPill(id: string, messageId: string): Promise<void> {
  await getClientDataDb().pills.add({
    id,
    messageId,
    kind: 'tool-call',
    positionHint: 'inline',
    status: 'completed',
    payload: {},
    createdAt: 1,
  } as unknown as PillRow);
}
async function seedAttachment(id: string, chatId: string): Promise<void> {
  await getClientDataDb().attachments.add({
    id,
    chatId,
    messageId: null,
    origin: 'upload',
    kind: 'text',
    fileName: 'f.txt',
    mime: 'text/plain',
    order: 0,
    state: 'active',
    createdAt: 1,
    updatedAt: 1,
    text: 'body',
  } as unknown as AttachmentRow);
}
async function seedPersona(id: string): Promise<void> {
  await getClientDataDb().personas.add({
    id,
    name: 'Fable',
    tagline: '',
    colour: '#fff',
    font: 'sans',
    instructions: '',
    canonicalId: null,
    providerId: 'prov-1',
    modelId: 'model-1',
    mindspaceId: null,
    aboutMeOverride: null,
    textureOverride: null,
    temperature: 0.85,
    adultPersona: false,
    chatsundereTonality: true,
    contextWindow: null,
    libraryIds: [],
    askExpertDefault: false,
    mcpOverrides: {},
    roleplay: false,
    narration: 'first',
    greetingEnabled: false,
    greetingInstructions: '',
    voice: null,
    narratorVoice: null,
    createdAt: 1,
    updatedAt: 1,
  } as unknown as PersonaRow);
}
async function seedAvatar(personaId: string): Promise<void> {
  await getClientDataDb().personaAvatars.add({
    personaId,
    mime: 'image/jpeg',
    width: 64,
    height: 64,
    crop: { x: 0, y: 0, zoom: 1 },
    updatedAt: 1,
  } as unknown as PersonaAvatarRow);
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

// ── 1. Snapshot + live-delete + outbox (chat) ────────────────────────────────

describe('softDelete — chat: snapshot, live-delete, outbox, no dead-keys', () => {
  it('snapshots the cascade, removes live rows, enqueues deletes, writes no dead-keys', async () => {
    setOnline();
    await seedChat('c1', 'p1');
    await seedMessage('m1', 'c1');
    await seedMessage('m2', 'c1');
    await seedPill('pl1', 'm1');
    await seedAttachment('a1', 'c1');

    await softDelete('chats', 'c1');
    const db = getClientDataDb();

    // (a) every live row is gone.
    expect(await db.chats.get('c1')).toBeUndefined();
    expect(await db.messages.count()).toBe(0);
    expect(await db.pills.count()).toBe(0);
    expect(await db.attachments.count()).toBe(0);

    // (b) the trash holds a row for each with correct grouping metadata.
    const chatTrash = await db.trash.get('chats:c1');
    expect(chatTrash?.entityKind).toBe('chat');
    expect(chatTrash?.rootGroup).toBe('persona:p1');
    const m1Trash = await db.trash.get('messages:m1');
    expect(m1Trash?.entityKind).toBe('chatChild');
    expect(m1Trash?.rootGroup).toBe('persona:p1');
    expect(m1Trash?.parentRef).toEqual({ field: 'chatId', id: 'c1' });
    expect(await db.trash.get('pills:pl1')).toBeDefined();
    expect(await db.trash.get('attachments:a1')).toBeDefined();

    // (c) the outbox holds a delete for the chat and each descendant.
    expect(stamps(await db.syncOutbox.toArray())).toEqual([
      'attachments:a1:delete',
      'chats:c1:delete',
      'messages:m1:delete',
      'messages:m2:delete',
      'pills:pl1:delete',
    ]);

    // (d) dead-keys are empty — written at ack, never here (§3.9).
    expect(await db.deadKeys.count()).toBe(0);
  });
});

// ── 2. I-2 completeness: trash set === delete-op outbox set ───────────────────

describe('I-2 — the trash set equals the sync-deleted set (no data loss)', () => {
  it('holds for a chat delete', async () => {
    setOnline();
    await seedChat('c1', 'p1');
    await seedMessage('m1', 'c1');
    await seedMessage('m2', 'c1');
    await seedPill('pl1', 'm1');
    await seedAttachment('a1', 'c1');

    await softDelete('chats', 'c1');

    const trashSet = await trashIdSet();
    const deleteOutboxSet = await deleteOutboxIdSet();
    expect(trashSet).toEqual(deleteOutboxSet);
  });

  it('holds for a persona delete, snapshotting its chats, messages and avatar', async () => {
    setOnline();
    await seedPersona('p1');
    await seedAvatar('p1');
    await seedChat('c1', 'p1');
    await seedMessage('m1', 'c1');
    await seedMessage('m2', 'c1');
    await seedPill('pl1', 'm1');

    await softDelete('personas', 'p1');
    const db = getClientDataDb();

    const trashSet = await trashIdSet();
    const deleteOutboxSet = await deleteOutboxIdSet();
    expect(trashSet).toEqual(deleteOutboxSet);

    // The avatar and every message are snapshotted under the persona card.
    expect((await db.trash.get('personaAvatars:p1'))?.rootGroup).toBe('persona:p1');
    expect((await db.trash.get('messages:m1'))?.rootGroup).toBe('persona:p1');
    expect((await db.trash.get('messages:m2'))?.rootGroup).toBe('persona:p1');
    expect((await db.trash.get('personas:p1'))?.entityKind).toBe('persona');
  });
});

// ── 3. permanentDelete: no snapshot ──────────────────────────────────────────

describe('permanentDelete — hard delete, no trash snapshot', () => {
  it('removes the live rows, enqueues the deletes, snapshots nothing', async () => {
    setOnline();
    await seedChat('c1', 'p1');
    await seedMessage('m1', 'c1');

    await permanentDelete('chats', 'c1');
    const db = getClientDataDb();

    expect(await db.chats.get('c1')).toBeUndefined();
    expect(await db.messages.count()).toBe(0);
    expect(stamps(await db.syncOutbox.toArray())).toEqual([
      'chats:c1:delete',
      'messages:m1:delete',
    ]);
    expect(await db.trash.count()).toBe(0);
    expect(await db.deadKeys.count()).toBe(0);
  });
});

// ── 4. softDelete returns a working in-place restore handle ───────────────────

describe('softDelete — the returned handle restores in place before drain', () => {
  it('cancels the queued deletes, re-materialises rows at their ids, clears the trash', async () => {
    setOnline();
    await seedChat('c1', 'p1');
    await seedMessage('m1', 'c1');
    await seedPill('pl1', 'm1');

    const handle = await softDelete('chats', 'c1');
    await handle.restore();
    const db = getClientDataDb();

    // Rows are back at their original ids.
    expect((await db.chats.get('c1'))?.personaId).toBe('p1');
    expect(await db.messages.get('m1')).toBeDefined();
    expect(await db.pills.get('pl1')).toBeDefined();
    // The queued delete was cancelled and the trash cleared.
    expect(await db.syncOutbox.count()).toBe(0);
    expect(await db.trash.count()).toBe(0);
    // No dead-key was written, so the identity is preserved.
    expect(await db.deadKeys.count()).toBe(0);
  });
});
