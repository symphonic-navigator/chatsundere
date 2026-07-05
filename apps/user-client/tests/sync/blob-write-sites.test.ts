// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { useAccountLinkStore, useConnectivityStore, useSessionStore } from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  AttachmentRow,
  ChatRow,
  PersonaRow,
  SyncOutboxRow,
} from '../../src/boot/client-data-db.js';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { addGeneratedImageArtefact, deleteArtefact } from '../../src/data/artefacts.js';
import {
  addAttachment,
  attachPendingToMessage,
  removeAttachment,
} from '../../src/data/attachments.js';
import { deleteChatCascade } from '../../src/data/chats.js';
import { removePersonaAvatar, setPersonaAvatar } from '../../src/data/persona-avatars.js';
import { deletePersonaCascade } from '../../src/data/personas.js';
import { setImmediateDrain } from '../../src/sync/enqueue.js';
import { _resetTriggersForTests, _setTriggerCycle } from '../../src/sync/triggers.js';

// Node's global `Blob` survives fake-indexeddb's structuredClone with real
// bytes (mirrors tests/sync/blob-drain.test.ts), so a stored blob's `blobRef`
// round-trips and the drain's phase-1 reader could resolve it.

// ── Store helpers (mirror class2-write-sites.test.ts) ────────────────────────

/** Linked + reachable + unlocked → Class-1 enqueues AND Class-2 writes allowed. */
function setOnline(): void {
  useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
  useConnectivityStore.setState({ state: { kind: 'linked_online' } });
  useSessionStore.setState({ mk: { key: 'fake-mk' } as never });
}
function setLocalOnly(): void {
  useAccountLinkStore.setState({ linkStatus: 'local-only', baseUrl: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ mk: null });
}

async function outbox(): Promise<SyncOutboxRow[]> {
  return getClientDataDb().syncOutbox.toArray();
}
/** `collection:key:op` (blob ops append `:blobId`) — a stable, sortable summary. */
function stamps(rows: SyncOutboxRow[]): string[] {
  return rows
    .map((r) =>
      r.blobId
        ? `${r.collection}:${r.key}:${r.op}:${r.blobId}`
        : `${r.collection}:${r.key}:${r.op}`,
    )
    .sort();
}
function ops(rows: SyncOutboxRow[], op: SyncOutboxRow['op']): SyncOutboxRow[] {
  return rows.filter((r) => r.op === op);
}

// ── Seeders ──────────────────────────────────────────────────────────────────

async function seedPersona(id: string): Promise<void> {
  await getClientDataDb().personas.add({
    id,
    createdAt: 1,
    updatedAt: 1,
  } as unknown as PersonaRow);
}
async function seedChat(id: string, personaId = 'p1'): Promise<void> {
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
function imageInput(chatId: string) {
  return {
    chatId,
    personaId: 'p1',
    prompt: 'a red square',
    modelRef: 'prov:model',
    modelLabel: 'Model',
    configSnapshot: {} as never,
    bytes: new Blob(['full-image-bytes'], { type: 'image/png' }),
    mime: 'image/png',
    thumbBlob: new Blob(['thumb'], { type: 'image/jpeg' }),
    width: 64,
    height: 64,
  };
}
const AVATAR_ARGS = {
  personaId: 'p1',
  blob: new Blob(['avatar-bytes'], { type: 'image/webp' }),
  mime: 'image/webp',
  width: 100,
  height: 100,
  crop: { x: 0, y: 0, zoom: 1 },
};

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  _setTriggerCycle(async () => undefined);
  setImmediateDrain(async () => undefined); // no drain; we assert the outbox intent
});

afterEach(async () => {
  _resetTriggersForTests();
  setImmediateDrain(async () => undefined);
  await _resetClientDataDbForTests();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ mk: null });
});

// ── Family 1: artefact image creation (Class-1 put + record, atomically) ─────

