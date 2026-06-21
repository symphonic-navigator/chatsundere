// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import 'fake-indexeddb/auto';
import { MemoryRouter } from 'react-router-dom';
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
      <MemoryRouter>
        <MemorySection personaId="p1" useMemory={true} memoryInstructions="" onChange={onChange} />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: /memory/i }));
    expect(onChange).toHaveBeenCalledWith({ useMemory: false });
  });

  it('shows the not-yet-saved hint when personaId is null', () => {
    wrap(
      <MemoryRouter>
        <MemorySection
          personaId={null}
          useMemory={true}
          memoryInstructions=""
          onChange={() => {}}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/available after you save/i)).toBeInTheDocument();
  });

  it('shows a Manage memory link for a saved persona', () => {
    wrap(
      <MemoryRouter>
        <MemorySection personaId="p1" useMemory={true} memoryInstructions="" onChange={() => {}} />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: /manage memory/i });
    expect(link).toHaveAttribute('href', '/app/persona/p1/memory');
  });

  it('does not show Manage memory link for an unsaved persona', () => {
    wrap(
      <MemoryRouter>
        <MemorySection
          personaId={null}
          useMemory={true}
          memoryInstructions=""
          onChange={() => {}}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link', { name: /manage memory/i })).not.toBeInTheDocument();
  });
});
