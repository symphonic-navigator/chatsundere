// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ArtefactRow } from '../../src/boot/client-data-db.js';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { addArtefactSnapshot, listPendingAttachments } from '../../src/data/attachments.js';

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
});

function artefact(over: Partial<ArtefactRow> = {}): ArtefactRow {
  const now = Date.now();
  return {
    id: 'a1',
    chatId: 'src-chat',
    personaId: 'p1',
    projectId: null,
    origin: 'generated',
    kind: 'text',
    format: 'html',
    title: 'Pomodoro Timer',
    fileName: 'pomodoro.html',
    mime: 'text/html',
    content: '<!doctype html><body>hi</body>',
    tags: ['timer'],
    favourite: false,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

describe('addArtefactSnapshot', () => {
  it('copies content/fileName/mime into a pending text attachment on the target chat', async () => {
    await addArtefactSnapshot('dest-chat', artefact());
    const pending = await listPendingAttachments('dest-chat');
    expect(pending).toHaveLength(1);
    const a = pending[0];
    expect(a).toBeDefined();
    if (!a) throw new Error('Expected attachment to exist');
    expect(a.kind).toBe('text');
    expect(a.origin).toBe('upload');
    expect(a.messageId).toBeNull();
    expect(a.fileName).toBe('pomodoro.html');
    expect(a.mime).toBe('text/html');
    expect(a.text).toBe('<!doctype html><body>hi</body>');
    expect(a.blob).toBeUndefined();
  });

  it('does not copy title or tags (attachments have neither)', async () => {
    await addArtefactSnapshot('dest-chat', artefact());
    const pending = await listPendingAttachments('dest-chat');
    const a = pending[0];
    expect(a).toBeDefined();
    if (!a) throw new Error('Expected attachment to exist');
    expect(a).not.toHaveProperty('title');
    expect(a).not.toHaveProperty('tags');
  });

  it('snapshots are independent copies — two attaches yield two rows', async () => {
    await addArtefactSnapshot('dest-chat', artefact());
    await addArtefactSnapshot('dest-chat', artefact());
    expect(await listPendingAttachments('dest-chat')).toHaveLength(2);
  });
});
