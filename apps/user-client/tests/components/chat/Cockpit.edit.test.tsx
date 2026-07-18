// SPDX-License-Identifier: AGPL-3.0-only
import type { Offering } from '@chatsundere/llm-unified';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttachmentRow, PersonaRow } from '../../../src/boot/client-data-db.js';
import { Cockpit } from '../../../src/components/chat/Cockpit.js';
import { useCurrentChatStore } from '../../../src/state/current-chat.store.js';
import { idleDictationStub } from '../../helpers/dictation-stub.js';

// ── Module mocks ──────────────────────────────────────────────────────────────
// Cockpit pulls in many Dexie/TanStack Query data hooks. Mock the modules so
// the test does not require a running DB or a fully-wired provider tree.
// Mirrors tests/components/chat/Cockpit.voicemode.test.tsx.

vi.mock('../../../src/data/attachments.js', () => ({
  usePendingAttachments: () => ({ data: [] }),
  usePendingDocumentContents: () => ({ data: undefined }),
  useRemoveAttachment: () => ({ mutate: vi.fn() }),
  useRenameAttachment: () => ({ mutate: vi.fn() }),
  useUpdateAttachmentText: () => ({ mutate: vi.fn() }),
  addAttachment: vi.fn(),
  // Real (pure) implementation — Cockpit's onRemove handler calls this
  // directly, and the removal-routing tests below assert its effect.
  attachmentRemovalRoute: (attachmentMessageId: string | null, editingMessageId: string | null) =>
    editingMessageId !== null && attachmentMessageId === editingMessageId ? 'stage' : 'delete',
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

describe('Cockpit edit mode', () => {
  afterEach(() => {
    useCurrentChatStore.getState().resetEditSession();
  });

  it('shows the last-message edit banner and the split send button', () => {
    renderCockpit({ editingMessageId: 'u9', canReplace: true, editAttachments: [] });
    expect(screen.getByText(/editing your message/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Replace message$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeTruthy();
  });

  it('shows the earlier-message branch foreshadow banner', () => {
    renderCockpit({ editingMessageId: 'u2', canReplace: false, editAttachments: [] });
    expect(screen.getByText(/earlier message.*start a new branch/i)).toBeTruthy();
  });

  it('feeds the attachment strip from editAttachments while editing, not pending', () => {
    const editRow = {
      id: 'a1',
      chatId: 'chat-1',
      messageId: null,
      kind: 'text',
      fileName: 'edit-only.md',
      mime: 'text/markdown',
      text: 'hello',
      createdAt: 1,
    } as unknown as AttachmentRow;
    renderCockpit({ editingMessageId: 'u9', canReplace: true, editAttachments: [editRow] });
    expect(screen.getByText(/edit-only\.md/i)).toBeTruthy();
  });

  it('renders the normal send control and no banner when not editing', () => {
    renderCockpit({ editingMessageId: null });
    expect(screen.queryByText(/editing your message/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Replace message$/i })).toBeNull();
  });

  // Regression guard (review fix): the strip, the image-preview object URLs, and
  // the Lightbox items must all derive from the same shown set (editAttachments
  // while editing). Pre-fix, objectUrls/items were still derived from `pending`
  // (empty here), so Lightbox's items array was [] and its own effect closed it
  // straight back — see Lightbox.tsx's `if (p.items.length === 0) p.onClose()`.
  // Opening the thumb below would then never show the image.
  it('opens the lightbox on the edit attachment when pending is empty', () => {
    const imageRow = {
      id: 'img1',
      chatId: 'chat-1',
      messageId: null,
      origin: 'upload',
      kind: 'image',
      fileName: 'edit-photo.jpg',
      mime: 'image/jpeg',
      order: 0,
      state: 'active',
      createdAt: 1,
      updatedAt: 1,
      blob: new Blob(['x'], { type: 'image/jpeg' }),
      width: 10,
      height: 10,
      visionDescription: null,
    } as unknown as AttachmentRow;
    renderCockpit({ editingMessageId: 'u9', canReplace: true, editAttachments: [imageRow] });

    fireEvent.click(screen.getByRole('button', { name: /edit-photo\.jpg/i }));

    const image = screen.getByAltText('edit-photo.jpg') as HTMLImageElement;
    expect(image.src).toContain('blob:');
  });

  // Removal routing (Task 9): the strip's remove action must distinguish an
  // ORIGINAL (bound to the message being edited) from a PENDING addition made
  // during this edit session. An original stages its removal — undo-able via
  // Cancel — rather than deleting the row; see attachmentRemovalRoute.
  it('stages the removal of an original attachment instead of deleting it', () => {
    const original = {
      id: 'orig1',
      chatId: 'chat-1',
      messageId: 'u9',
      origin: 'upload',
      kind: 'text',
      fileName: 'original.md',
      mime: 'text/markdown',
      order: 0,
      state: 'active',
      createdAt: 1,
      updatedAt: 1,
      text: 'original content',
    } as unknown as AttachmentRow;
    renderCockpit({ editingMessageId: 'u9', canReplace: true, editAttachments: [original] });

    fireEvent.click(screen.getByRole('button', { name: /original\.md/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Remove$/i }));

    expect(useCurrentChatStore.getState().editStagedRemovals).toEqual(['orig1']);
  });

  it('does not stage the removal of a pending addition made during the edit', () => {
    const pendingAddition = {
      id: 'add1',
      chatId: 'chat-1',
      messageId: null,
      origin: 'upload',
      kind: 'text',
      fileName: 'added.md',
      mime: 'text/markdown',
      order: 0,
      state: 'active',
      createdAt: 1,
      updatedAt: 1,
      text: 'added content',
    } as unknown as AttachmentRow;
    renderCockpit({ editingMessageId: 'u9', canReplace: true, editAttachments: [pendingAddition] });

    fireEvent.click(screen.getByRole('button', { name: /added\.md/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Remove$/i }));

    expect(useCurrentChatStore.getState().editStagedRemovals).toEqual([]);
  });
});
