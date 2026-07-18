// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import {
  addAttachment,
  commitEditAttachmentsToMessage,
  copyEditAttachmentsToChat,
  listPendingAttachments,
} from '../../src/data/attachments.js';

async function seedOriginal(chatId: string, messageId: string, name: string): Promise<string> {
  const id = await addAttachment({
    chatId,
    kind: 'text',
    fileName: name,
    mime: 'text/plain',
    text: name,
  });
  await getClientDataDb().attachments.update(id, { messageId });
  return id;
}

beforeEach(async () => {
  await openClientDataDb();
  await getClientDataDb().attachments.clear();
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

describe('commitEditAttachmentsToMessage', () => {
  it('deletes staged removals and binds pending additions to the message', async () => {
    const keep = await seedOriginal('c1', 'u1', 'keep');
    const drop = await seedOriginal('c1', 'u1', 'drop');
    const added = await addAttachment({
      chatId: 'c1',
      kind: 'text',
      fileName: 'new',
      mime: 'text/plain',
      text: 'new',
    });

    await commitEditAttachmentsToMessage('c1', 'u1', [drop]);

    const db = getClientDataDb();
    expect(await db.attachments.get(drop)).toBeUndefined();
    expect((await db.attachments.get(keep))?.messageId).toBe('u1');
    expect((await db.attachments.get(added))?.messageId).toBe('u1');
    expect(await listPendingAttachments('c1')).toHaveLength(0);
  });

  it('binds pending additions with an empty stagedRemovals list (no-removals path)', async () => {
    const keep = await seedOriginal('c1', 'u1', 'keep');
    const added = await addAttachment({
      chatId: 'c1',
      kind: 'text',
      fileName: 'new',
      mime: 'text/plain',
      text: 'new',
    });

    await commitEditAttachmentsToMessage('c1', 'u1', []);

    const db = getClientDataDb();
    expect((await db.attachments.get(keep))?.messageId).toBe('u1');
    expect((await db.attachments.get(added))?.messageId).toBe('u1');
    expect(await listPendingAttachments('c1')).toHaveLength(0);
  });
});

describe('copyEditAttachmentsToChat', () => {
  it('copies surviving originals as pending on the target chat and re-homes additions', async () => {
    const keep = await seedOriginal('c1', 'u1', 'keep');
    const drop = await seedOriginal('c1', 'u1', 'drop');
    const added = await addAttachment({
      chatId: 'c1',
      kind: 'text',
      fileName: 'new',
      mime: 'text/plain',
      text: 'new',
    });

    await copyEditAttachmentsToChat('c1', 'u1', [drop], 'c2');

    const targetPending = await listPendingAttachments('c2');
    // one copied survivor (keep) + the re-homed addition = 2; 'drop' excluded.
    expect(targetPending).toHaveLength(2);
    expect(targetPending.map((a) => a.fileName).sort()).toEqual(['keep', 'new']);
    // original 'keep' row is untouched (still bound to u1 on c1).
    expect((await getClientDataDb().attachments.get(keep))?.messageId).toBe('u1');
    // the addition moved chats.
    expect((await getClientDataDb().attachments.get(added))?.chatId).toBe('c2');
  });

  it('does not resurrect a soft-deleted original on the target chat', async () => {
    const deleted = await seedOriginal('c1', 'u1', 'gone');
    await getClientDataDb().attachments.update(deleted, { state: 'deleted' });

    await copyEditAttachmentsToChat('c1', 'u1', [], 'c2');

    const targetPending = await listPendingAttachments('c2');
    expect(targetPending.map((a) => a.fileName)).not.toContain('gone');
    expect(targetPending).toHaveLength(0);
  });
});
