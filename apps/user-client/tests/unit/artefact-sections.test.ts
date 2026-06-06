// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from 'vitest';
import type { ArtefactRow } from '../../src/boot/client-data-db.js';
import { buildArtefactSections } from '../../src/lib/artefact-sections.js';

const mk = (id: string, fav: boolean, t: number): ArtefactRow => ({
  id,
  chatId: 'c1',
  personaId: 'p1',
  projectId: null,
  origin: 'generated',
  kind: 'text',
  format: 'html',
  title: id,
  fileName: `${id}.html`,
  mime: 'text/html',
  content: '',
  tags: [],
  favourite: fav,
  createdAt: t,
  updatedAt: t,
});

test('favourites section = starred; inChat = all newest-first', () => {
  const rows = [mk('a', false, 1), mk('b', true, 3), mk('c', false, 2)];
  const s = buildArtefactSections(rows);
  expect(s.favourites.map((r) => r.id)).toEqual(['b']);
  expect(s.inChat.map((r) => r.id)).toEqual(['b', 'c', 'a']);
});
