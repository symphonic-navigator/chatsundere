// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import {
  addGeneratedArtefact,
  addTagsToArtefacts,
  countAllArtefacts,
  deleteArtefacts,
  listAllArtefacts,
  setArtefactTags,
} from '../../src/data/artefacts.js';

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

test('listAllArtefacts spans chats, newest-first; countAllArtefacts counts all', async () => {
  const a = await addGeneratedArtefact({ chatId: 'c1', personaId: 'p1', title: 'A', content: 'x' });
  const b = await addGeneratedArtefact({ chatId: 'c2', personaId: 'p2', title: 'B', content: 'x' });
  const all = await listAllArtefacts();
  expect(all.map((r) => r.id)).toEqual([b, a]); // b created later → first
  expect(await countAllArtefacts()).toBe(2);
});

test('setArtefactTags replaces with normalised tags', async () => {
  const id = await addGeneratedArtefact({
    chatId: 'c1',
    personaId: 'p1',
    title: 'A',
    content: 'x',
  });
  await setArtefactTags(id, [' Demo ', 'demo', 'PROD']);
  const row = await openClientDataDb().then((db) => db.artefacts.get(id));
  expect(row?.tags).toEqual(['demo', 'prod']);
});

test('addTagsToArtefacts unions tags across many rows without dupes', async () => {
  const a = await addGeneratedArtefact({ chatId: 'c1', personaId: 'p1', title: 'A', content: 'x' });
  const b = await addGeneratedArtefact({ chatId: 'c2', personaId: 'p1', title: 'B', content: 'x' });
  await setArtefactTags(a, ['keep']);
  await addTagsToArtefacts([a, b], ['shared', 'keep']);
  const db = await openClientDataDb();
  expect((await db.artefacts.get(a))?.tags).toEqual(['keep', 'shared']);
  expect((await db.artefacts.get(b))?.tags).toEqual(['shared', 'keep']);
});

test('deleteArtefacts removes many at once', async () => {
  const a = await addGeneratedArtefact({ chatId: 'c1', personaId: 'p1', title: 'A', content: 'x' });
  const b = await addGeneratedArtefact({ chatId: 'c1', personaId: 'p1', title: 'B', content: 'x' });
  const c = await addGeneratedArtefact({ chatId: 'c1', personaId: 'p1', title: 'C', content: 'x' });
  await deleteArtefacts([a, c]);
  expect((await listAllArtefacts()).map((r) => r.id)).toEqual([b]);
});
