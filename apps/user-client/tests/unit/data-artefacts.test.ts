// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import {
  addGeneratedArtefact,
  deleteArtefact,
  listChatArtefacts,
  renameArtefact,
  setArtefactFavourite,
  updateArtefactContent,
} from '../../src/data/artefacts.js';

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

test('addGeneratedArtefact stores a generated html row with a derived filename', async () => {
  const id = await addGeneratedArtefact({
    chatId: 'c1',
    personaId: 'p1',
    title: 'My Calculator!',
    content: '<!doctype html>…',
  });
  const row = await openClientDataDb().then((db) => db.artefacts.get(id));
  expect(row).toMatchObject({
    chatId: 'c1',
    personaId: 'p1',
    origin: 'generated',
    kind: 'text',
    format: 'html',
    title: 'My Calculator!',
    fileName: 'my-calculator.html',
    mime: 'text/html',
    favourite: false,
  });
  expect(row?.tags).toEqual([]);
});

test('rename edits title and fileName independently; content + favourite mutate', async () => {
  const id = await addGeneratedArtefact({
    chatId: 'c1',
    personaId: 'p1',
    title: 'A',
    content: 'x',
  });
  await renameArtefact(id, { title: 'B', fileName: 'b.html' });
  await updateArtefactContent(id, 'y');
  await setArtefactFavourite(id, true);
  const row = await openClientDataDb().then((db) => db.artefacts.get(id));
  expect(row).toMatchObject({ title: 'B', fileName: 'b.html', content: 'y', favourite: true });
});

test('listChatArtefacts returns this chat, newest first; delete removes', async () => {
  const a = await addGeneratedArtefact({ chatId: 'c1', personaId: 'p1', title: 'A', content: 'x' });
  const b = await addGeneratedArtefact({ chatId: 'c1', personaId: 'p1', title: 'B', content: 'x' });
  await addGeneratedArtefact({ chatId: 'c2', personaId: 'p1', title: 'C', content: 'x' });
  const list = await listChatArtefacts('c1');
  expect(list.map((r) => r.id)).toEqual([b, a]);
  await deleteArtefact(a);
  expect((await listChatArtefacts('c1')).map((r) => r.id)).toEqual([b]);
});
