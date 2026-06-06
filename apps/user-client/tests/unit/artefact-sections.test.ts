// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from 'vitest';
import type { ArtefactRow } from '../../src/boot/client-data-db.js';
import { buildArtefactSections, formatGlyph } from '../../src/lib/artefact-sections.js';

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

test('formatGlyph distinguishes image-family formats from html', () => {
  expect(formatGlyph('html').cls).toBe('g-html');
  expect(formatGlyph('markdown').cls).toBe('g-md');
  expect(formatGlyph('code').cls).toBe('g-code');
  expect(formatGlyph('image').cls).toBe('g-img');
  expect(formatGlyph('svg').cls).toBe('g-img');
  expect(formatGlyph('mermaid').cls).toBe('g-img');
});

test('favourites section = starred; inChat = all newest-first', () => {
  const rows = [mk('a', false, 1), mk('b', true, 3), mk('c', false, 2)];
  const s = buildArtefactSections(rows);
  expect(s.favourites.map((r) => r.id)).toEqual(['b']);
  expect(s.inChat.map((r) => r.id)).toEqual(['b', 'c', 'a']);
});
