// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { MemorySection } from '../../src/components/persona-editor/MemorySection.js';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

describe('MemorySection', () => {
  it('toggles useMemory via onChange', async () => {
    const onChange = vi.fn();
    wrap(
      <MemorySection personaId="p1" useMemory={true} memoryInstructions="" onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /memory/i }));
    expect(onChange).toHaveBeenCalledWith({ useMemory: false });
  });

  it('shows the not-yet-saved hint when personaId is null', () => {
    wrap(
      <MemorySection personaId={null} useMemory={true} memoryInstructions="" onChange={() => {}} />,
    );
    expect(screen.getByText(/available after you save/i)).toBeInTheDocument();
  });
});
