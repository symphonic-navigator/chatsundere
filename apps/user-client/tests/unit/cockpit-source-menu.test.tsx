// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db';
import { Cockpit } from '../../src/components/chat/Cockpit';

function wrap(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}
const persona = { id: 'p', name: 'Aurum', font: 'serif', libraryIds: [] } as never;
const offering = { profile: { vision: true } } as never;

beforeEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
  await openClientDataDb();
});

function renderCockpit(extra: Record<string, unknown> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <Cockpit
      chatId="c1"
      persona={persona}
      offering={offering}
      draftValue=""
      onDraftChange={() => {}}
      onSend={() => {}}
      isStreamLive={false}
      {...extra}
    />,
    { wrapper: wrap(qc) },
  );
}

describe('Cockpit (+) source menu', () => {
  it('opens a two-item menu when an attach handler is supplied', () => {
    const onAttachFromTreasury = vi.fn();
    const { container } = renderCockpit({ onAttachFromTreasury });
    fireEvent.click(container.querySelector('[data-control="plus"]') as HTMLElement);
    expect(container.querySelector('[data-source="upload"]')).toBeInTheDocument();
    expect(container.querySelector('[data-source="treasury"]')).toBeInTheDocument();
  });

  it('the Treasury item fires the handler and closes the menu', () => {
    const onAttachFromTreasury = vi.fn();
    const { container } = renderCockpit({ onAttachFromTreasury });
    fireEvent.click(container.querySelector('[data-control="plus"]') as HTMLElement);
    fireEvent.click(container.querySelector('[data-source="treasury"]') as HTMLElement);
    expect(onAttachFromTreasury).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-source="treasury"]')).not.toBeInTheDocument();
  });

  it('Escape closes the menu', () => {
    const { container } = renderCockpit({ onAttachFromTreasury: vi.fn() });
    fireEvent.click(container.querySelector('[data-control="plus"]') as HTMLElement);
    expect(container.querySelector('[data-source="upload"]')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(container.querySelector('[data-source="upload"]')).not.toBeInTheDocument();
  });

  it('without an attach handler, (+) opens no menu (back-compat)', () => {
    const { container } = renderCockpit();
    fireEvent.click(container.querySelector('[data-control="plus"]') as HTMLElement);
    expect(container.querySelector('[data-source="upload"]')).not.toBeInTheDocument();
  });
});
