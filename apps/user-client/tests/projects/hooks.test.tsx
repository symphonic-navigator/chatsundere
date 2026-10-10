// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type ClientDataDb,
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { createProject, readText, writeText } from '../../src/projects/fs.js';
import { useProjectTree } from '../../src/projects/hooks.js';

let db: ClientDataDb;

beforeEach(async () => {
  await _resetClientDataDbForTests();
  db = await openClientDataDb();
});

describe('useProjectTree', () => {
  it('lists file metadata without reading a single content row', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/notes/plan.md', 'x');
    await writeText(p.id, '/top.md', 'y');
    let contentReads = 0;
    const reading = (obj: unknown) => {
      contentReads++;
      return obj;
    };
    db.projectContents.hook('reading', reading);
    try {
      const { result, unmount } = renderHook(() => useProjectTree(p.id));
      await waitFor(() => expect(result.current).toHaveLength(2));
      expect(result.current?.map((f) => f.path)).toEqual(['/notes/plan.md', '/top.md']);
      unmount();
      expect(contentReads).toBe(0);

      // Positive control: the counter does see a content read.
      await readText(p.id, '/top.md');
      expect(contentReads).toBeGreaterThan(0);
    } finally {
      db.projectContents.hook('reading').unsubscribe(reading);
    }
  });
});
