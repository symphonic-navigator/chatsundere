// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { useCredential } from '../../src/credentials/use-credential.js';
import { useDeleteProvider, useUpsertProvider } from '../../src/data/providers.js';

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const DUMMY_BLOB = {
  ciphertext: new Uint8Array([1]),
  nonce: new Uint8Array([2]),
  version: 1 as const,
};

describe('useCredential', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('reflects presence reactively across upsert and delete', async () => {
    const W = wrapper();
    const cred = renderHook(() => useCredential('nano-gpt'), { wrapper: W });
    const upsert = renderHook(() => useUpsertProvider(), { wrapper: W });
    const del = renderHook(() => useDeleteProvider(), { wrapper: W });

    await waitFor(() => expect(cred.result.current.present).toBe(false));

    let id = '';
    await act(async () => {
      const r = await upsert.result.current.mutateAsync({
        templateId: 'nano-gpt',
        apiKey: DUMMY_BLOB,
        enabled: true,
      });
      id = r.id;
    });
    await waitFor(() => expect(cred.result.current.present).toBe(true));

    await act(async () => {
      await del.result.current.mutateAsync(id);
    });
    await waitFor(() => expect(cred.result.current.present).toBe(false));
  });

  it('reports false for a disabled provider', async () => {
    const W = wrapper();
    const cred = renderHook(() => useCredential('nano-gpt'), { wrapper: W });
    const upsert = renderHook(() => useUpsertProvider(), { wrapper: W });

    await act(async () => {
      await upsert.result.current.mutateAsync({
        templateId: 'nano-gpt',
        apiKey: DUMMY_BLOB,
        enabled: false,
      });
    });
    await waitFor(() => expect(cred.result.current.isLoading).toBe(false));
    expect(cred.result.current.present).toBe(false);
  });
});
