// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { useAccountLinkStore, useConnectivityStore, useSessionStore } from '@chatsundere/ui-shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { useDeleteProvider, useProviders, useUpsertProvider } from '../../src/data/providers.js';
import { setImmediateDrain } from '../../src/sync/enqueue.js';

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
    useAccountLinkStore.setState({ linkStatus: 'local-only', baseUrl: null });
    setImmediateDrain(async () => undefined);
  });
  afterEach(async () => {
    setImmediateDrain(async () => undefined);
    useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
    useConnectivityStore.setState({ state: { kind: 'local_offline' } });
    useSessionStore.setState({ mk: null });
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
        keySlot: 'nano-gpt',
      });
      id = r.id;
    });
    await waitFor(() => expect(list.result.current.data?.length).toBe(1));

    useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
    useConnectivityStore.setState({ state: { kind: 'linked_online' } });
    useSessionStore.setState({ mk: { key: 'fake-mk' } as never });
    await act(async () => {
      await del.result.current.mutateAsync(id);
    });
    await waitFor(() => expect(list.result.current.data?.length).toBe(0));

    // Removal is a reversible provider lifecycle update, not a terminal sync
    // tombstone: the deterministic row survives without credential material.
    expect(await getClientDataDb().providers.get(id)).toMatchObject({
      id: 'nano-gpt',
      apiKey: null,
      enabled: false,
    });
    expect(await getClientDataDb().syncOutbox.toArray()).toEqual([
      expect.objectContaining({ collection: 'providers', key: id, op: 'upsert' }),
    ]);
  });
});
