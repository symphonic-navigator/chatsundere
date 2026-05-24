// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import {
  useCreatePersona,
  useDeletePersona,
  usePersonas,
  useUpdatePersona,
} from '../../src/data/personas.js';

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('usePersonas + CUD mutations', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('starts empty, supports create, update, delete', async () => {
    const W = wrapper();
    const list = renderHook(() => usePersonas(), { wrapper: W });
    const create = renderHook(() => useCreatePersona(), { wrapper: W });
    const update = renderHook(() => useUpdatePersona(), { wrapper: W });
    const del = renderHook(() => useDeletePersona(), { wrapper: W });

    await waitFor(() => expect(list.result.current.data).toEqual([]));

    let createdId = '';
    await act(async () => {
      const created = await create.result.current.mutateAsync({
        name: 'Aurum',
        tagline: 'quiet sparring',
        colour: '#c9a84c',
        font: 'serif',
        instructions: 'be present',
        providerId: 'nano-gpt-row',
        modelId: 'deepseek-v4-flash',
        mindspaceId: null,
        aboutMeOverride: null,
        textureOverride: null,
        temperature: 0.85,
        adultPersona: false,
      });
      createdId = created.id;
    });
    await waitFor(() => expect(list.result.current.data?.length).toBe(1));

    await act(async () => {
      await update.result.current.mutateAsync({ id: createdId, patch: { tagline: 'updated' } });
    });
    await waitFor(() => expect(list.result.current.data?.[0]?.tagline).toBe('updated'));

    await act(async () => {
      await del.result.current.mutateAsync(createdId);
    });
    await waitFor(() => expect(list.result.current.data?.length).toBe(0));
  });
});
