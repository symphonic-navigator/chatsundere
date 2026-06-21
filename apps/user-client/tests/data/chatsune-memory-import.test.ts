// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { importChatsuneMemory } from '../../src/data/chatsune-import.js';
import { getCurrentBody, listJournal } from '../../src/memory/repo.js';

const MEMORY = {
  journal_entries: [
    {
      content: 'Likes tea',
      category: 'preference',
      state: 'committed',
      is_correction: false,
      created_at: '2026-01-01T00:00:00Z',
      committed_at: '2026-01-02T00:00:00Z',
      auto_committed: true,
    },
    {
      content: 'Has a sister',
      category: 'fact',
      state: 'uncommitted',
      is_correction: false,
      created_at: '2026-01-03T00:00:00Z',
    },
    {
      content: 'Old archived fact',
      category: 'fact',
      state: 'archived',
      is_correction: false,
      created_at: '2025-12-01T00:00:00Z',
    },
  ],
  memory_bodies: [
    {
      content: 'Body v1',
      token_count: 2,
      version: 1,
      entries_processed: 1,
      created_at: '2026-01-01T00:00:00Z',
    },
    {
      content: 'Body v2',
      token_count: 2,
      version: 2,
      entries_processed: 2,
      created_at: '2026-01-02T00:00:00Z',
    },
  ],
};

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  await getClientDataDb().personas.add({ id: 'p1', name: 'P', providerId: 'pr' } as never);
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

describe('importChatsuneMemory', () => {
  it('imports non-archived entries + all bodies, preserving state', async () => {
    const res = await importChatsuneMemory('p1', MEMORY);
    expect(res.importedEntries).toBe(2); // archived skipped
    expect(res.importedBodies).toBe(2);
    const committed = await listJournal('p1', 'committed');
    expect(committed[0]?.content).toBe('Likes tea');
    expect(committed[0]?.autoCommitted).toBe(true);
    expect(committed[0]?.importedFrom).toBe('chatsune');
    expect(committed[0]?.createdAt).toBe(Date.parse('2026-01-01T00:00:00Z'));
    expect(await listJournal('p1', 'uncommitted')).toHaveLength(1);
    expect(await listJournal('p1', 'archived')).toHaveLength(0);
    const body = await getCurrentBody('p1');
    expect(body?.content).toBe('Body v2'); // latest chatsune body is current
    expect(body?.source).toBe('import');
  });

  it('is idempotent: re-import adds nothing', async () => {
    await importChatsuneMemory('p1', MEMORY);
    const res = await importChatsuneMemory('p1', MEMORY);
    expect(res.importedEntries).toBe(0);
    expect(res.skippedEntries).toBe(2);
    expect(res.importedBodies).toBe(0);
    expect(await listJournal('p1', 'committed')).toHaveLength(1);
  });

  it('skips a journal entry whose text is already contained in the imported body prose', async () => {
    // The body contains the full prose of one of the live journal entries.
    // After the bodies loop the body is current, so the journal dedup must
    // detect the overlap and count the entry as skipped rather than inserting it.
    const memoryWithBodyOverlap = {
      journal_entries: [
        {
          content: 'enjoys hiking',
          category: 'preference' as const,
          state: 'committed',
          is_correction: false,
          created_at: '2026-02-01T00:00:00Z',
          committed_at: '2026-02-02T00:00:00Z',
          auto_committed: false,
        },
        {
          content: 'Plays chess',
          category: 'hobby' as const,
          state: 'uncommitted',
          is_correction: false,
          created_at: '2026-02-03T00:00:00Z',
        },
      ],
      memory_bodies: [
        {
          // The body prose deliberately contains the normalised form of the
          // first journal entry so that entry must be skipped.
          content: 'The user enjoys hiking on weekends.',
          token_count: 7,
          version: 1,
          entries_processed: 1,
          created_at: '2026-02-01T00:00:00Z',
        },
      ],
    };

    const res = await importChatsuneMemory('p1', memoryWithBodyOverlap);
    // Body imported successfully.
    expect(res.importedBodies).toBe(1);
    // 'enjoys hiking' is contained in the body → skipped; 'Plays chess' is not → imported.
    expect(res.importedEntries).toBe(1);
    expect(res.skippedEntries).toBe(1);
    // Confirm only the non-overlapping entry landed in the journal.
    const allEntries = [
      ...(await listJournal('p1', 'committed')),
      ...(await listJournal('p1', 'uncommitted')),
    ];
    expect(allEntries.map((e) => e.content)).not.toContain('enjoys hiking');
    expect(allEntries.map((e) => e.content)).toContain('Plays chess');
  });
});