describe('artefact image creation', () => {
  it('linked: enqueues a blob-put per blob + the record upsert, refs set on the row', async () => {
    setOnline();
    const id = await addGeneratedImageArtefact(imageInput('c1'));

    const row = await getClientDataDb().artefacts.get(id);
    expect(row?.blobRef?.blobId).toBeDefined();
    expect(row?.thumbBlobRef?.blobId).toBeDefined();
    // `bytes` = plaintext size + the sealed-blob overhead (28).
    expect(row?.blobRef?.bytes).toBe((row?.blob as Blob).size + 28);

    const rows = await outbox();
    // Both blob-puts, both naming a ref on the row, plus one record upsert — all
    // in one transaction (present together or, when local-only, absent together).
    expect(stamps(rows)).toEqual(
      [
        `artefacts:${id}:blob-put:${row?.blobRef?.blobId}`,
        `artefacts:${id}:blob-put:${row?.thumbBlobRef?.blobId}`,
        `artefacts:${id}:upsert`,
      ].sort(),
    );
  });

  it('local-only: stores the bytes but mints no refs and enqueues nothing', async () => {
    setLocalOnly();
    const id = await addGeneratedImageArtefact(imageInput('c1'));

    const row = await getClientDataDb().artefacts.get(id);
    expect(row?.blob).toBeInstanceOf(Blob);
    expect(row?.blobRef).toBeUndefined();
    expect(row?.thumbBlobRef).toBeUndefined();
    expect(await outbox()).toHaveLength(0);
  });
});

// ── Family 2: artefact delete (tombstone + deferred blob-deletes) ────────────

describe('artefact delete', () => {
  it('enqueues a record tombstone plus a blob-delete for each blob it referenced', async () => {
    setOnline();
    const id = await addGeneratedImageArtefact(imageInput('c1'));
    const row = await getClientDataDb().artefacts.get(id);
    await getClientDataDb().syncOutbox.clear(); // ignore the creation puts

    await deleteArtefact(id);

    const rows = await outbox();
    expect(stamps(rows)).toEqual(
      [
        `artefacts:${id}:delete`,
        `artefacts:${id}:blob-delete:${row?.blobRef?.blobId}`,
        `artefacts:${id}:blob-delete:${row?.thumbBlobRef?.blobId}`,
      ].sort(),
    );
    expect(await getClientDataDb().artefacts.get(id)).toBeUndefined();
  });
});

// ── Family 3: avatar set / replace / remove (blobRef:null, NEVER a tombstone) ─

describe('persona avatar writes', () => {
  it('set: enqueues a blob-put (new id) + a personaAvatars upsert; no old delete', async () => {
    setOnline();
    await setPersonaAvatar(AVATAR_ARGS);

    const row = await getClientDataDb().personaAvatars.get('p1');
    const newId = row?.blobRef?.blobId;
    expect(newId).toBeDefined();
    const rows = await outbox();
    expect(stamps(rows)).toEqual(
      [`personaAvatars:p1:blob-put:${newId}`, 'personaAvatars:p1:upsert'].sort(),
    );
    expect(ops(rows, 'blob-delete')).toHaveLength(0);
  });

  it('replace: enqueues a new blob-put + a delete of the replaced id + an upsert', async () => {
    setOnline();
    await setPersonaAvatar(AVATAR_ARGS);
    const first = await getClientDataDb().personaAvatars.get('p1');
    const oldId = first?.blobRef?.blobId;
    await getClientDataDb().syncOutbox.clear();

    await setPersonaAvatar({
      ...AVATAR_ARGS,
      blob: new Blob(['new-avatar'], { type: 'image/webp' }),
    });
    const second = await getClientDataDb().personaAvatars.get('p1');
    const newId = second?.blobRef?.blobId;
    expect(newId).not.toBe(oldId);

    const rows = await outbox();
    expect(stamps(rows)).toEqual(
      [
        `personaAvatars:p1:blob-put:${newId}`,
        `personaAvatars:p1:blob-delete:${oldId}`,
        'personaAvatars:p1:upsert',
      ].sort(),
    );
  });

  it('remove is a blobRef:null Class-2 update with NO tombstone op', async () => {
    setOnline();
    await setPersonaAvatar(AVATAR_ARGS);
    const before = await getClientDataDb().personaAvatars.get('p1');
    const oldId = before?.blobRef?.blobId;
    await getClientDataDb().syncOutbox.clear();

    await removePersonaAvatar('p1');

    // The row SURVIVES (never a tombstone), bytes cleared, ref null.
    const after = await getClientDataDb().personaAvatars.get('p1');
    expect(after).toBeDefined();
    expect(after?.blob).toBeUndefined();
    expect(after?.blobRef).toBeNull();

    const rows = await outbox();
    // The terminality-trap proof: NO `personaAvatars:*:delete` op is ever enqueued.
    expect(ops(rows, 'delete')).toHaveLength(0);
    expect(stamps(rows)).toEqual(
      ['personaAvatars:p1:upsert', `personaAvatars:p1:blob-delete:${oldId}`].sort(),
    );
  });

  it('local-only avatar set mints no ref and enqueues nothing', async () => {
    setLocalOnly();
    await setPersonaAvatar(AVATAR_ARGS);
    const row = await getClientDataDb().personaAvatars.get('p1');
    expect(row?.blob).toBeInstanceOf(Blob);
    expect(row?.blobRef).toBeUndefined();
    expect(await outbox()).toHaveLength(0);
  });
});

