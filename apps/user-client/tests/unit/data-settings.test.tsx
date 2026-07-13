// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { useSettings, useUpdateSettings } from '../../src/data/settings.js';

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('useSettings + useUpdateSettings', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('returns the seeded singleton settings row', async () => {
    const { result } = renderHook(() => useSettings(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.globalInstructions).toBe('');
  });

  it('persists user updates and invalidates the query', async () => {
    const Wrapper = wrapper();
    const settings = renderHook(() => useSettings(), { wrapper: Wrapper });
    const mut = renderHook(() => useUpdateSettings(), { wrapper: Wrapper });
    await waitFor(() => expect(settings.result.current.data).toBeDefined());
    await act(async () => {
      await mut.result.current.mutateAsync({ globalInstructions: 'unlocked' });
    });
    await waitFor(() => {
      expect(settings.result.current.data?.globalInstructions).toBe('unlocked');
    });
  });

  it('clears an orphaned legacy corsProxy on load and persists the clear', async () => {
    // Dead since the relay cut 94bdcdd6 (see settings.ts) — a pre-cut row can
    // still carry a sealed sharedKey blob. It is unreadable ciphertext, never
    // read by anything post-cut, but must not linger in IndexedDB forever.
    const legacyCorsProxy = {
      url: 'https://relay.example.invalid/proxy',
      sharedKey: {
        version: 1 as const,
        ciphertext: new Uint8Array([1, 2, 3, 4]),
        nonce: new Uint8Array([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
      },
    };
    await getClientDataDb().settings.update(1, { corsProxy: legacyCorsProxy });

    const { result } = renderHook(() => useSettings(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.corsProxy).toBeNull();

    // Write-back: re-reading the raw row directly (bypassing the query
    // cache) must also show the cleared value, so it doesn't re-clear (and
    // re-run the write) on every load.
    const raw = await getClientDataDb().settings.get(1);
    expect(raw?.corsProxy).toBeNull();
  });
});
