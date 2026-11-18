// SPDX-License-Identifier: AGPL-3.0-only
import type { Offering } from '@chatsundere/llm-unified';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AttachmentRow, PersonaRow } from '../../../src/boot/client-data-db.js';
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
  useUpdateChat: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('../../../src/data/settings.js', () => ({
  useSettings: () => ({ data: undefined }),
  useUpdateSettings: () => ({ mutateAsync: vi.fn() }),
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

const persona = {
  id: 'p1',
  name: 'Fable',
  colour: '#a855f7',
  font: 'serif',
  contextWindow: 128_000,
  libraryIds: [],
  instructions: '',
  adultPersona: false,
  chatsundereTonality: true,
  tagline: '',
  canonicalId: null,
  providerId: 'chutes',
  modelId: 'fable',
  mindspaceId: null,
  aboutMeOverride: null,
  textureOverride: null,
  temperature: 0.85,
  createdAt: 1,
  updatedAt: 1,
  askExpertDefault: false,
} as unknown as PersonaRow;

const offering = {
  canonicalRef: 'glm-5.1',
  providerId: 'chutes',
  upstreamSlug: 'zai-org/GLM-5.1',
  context: { recommended: 128_000, max: 128_000 },
  profile: { reasoning: { mode: 'none' } },
} as unknown as Offering;

function makeQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

const baseProps = {
  chatId: 'chat-1',
  persona,
  offering,
  draftValue: '',
  onDraftChange: vi.fn(),
  onSend: vi.fn(),
  onStop: vi.fn(),
  isStreamLive: false,
  dictation: idleDictationStub,
  // Voice-mode defaults — overridden per test case below.
  autoReadAloud: false as boolean,
  onToggleAutoRead: vi.fn() as (next: boolean) => void,
  voiceUnavailable: null as 'no-provider' | 'no-voice' | 'voices-unavailable' | null,
  onEnterLiveVoice: vi.fn() as () => void,
  onRecheckVoice: vi.fn(async () => {}) as () => Promise<void>,
  editingMessageId: null as string | null,
  canReplace: false,
  editAttachments: [] as AttachmentRow[],
  onReplace: vi.fn(),
  onBranchEdit: vi.fn(),
  onCancelEdit: vi.fn(),
};

const CHAT = '/app/chat/chat-1?x=1';
const enc = encodeURIComponent(CHAT);

function Where(): JSX.Element {
  const l = useLocation();
  return <div data-testid="where">{`${l.pathname}${l.search}`}</div>;
}

function renderCockpit(extra: Partial<typeof baseProps>) {
  const qc = makeQc();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[CHAT]}>
        <Routes>
          <Route path="/app/chat/:chatId" element={<Cockpit {...baseProps} {...extra} />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function openMenu(extra: Partial<typeof baseProps> = {}) {
  const r = renderCockpit(extra);
  fireEvent.click(r.getByLabelText('Open chat menu'));
  return r;
}

describe('cockpit menu — model row (spec 0.5.0 papercuts, item 5)', () => {
  it('names the offering and its provider', () => {
    openMenu();
    const row = document.querySelector('[data-section="model"]');
    expect(row?.textContent).toContain('GLM 5.1 · Chutes');
  });

  it('falls back to the upstream slug for an offering without a canonical', () => {
    openMenu({ offering: { ...offering, canonicalRef: null } as unknown as Offering });
    const row = document.querySelector('[data-section="model"]');
    expect(row?.textContent).toContain('zai-org/GLM-5.1 · Chutes');
  });

  it('"change on the persona ›" opens the hub at #model with the chat as return', () => {
    openMenu();
    const link = screen.getByRole('menuitem', { name: /change on the persona/i });
    expect(link).toHaveAttribute('href', `/app/persona/p1?return=${enc}#model`);
    fireEvent.click(link);
    expect(screen.getByTestId('where').textContent).toBe(`/app/persona/p1?return=${enc}`);
  });
});
