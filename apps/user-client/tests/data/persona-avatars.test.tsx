// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import {
  usePersonaAvatar,
  useRemovePersonaAvatar,
  useSetPersonaAvatar,
} from '../../src/data/persona-avatars.js';

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('persona avatars', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('set, read, and remove an avatar', async () => {
    const set = renderHook(() => useSetPersonaAvatar(), { wrapper });
    await set.result.current.mutateAsync({
      personaId: 'p1',
      blob: new Blob(['x'], { type: 'image/webp' }),
      mime: 'image/webp',
      width: 100,
      height: 100,
      crop: { x: 0, y: 0, zoom: 1 },
    });

    const read = renderHook(() => usePersonaAvatar('p1'), { wrapper });
    await waitFor(() => expect(read.result.current.data).not.toBeNull());

    const rem = renderHook(() => useRemovePersonaAvatar(), { wrapper });
    await rem.result.current.mutateAsync('p1');
    // WS-D §4 terminality trap: removal keeps the row (bytes cleared, blobRef
    // null), never deletes it — so avatar sync for this personaId is never bricked.
    const removed = await getClientDataDb().personaAvatars.get('p1');
    expect(removed).toBeDefined();
    expect(removed?.blob).toBeUndefined();
    expect(removed?.blobRef).toBeNull();
  });
});
