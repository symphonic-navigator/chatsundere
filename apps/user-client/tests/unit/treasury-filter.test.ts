// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from 'vitest';
import type { ArtefactRow } from '../../src/boot/client-data-db.js';
import {
  type TreasuryFilters,
  applyTreasuryFilters,
  artefactSize,
  collectTags,
  formatBytes,
  formatToType,
  normaliseTags,
} from '../../src/lib/treasury-filter.js';

function row(p: Partial<ArtefactRow>): ArtefactRow {
  return {
    id: 'id',
    chatId: 'c1',
    personaId: 'p1',
    projectId: null,
    origin: 'generated',
    kind: 'text',
    format: 'html',
    title: 'Untitled',
    fileName: 'untitled.html',
    mime: 'text/html',
    content: '',
    tags: [],
    favourite: false,
    createdAt: 0,
    updatedAt: 0,
    ...p,
  };
}

test('formatToType maps every format into the four type buckets', () => {
  expect(formatToType('html')).toBe('app');
  expect(formatToType('markdown')).toBe('doc');
  expect(formatToType('code')).toBe('code');
  expect(formatToType('svg')).toBe('image');
  expect(formatToType('mermaid')).toBe('image');
  expect(formatToType('image')).toBe('image');
});

test('normaliseTags trims, lowercases, drops empties and dedupes', () => {
  expect(normaliseTags([' Demo ', 'demo', 'PROD', ''])).toEqual(['demo', 'prod']);
});

test('artefactSize counts UTF-8 bytes of text content; formatBytes is human', () => {
  expect(artefactSize(row({ content: 'abc' }))).toBe(3);
  expect(artefactSize(row({ content: 'é' }))).toBe(2); // 2 UTF-8 bytes
  expect(formatBytes(0)).toBe('0 B');
  expect(formatBytes(14_336)).toBe('14 KB');
  expect(formatBytes(1_572_864)).toBe('1.5 MB');
});

test('collectTags returns a sorted unique union across rows', () => {
  const rows = [row({ tags: ['z', 'a'] }), row({ tags: ['a', 'm'] })];
  expect(collectTags(rows)).toEqual(['a', 'm', 'z']);
});

test('applyTreasuryFilters: type tab narrows by derived type', () => {
  const rows = [row({ id: 'h', format: 'html' }), row({ id: 'm', format: 'markdown' })];
  const out = applyTreasuryFilters(rows, base({ type: 'doc' }));
  expect(out.map((r) => r.id)).toEqual(['m']);
});

test('applyTreasuryFilters: persona, favourite, all-tags-match, fuzzy name (case-insensitive)', () => {
  const rows = [
    row({ id: 'a', personaId: 'p1', favourite: true, tags: ['x', 'y'], title: 'Pomodoro Timer' }),
    row({ id: 'b', personaId: 'p2', favourite: false, tags: ['x'], title: 'Sorting' }),
  ];
  expect(applyTreasuryFilters(rows, base({ personaId: 'p1' })).map((r) => r.id)).toEqual(['a']);
  expect(applyTreasuryFilters(rows, base({ favourite: true })).map((r) => r.id)).toEqual(['a']);
  expect(applyTreasuryFilters(rows, base({ tags: ['x', 'y'] })).map((r) => r.id)).toEqual(['a']);
  expect(applyTreasuryFilters(rows, base({ query: 'POMODORO' })).map((r) => r.id)).toEqual(['a']);
});

test('applyTreasuryFilters sorts newest-first with id tiebreaker', () => {
  const rows = [
    row({ id: 'a1', createdAt: 5 }),
    row({ id: 'a3', createdAt: 5 }),
    row({ id: 'b', createdAt: 9 }),
  ];
  expect(applyTreasuryFilters(rows, base({})).map((r) => r.id)).toEqual(['b', 'a3', 'a1']);
});

function base(p: Partial<TreasuryFilters>): TreasuryFilters {
  return { type: 'all', personaId: null, tags: [], favourite: false, query: '', ...p };
}
