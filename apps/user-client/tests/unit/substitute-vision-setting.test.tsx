// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db';
import { SubstituteVisionSetting } from '../../src/routes/app/settings';

function wrap(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
  await openClientDataDb();
});

describe('SubstituteVisionSetting', () => {
  it('writes the chosen offering ref to settings.substituteVisionModel', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { getByRole } = render(<SubstituteVisionSetting />, { wrapper: wrap(qc) });
    const select = (await waitFor(() => getByRole('combobox'))) as HTMLSelectElement;
    // The first real vision-capable option (depends on the seeded built-ins).
    await act(async () => {
      fireEvent.change(select, { target: { value: select.options[1]?.value } });
    });
    await waitFor(async () => {
      const row = await getClientDataDb().settings.get(1);
      expect(row?.substituteVisionModel).toBe(select.options[1]?.value);
    });
  });
});
