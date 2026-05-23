// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
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
    expect(result.current.data?.userFont).toBe('serif');
    expect(result.current.data?.globalUnlockerPrompt).toBe('');
  });

  it('persists user updates and invalidates the query', async () => {
    const Wrapper = wrapper();
    const settings = renderHook(() => useSettings(), { wrapper: Wrapper });
    const mut = renderHook(() => useUpdateSettings(), { wrapper: Wrapper });
    await waitFor(() => expect(settings.result.current.data).toBeDefined());
    await act(async () => {
      await mut.result.current.mutateAsync({ globalUnlockerPrompt: 'unlocked' });
    });
    await waitFor(() => {
      expect(settings.result.current.data?.globalUnlockerPrompt).toBe('unlocked');
    });
  });
});
