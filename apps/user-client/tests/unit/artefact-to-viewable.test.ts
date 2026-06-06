// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from 'vitest';
import type { ArtefactRow } from '../../src/boot/client-data-db.js';
import { artefactToViewable } from '../../src/components/lightbox/viewable-item.js';

const row: ArtefactRow = {
  id: 'a1',
  chatId: 'c1',
  personaId: 'p1',
  projectId: null,
  origin: 'generated',
  kind: 'text',
  format: 'html',
  title: 'Calc',
  fileName: 'calc.html',
  mime: 'text/html',
  content: '<x>',
  tags: [],
  favourite: false,
  createdAt: 0,
  updatedAt: 0,
};

test('maps an artefact row to a viewable with generated caps + title', () => {
  const v = artefactToViewable(row);
  expect(v).toMatchObject({
    id: 'a1',
    kind: 'text',
    fileName: 'calc.html',
    title: 'Calc',
    text: '<x>',
  });
  expect(v.caps).toEqual({
    rename: true,
    remove: false,
    copy: true,
    download: true,
    delete: true,
    editSource: true,
    editTags: true,
  });
});

test('artefactToViewable carries tags and enables editTags; attachments do not', async () => {
  const { artefactToViewable } = await import('../../src/components/lightbox/viewable-item.js');
  const v = artefactToViewable({
    id: 'a',
    chatId: 'c',
    personaId: 'p',
    projectId: null,
    origin: 'generated',
    kind: 'text',
    format: 'html',
    title: 'T',
    fileName: 't.html',
    mime: 'text/html',
    content: '<x>',
    tags: ['demo'],
    favourite: false,
    createdAt: 0,
    updatedAt: 0,
  });
  expect(v.tags).toEqual(['demo']);
  expect(v.caps.editTags).toBe(true);
});