// ── Family 4: attachment send (pending stays device-local) ───────────────────

describe('attachment send', () => {
  it('a pending compose-tray attachment (no messageId) enqueues nothing', async () => {
    setOnline();
    await seedChat('c1');
    await addAttachment({
      chatId: 'c1',
      kind: 'image',
      fileName: 'p.png',
      mime: 'image/png',
      blob: new Blob(['img'], { type: 'image/png' }),
    });
    // No send has bound it — it is device-local until its messageId is set.
    expect(await outbox()).toHaveLength(0);
  });

  it('on send: an image attachment enqueues a blob-put + record upsert atomically', async () => {
    setOnline();
    await seedChat('c1');
    const aid = await addAttachment({
      chatId: 'c1',
      kind: 'image',
      fileName: 'p.png',
      mime: 'image/png',
      blob: new Blob(['img'], { type: 'image/png' }),
    });

    await attachPendingToMessage('c1', 'msg-1');

    const row = await getClientDataDb().attachments.get(aid);
    expect(row?.messageId).toBe('msg-1');
    const blobId = row?.blobRef?.blobId;
    expect(blobId).toBeDefined();
    expect(stamps(await outbox())).toEqual(
      [`attachments:${aid}:blob-put:${blobId}`, `attachments:${aid}:upsert`].sort(),
    );
  });

  it('a sent attachment soft-delete is a Class-2 state edit + a blob-delete', async () => {
    setOnline();
    const db = getClientDataDb();
    await db.attachments.add({
      id: 'a1',
      chatId: 'c1',
      messageId: 'msg-1',
      origin: 'upload',
      kbRef: null,
      kind: 'image',
      fileName: 'p.png',
      mime: 'image/png',
      order: 0,
      state: 'active',
      createdAt: 1,
      updatedAt: 1,
      blob: new Blob(['img'], { type: 'image/png' }),
      blobRef: { blobId: 'sent-blob-id-aaaaaaaa', bytes: 40 },
      visionDescription: null,
    } as unknown as AttachmentRow);

    await removeAttachment('a1');

    expect((await db.attachments.get('a1'))?.state).toBe('deleted');
    expect(stamps(await outbox())).toEqual(
      ['attachments:a1:upsert', 'attachments:a1:blob-delete:sent-blob-id-aaaaaaaa'].sort(),
    );
  });
});

// ── Family 5: cascades spread tombstones + deferred blob-deletes ─────────────

