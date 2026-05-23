// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { useDeleteProvider, useProviders, useUpsertProvider } from '../../src/data/providers.js';

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('useProviders + upsert/delete', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('returns an empty list initially and persists upserts', async () => {
    const W = wrapper();
    const list = renderHook(() => useProviders(), { wrapper: W });
    const upsert = renderHook(() => useUpsertProvider(), { wrapper: W });
    const del = renderHook(() => useDeleteProvider(), { wrapper: W });

    await waitFor(() => expect(list.result.current.data).toEqual([]));

    let id = '';
    await act(async () => {
      const r = await upsert.result.current.mutateAsync({
        templateId: 'nano-gpt',
        apiKey: { ciphertext: new Uint8Array([1]), nonce: new Uint8Array([2]), version: 1 },
        enabled: true,
      });
      id = r.id;
    });
    await waitFor(() => expect(list.result.current.data?.length).toBe(1));

    await act(async () => {
      await del.result.current.mutateAsync(id);
    });
    await waitFor(() => expect(list.result.current.data?.length).toBe(0));
  });
});
