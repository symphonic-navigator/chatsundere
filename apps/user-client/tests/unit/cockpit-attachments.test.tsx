// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db';
import { Cockpit } from '../../src/components/chat/Cockpit';
import { listPendingAttachments } from '../../src/data/attachments';
import { idleDictationStub } from '../helpers/dictation-stub';

// Normalisation needs a real canvas; stub it so the cockpit flow is testable in jsdom.
vi.mock('../../src/attachments/image-normalise', () => ({
  normaliseImageForLlm: vi
    .fn()
    .mockResolvedValue({ blob: new Blob(['j'], { type: 'image/jpeg' }), width: 10, height: 10 }),
  MAX_EDGE: 1024,
}));

function wrap(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}
const persona = { id: 'p', name: 'Aurum', font: 'serif', libraryIds: [] } as never;
const offering = { profile: { vision: true } } as never;

beforeEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
  await openClientDataDb();
});

describe('Cockpit attachments', () => {
  it('adds an image via the (+) file input', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <Cockpit
        chatId="c1"
        persona={persona}
        offering={offering}
        draftValue=""
        onDraftChange={() => {}}
        onSend={() => {}}
        onStop={() => {}}
        isStreamLive={false}
        dictation={idleDictationStub}
        autoReadAloud={false}
        onToggleAutoRead={() => {}}
        voiceUnavailable={null}
        editingMessageId={null}
        canReplace={false}
        editAttachments={[]}
        onReplace={() => {}}
        onBranchEdit={() => {}}
        onCancelEdit={() => {}}
      />,
      { wrapper: wrap(qc) },
    );
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    const file = new File([new Uint8Array(10)], 'a.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    await waitFor(async () => expect(await listPendingAttachments('c1')).toHaveLength(1));
  });

  it('the (+) button is enabled (no longer the disabled stub)', () => {
    const qc = new QueryClient();
    const { container } = render(
      <Cockpit
        chatId="c1"
        persona={persona}
        offering={offering}
        draftValue=""
        onDraftChange={() => {}}
        onSend={() => {}}
        onStop={() => {}}
        isStreamLive={false}
        dictation={idleDictationStub}
        autoReadAloud={false}
        onToggleAutoRead={() => {}}
        voiceUnavailable={null}
        editingMessageId={null}
        canReplace={false}
        editAttachments={[]}
        onReplace={() => {}}
        onBranchEdit={() => {}}
        onCancelEdit={() => {}}
      />,
      { wrapper: wrap(qc) },
    );
    expect((container.querySelector('[data-control="plus"]') as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});
