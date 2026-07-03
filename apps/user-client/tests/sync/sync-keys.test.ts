// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { extractKeyFor, syncKeyOfRow } from '../../src/sync/sync-keys.js';

describe('sync-keys (§3.1)', () => {
  it('keys the settings singleton as the literal "1"', () => {
    expect(syncKeyOfRow('settings', { id: 1, displayName: 'x' })).toBe('1');
    expect(extractKeyFor('settings')({ id: 1, displayName: 'x' })).toBe('1');
  });

  it('keys a vectors chunk as documentId#chunkIndex', () => {
    const row = { documentId: 'doc-7', chunkIndex: 3, embedding: [] };
    expect(syncKeyOfRow('vectors', row)).toBe('doc-7#3');
    expect(extractKeyFor('vectors')(row)).toBe('doc-7#3');
  });

  it('keys personaAvatars by personaId', () => {
    const row = { personaId: 'p-42', blob: null };
    expect(syncKeyOfRow('personaAvatars', row)).toBe('p-42');
    expect(extractKeyFor('personaAvatars')(row)).toBe('p-42');
  });

  it('keys every other collection by row.id', () => {
    for (const collection of ['personas', 'chats', 'messages', 'documents'] as const) {
      const row = { id: `${collection}-uuid`, updatedAt: 1 };
      expect(syncKeyOfRow(collection, row)).toBe(`${collection}-uuid`);
      expect(extractKeyFor(collection)(row)).toBe(`${collection}-uuid`);
    }
  });

  it('agrees in both directions for the same row', () => {
    const cases: Array<[Parameters<typeof syncKeyOfRow>[0], unknown]> = [
      ['settings', { id: 1 }],
      ['vectors', { documentId: 'd', chunkIndex: 9 }],
      ['personaAvatars', { personaId: 'pa' }],
      ['libraries', { id: 'lib-1' }],
    ];
    for (const [collection, row] of cases) {
      expect(extractKeyFor(collection)(row)).toBe(syncKeyOfRow(collection, row));
    }
  });
});