describe('chat-delete cascade', () => {
  it('tombstones the chat, its attachments and artefacts, and blob-deletes their blobs', async () => {
    setOnline();
    await seedChat('c1');
    const artId = await addGeneratedImageArtefact(imageInput('c1'));
    const art = await getClientDataDb().artefacts.get(artId);
    // A sent image attachment on the same chat, already carrying a ref.
    await getClientDataDb().attachments.add({
      id: 'att-1',
      chatId: 'c1',
      messageId: 'm-1',
      origin: 'upload',
      kbRef: null,
      kind: 'image',
      fileName: 'p.png',
      mime: 'image/png',
      order: 0,
      state: 'active',
      createdAt: 1,
      updatedAt: 1,
      blob: new Blob(['i'], { type: 'image/png' }),
      blobRef: { blobId: 'att-blob-idaaaaaaaaaa', bytes: 30 },
      visionDescription: null,
    } as unknown as AttachmentRow);
    await getClientDataDb().syncOutbox.clear();

    await deleteChatCascade('c1');

    const rows = await outbox();
    // Record tombstones for the chat + both blob-bearing children.
    expect(stamps(ops(rows, 'delete'))).toEqual(
      [`artefacts:${artId}:delete`, 'attachments:att-1:delete', 'chats:c1:delete'].sort(),
    );
    // A blob-delete for the attachment blob + both artefact blobs.
    expect(stamps(ops(rows, 'blob-delete'))).toEqual(
      [
        'attachments:att-1:blob-delete:att-blob-idaaaaaaaaaa',
        `artefacts:${artId}:blob-delete:${art?.blobRef?.blobId}`,
        `artefacts:${artId}:blob-delete:${art?.thumbBlobRef?.blobId}`,
      ].sort(),
    );
    expect(await getClientDataDb().artefacts.count()).toBe(0);
    expect(await getClientDataDb().attachments.count()).toBe(0);
  });
});

describe('persona-delete cascade', () => {
  it('tombstones the avatar (the one case) + blob-deletes its bytes', async () => {
    setOnline();
    await seedPersona('p1');
    await setPersonaAvatar(AVATAR_ARGS);
    const avatar = await getClientDataDb().personaAvatars.get('p1');
    const avatarBlobId = avatar?.blobRef?.blobId;
    await getClientDataDb().syncOutbox.clear();

    await deletePersonaCascade('p1');

    const rows = await outbox();
    expect(stamps(rows)).toEqual(
      [
        'personas:p1:delete',
        'personaAvatars:p1:delete',
        `personaAvatars:p1:blob-delete:${avatarBlobId}`,
      ].sort(),
    );
    expect(await getClientDataDb().personaAvatars.get('p1')).toBeUndefined();
  });

  it('cascades attachments and artefacts across every owned chat, tombstoning + blob-deleting their media', async () => {
    setOnline();
    await seedPersona('p1');
    await seedChat('c1', 'p1');
    const artId = await addGeneratedImageArtefact(imageInput('c1'));
    const art = await getClientDataDb().artefacts.get(artId);
    await getClientDataDb().attachments.add({
      id: 'att-1',
      chatId: 'c1',
      messageId: 'm-1',
      origin: 'upload',
      kbRef: null,
      kind: 'image',
      fileName: 'p.png',
      mime: 'image/png',
      order: 0,
      state: 'active',
      createdAt: 1,
      updatedAt: 1,
      blob: new Blob(['i'], { type: 'image/png' }),
      blobRef: { blobId: 'att-blob-idaaaaaaaaaa', bytes: 30 },
      visionDescription: null,
    } as unknown as AttachmentRow);
    await getClientDataDb().syncOutbox.clear();

    await deletePersonaCascade('p1', { intoTrash: true });

    const rows = await outbox();
    expect(stamps(ops(rows, 'delete'))).toEqual(
      [
        'personas:p1:delete',
        'chats:c1:delete',
        `artefacts:${artId}:delete`,
        'attachments:att-1:delete',
      ].sort(),
    );
    expect(stamps(ops(rows, 'blob-delete'))).toEqual(
      [
        'attachments:att-1:blob-delete:att-blob-idaaaaaaaaaa',
        `artefacts:${artId}:blob-delete:${art?.blobRef?.blobId}`,
        `artefacts:${artId}:blob-delete:${art?.thumbBlobRef?.blobId}`,
      ].sort(),
    );
    expect(await getClientDataDb().artefacts.count()).toBe(0);
    expect(await getClientDataDb().attachments.count()).toBe(0);

    const trash = await getClientDataDb().trash.toArray();
    const attTrash = trash.find((t) => t.collection === 'attachments' && t.key === 'att-1');
    const artTrash = trash.find((t) => t.collection === 'artefacts' && t.key === artId);
    expect(attTrash?.rootGroup).toBe('persona:p1');
    expect(artTrash?.rootGroup).toBe('persona:p1');
  });
});
