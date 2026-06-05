// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../../src/boot/client-data-db.js';
import { SubstituteVisionSetting } from '../../../src/routes/app/settings.js';

function wrap(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('SubstituteVisionSetting', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests({ keepData: false });
    await openClientDataDb();
  });

  it('renders a combobox with at least a None option and vision-capable offerings', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { getByRole } = render(<SubstituteVisionSetting />, { wrapper: wrap(qc) });
    const select = (await waitFor(() => getByRole('combobox'))) as HTMLSelectElement;
    // "None" is always the first option.
    expect(select.options[0]?.value).toBe('');
    expect(select.options[0]?.text).toBe('None');
    // Built-in providers include vision-capable offerings (e.g. xAI grok-4.3).
    expect(select.options.length).toBeGreaterThan(1);
  });
});
