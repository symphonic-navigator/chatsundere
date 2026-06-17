// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { beforeEach, expect, test } from 'vitest';
import {
  type ArtefactRow,
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

beforeEach(async () => {
  await _resetClientDataDbForTests();
});

test('schema is at version 13 and exposes the artefacts table', async () => {
  const db = await openClientDataDb();
  expect(db.verno).toBe(26);
  expect(db.tables.map((t) => t.name)).toContain('artefacts');
  const row: ArtefactRow = {
    id: 'a1',
    chatId: 'c1',
    personaId: 'p1',
    projectId: null,
    origin: 'generated',
    kind: 'text',
    format: 'html',
    title: 'Calculator',
    fileName: 'calculator.html',
    mime: 'text/html',
    content: '<!doctype html><title>x</title>',
    tags: [],
    favourite: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await db.artefacts.add(row);
  expect(await db.artefacts.get('a1')).toMatchObject({ id: 'a1', chatId: 'c1', format: 'html' });
  expect(await db.artefacts.where('chatId').equals('c1').count()).toBe(1);
});
