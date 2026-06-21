// SPDX-License-Identifier: AGPL-3.0-only
import type { Offering } from '@chatsundere/llm-unified';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type PersonaRow,
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../../src/boot/client-data-db.js';
import { Cockpit } from '../../../src/components/chat/Cockpit.js';
import { idleDictationStub } from '../../helpers/dictation-stub.js';

// ── Module mocks ──────────────────────────────────────────────────────────────
// Cockpit pulls in many Dexie/TanStack Query data hooks. Mock the modules so
// the test does not require a running DB or a fully-wired provider tree.

vi.mock('../../../src/data/attachments.js', () => ({
  usePendingAttachments: () => ({ data: [] }),
  usePendingDocumentContents: () => ({ data: undefined }),
  useRemoveAttachment: () => ({ mutate: vi.fn() }),
  useRenameAttachment: () => ({ mutate: vi.fn() }),
  useUpdateAttachmentText: () => ({ mutate: vi.fn() }),
  addAttachment: vi.fn(),
}));

vi.mock('../../../src/data/knowledge.js', () => ({
  useFilteredLibraries: () => ({ data: [] }),
}));

vi.mock('../../../src/data/chats.js', () => ({
  useChat: () => ({ data: undefined }),
  useSetChatLibraries: () => ({ mutate: vi.fn() }),
}));

vi.mock('../../../src/data/settings.js', () => ({
  useSettings: () => ({ data: undefined }),
}));

vi.mock('../../../src/lib/use-active-search-tiers.js', () => ({
  useActiveSearchTiers: () => [],
}));

vi.mock('../../../src/lib/use-dismiss-on-outside.js', () => ({
  useDismissOnOutside: () => {},
}));

vi.mock('../../../src/knowledge/effective-libraries.js', () => ({
  computeEffectiveLibraries: () => [],
}));

vi.mock('../../../src/attachments/file-classify.js', () => ({
  classifyFile: () => ({ ok: false, reason: 'unsupported' }),
}));

vi.mock('../../../src/attachments/image-normalise.js', () => ({
  normaliseImageForLlm: vi.fn(),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const persona = { id: 'p1', name: 'Fable', useMemory: true } as unknown as PersonaRow;

const offering = {
  context: { recommended: 128_000, max: 128_000 },
  profile: { reasoning: { mode: 'none' } },
} as unknown as Offering;

function renderCockpit() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/app/chat/c1']}>
        <Routes>
          <Route
            path="/app/chat/:chatId"
            element={
              <Cockpit
                persona={persona}
                chatId="c1"
                offering={offering}
                draftValue=""
                onDraftChange={() => {}}
                onSend={() => {}}
                onStop={() => {}}
                isStreamLive={false}
                onOpenToc={() => {}}
                onOpenArtefacts={() => {}}
                autoReadAloud={false}
                onToggleAutoRead={() => {}}
                voiceUnavailable={null}
                dictation={idleDictationStub}
              />
            }
          />
          <Route
            path="/app/persona/:id/memory"
            element={<div data-testid="memory-sentinel">memory</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

describe('Cockpit memory button', () => {
  it('navigates to the persona memory page with the chat id', async () => {
    renderCockpit();
    fireEvent.click(screen.getByRole('button', { name: /chat memory/i }));
    expect(await screen.findByTestId('memory-sentinel')).toBeInTheDocument();
  });
});
