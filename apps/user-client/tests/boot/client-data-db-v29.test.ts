// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

describe('client-data-db v29 — compaction checkpoints', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('opens at version 29 with the compactionCheckpoints table', async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    expect(db.verno).toBe(35);
    expect(db.tables.map((t) => t.name)).toContain('compactionCheckpoints');
  });

  it('can write and read back a checkpoint row', async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    await db.compactionCheckpoints.add({
      id: 'cp-1',
      chatId: 'chat-1',
      createdAt: 1,
      modelId: 'm',
      summaryMarkdown: '## Topic & Goal\n_(none)_',
      lastMessageIdBefore: 'a',
      tailStartMessageId: 'b',
      tokensBefore: 100,
      tokensAfter: 10,
      tailTokenCount: 20,
      prevCheckpointId: null,
      trigger: 'manual',
    });
    const byChat = await db.compactionCheckpoints.where('chatId').equals('chat-1').toArray();
    expect(byChat).toHaveLength(1);
    expect(byChat[0]?.summaryMarkdown).toContain('Topic & Goal');
  });
});
