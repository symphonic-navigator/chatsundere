// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { addGeneratedArtefact } from '../../src/data/artefacts.js';
import { deleteChatCascade } from '../../src/data/chats.js';

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

test('deleting a chat cascade-deletes its artefacts but not other chats', async () => {
  await addGeneratedArtefact({ chatId: 'c1', personaId: 'p1', title: 'A', content: 'x' });
  await addGeneratedArtefact({ chatId: 'c2', personaId: 'p1', title: 'B', content: 'x' });
  await deleteChatCascade('c1');
  const db = await openClientDataDb();
  expect(await db.artefacts.where('chatId').equals('c1').count()).toBe(0);
  expect(await db.artefacts.where('chatId').equals('c2').count()).toBe(1);
});
