// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { addSavedCodeBlockArtefact, addSavedMessageArtefact } from '../../src/data/artefacts.js';

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

test('addSavedMessageArtefact stores a markdown row with .md filename', async () => {
  const id = await addSavedMessageArtefact({
    chatId: 'c1',
    personaId: 'p1',
    title: 'A great answer',
    content: '# Heading\n\nbody',
  });
  const row = await openClientDataDb().then((db) => db.artefacts.get(id));
  expect(row).toMatchObject({
    chatId: 'c1',
    personaId: 'p1',
    origin: 'saved-message',
    kind: 'text',
    format: 'markdown',
    title: 'A great answer',
    fileName: 'a-great-answer.md',
    mime: 'text/markdown',
    content: '# Heading\n\nbody',
    favourite: false,
  });
  expect(row?.tags).toEqual([]);
});

test('addSavedCodeBlockArtefact derives format/mime/ext from the language', async () => {
  const htmlId = await addSavedCodeBlockArtefact({
    chatId: 'c1',
    personaId: 'p1',
    title: 'Widget',
    content: '<button>hi</button>',
    lang: 'html',
  });
  const pyId = await addSavedCodeBlockArtefact({
    chatId: 'c1',
    personaId: 'p1',
    title: 'Solver',
    content: 'print(1)',
    lang: 'python',
  });
  const mermaidId = await addSavedCodeBlockArtefact({
    chatId: 'c1',
    personaId: 'p1',
    title: 'Flow',
    content: 'graph TD; A-->B',
    lang: 'mermaid',
  });
  const db = await openClientDataDb();
  expect(await db.artefacts.get(htmlId)).toMatchObject({
    origin: 'saved-code-block',
    format: 'html',
    mime: 'text/html',
    fileName: 'widget.html',
  });
  expect(await db.artefacts.get(pyId)).toMatchObject({
    origin: 'saved-code-block',
    format: 'code',
    fileName: 'solver.py',
  });
  expect(await db.artefacts.get(mermaidId)).toMatchObject({
    origin: 'saved-code-block',
    format: 'mermaid',
    mime: 'text/plain',
    fileName: 'flow.mmd',
  });
});
