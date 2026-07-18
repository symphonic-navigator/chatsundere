// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import type { MessageRow } from '../../src/boot/client-data-db.js';
import {
  type EditOrchestrationDeps,
  buildEditOrchestration,
  resolveSendAction,
} from '../../src/routes/app/chat/use-edit-orchestration.js';

function u(id: string): MessageRow {
  return {
    id,
    chatId: 'c1',
    role: 'user',
    contentBlocks: [{ type: 'text', text: `text-of-${id}` }],
    createdAt: 1,
    updatedAt: 1,
    bookmarked: false,
    streamingState: 'complete',
  };
}

/** Builds a fresh deps stub for each test; individual fields overridden per case. */
function makeDeps(overrides: Partial<EditOrchestrationDeps> = {}): EditOrchestrationDeps {
  return {
    activeChatId: 'c1',
    personaId: 'p1',
    editingMessageId: null,
    draft: '',
    reasoning: { kind: 'off' },
    editStagedRemovals: [],
    setDraft: vi.fn(),
    resetEditSession: vi.fn(),
    clearPendingAttachments: vi.fn().mockResolvedValue(undefined),
    updateChat: { mutateAsync: vi.fn().mockResolvedValue(undefined) },
    editAndReplace: { mutateAsync: vi.fn().mockResolvedValue(undefined) },
    editAndBranch: { mutateAsync: vi.fn().mockResolvedValue('new-chat-id') },
    navigate: vi.fn(),
    ...overrides,
  };
}

describe('buildEditOrchestration — enterEdit', () => {
  it('resets the edit session, loads the message text into the draft, and sets editingMessageId', async () => {
    const deps = makeDeps();
    const { enterEdit } = buildEditOrchestration(deps);

    await enterEdit(u('u9'));

    expect(deps.resetEditSession).toHaveBeenCalledOnce();
    expect(deps.setDraft).toHaveBeenCalledWith('text-of-u9');
    expect(deps.updateChat.mutateAsync).toHaveBeenCalledWith({
      id: 'c1',
      patch: { editingMessageId: 'u9' },
    });
  });

  it('is a no-op without an active chat', async () => {
    const deps = makeDeps({ activeChatId: null });
    const { enterEdit } = buildEditOrchestration(deps);

    await enterEdit(u('u9'));

    expect(deps.resetEditSession).not.toHaveBeenCalled();
    expect(deps.updateChat.mutateAsync).not.toHaveBeenCalled();
  });
});

describe('buildEditOrchestration — cancelEdit', () => {
  it('discards pending attachment additions, clears the draft + session, and nulls editingMessageId', async () => {
    const deps = makeDeps({ editingMessageId: 'u9', draft: 'edited text' });
    const { cancelEdit } = buildEditOrchestration(deps);

    await cancelEdit();

    expect(deps.clearPendingAttachments).toHaveBeenCalledWith('c1');
    expect(deps.resetEditSession).toHaveBeenCalledOnce();
    expect(deps.setDraft).toHaveBeenCalledWith('');
    expect(deps.updateChat.mutateAsync).toHaveBeenCalledWith({
      id: 'c1',
      patch: { editingMessageId: null },
    });
  });

  it('is a no-op without an active chat', async () => {
    const deps = makeDeps({ activeChatId: null });
    const { cancelEdit } = buildEditOrchestration(deps);

    await cancelEdit();

    expect(deps.clearPendingAttachments).not.toHaveBeenCalled();
    expect(deps.updateChat.mutateAsync).not.toHaveBeenCalled();
  });
});

describe('buildEditOrchestration — onReplace', () => {
  it('calls editAndReplace with the current edit state, then resets the session and draft', async () => {
    const deps = makeDeps({
      editingMessageId: 'u9',
      draft: 'new text',
      editStagedRemovals: ['a1'],
      reasoning: { kind: 'on' },
    });
    const { onReplace } = buildEditOrchestration(deps);

    await onReplace();

    expect(deps.editAndReplace.mutateAsync).toHaveBeenCalledWith({
      chatId: 'c1',
      messageId: 'u9',
      text: 'new text',
      stagedRemovals: ['a1'],
      reasoning: { kind: 'on' },
    });
    expect(deps.resetEditSession).toHaveBeenCalledOnce();
    expect(deps.setDraft).toHaveBeenCalledWith('');
  });

  it('is a no-op without an edit target', async () => {
    const deps = makeDeps({ editingMessageId: null });
    const { onReplace } = buildEditOrchestration(deps);

    await onReplace();

    expect(deps.editAndReplace.mutateAsync).not.toHaveBeenCalled();
  });

  it('is a no-op without a persona', async () => {
    const deps = makeDeps({ editingMessageId: 'u9', personaId: null });
    const { onReplace } = buildEditOrchestration(deps);

    await onReplace();

    expect(deps.editAndReplace.mutateAsync).not.toHaveBeenCalled();
  });
});

describe('buildEditOrchestration — onBranchEdit', () => {
  it('calls editAndBranch, resets the session and draft, and navigates to the new chat', async () => {
    const deps = makeDeps({
      editingMessageId: 'u9',
      draft: 'new text',
      editStagedRemovals: ['a1'],
      reasoning: { kind: 'on' },
    });
    const { onBranchEdit } = buildEditOrchestration(deps);

    await onBranchEdit();

    expect(deps.editAndBranch.mutateAsync).toHaveBeenCalledWith({
      sourceChatId: 'c1',
      personaId: 'p1',
      editingMessageId: 'u9',
      text: 'new text',
      stagedRemovals: ['a1'],
      reasoning: { kind: 'on' },
    });
    expect(deps.resetEditSession).toHaveBeenCalledOnce();
    expect(deps.setDraft).toHaveBeenCalledWith('');
    expect(deps.navigate).toHaveBeenCalledWith('/app/chat/new-chat-id');
  });

  it('is a no-op without an edit target', async () => {
    const deps = makeDeps({ editingMessageId: null });
    const { onBranchEdit } = buildEditOrchestration(deps);

    await onBranchEdit();

    expect(deps.editAndBranch.mutateAsync).not.toHaveBeenCalled();
    expect(deps.navigate).not.toHaveBeenCalled();
  });
});

// Laura HARD fix (2026-07-18): every send trigger — keyboard Enter, the touch
// send button, dictation finishing, live-voice finishing — must resolve to
// the SAME action while an edit is in progress. Pre-fix, chat-page.tsx's
// onSend ignored editingMessageId entirely and always sent a plain new
// message; these cases pin the decision so no caller can drift back to that.
describe('resolveSendAction', () => {
  it('resolves to a plain send when no edit is in progress', () => {
    expect(resolveSendAction(null, false)).toBe('send');
    expect(resolveSendAction(null, true)).toBe('send');
  });

  it('resolves to replace while editing and the edited message is still replaceable', () => {
    expect(resolveSendAction('u9', true)).toBe('replace');
  });

  it('resolves to branch while editing but the edited message is no longer last', () => {
    expect(resolveSendAction('u9', false)).toBe('branch');
  });
});
