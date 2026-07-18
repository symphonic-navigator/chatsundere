// SPDX-License-Identifier: AGPL-3.0-only
import type { Offering } from '@chatsundere/llm-unified';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
  voiceUnavailable: null as 'no-provider' | 'no-voice' | null,
  editingMessageId: null as string | null,
  canReplace: false,
  editAttachments: [] as AttachmentRow[],
  onReplace: vi.fn(),
  onBranchEdit: vi.fn(),
  onCancelEdit: vi.fn(),
};

function renderCockpit(extra: Partial<typeof baseProps>) {
  const qc = makeQc();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Cockpit {...baseProps} {...extra} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('cockpit voice-mode toggle', () => {
  it('reveals the disabled reason inline on tap (touch-reachable)', () => {
    const { getByLabelText, getByRole } = renderCockpit({
      autoReadAloud: false,
      voiceUnavailable: 'no-voice' as const,
      onToggleAutoRead: vi.fn(),
    });
    fireEvent.click(getByLabelText(/read replies aloud/i));
    // The inline note (role="status") must appear — touch-reachable, no hover needed.
    expect(getByRole('status')).toBeTruthy();
  });

  it('toggles auto-read when a voice is available', () => {
    const onToggle = vi.fn();
    const { getByLabelText } = renderCockpit({
      autoReadAloud: false,
      voiceUnavailable: null,
      onToggleAutoRead: onToggle,
    });
    fireEvent.click(getByLabelText(/read replies aloud/i));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('shows the provider-specific reason for no-provider', () => {
    const { getByLabelText, getByText } = renderCockpit({
      autoReadAloud: false,
      voiceUnavailable: 'no-provider' as const,
      onToggleAutoRead: vi.fn(),
    });
    fireEvent.click(getByLabelText(/read replies aloud/i));
    expect(getByText(/set up a voice provider/i)).toBeTruthy();
  });
});
