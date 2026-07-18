// SPDX-License-Identifier: AGPL-3.0-only
import type { ChatRow, MessageRow } from '../../../boot/client-data-db.js';
import type { EditBranchArgs, EditReplaceArgs } from '../../../data/message-edit.js';
import { messageText } from '../../../data/message-edit.js';
import type { ReasoningState } from '../../../lib/reasoning-resolver.js';

/**
 * Pure builder for the mild-message-edit enter/cancel/replace/branch flow
 * (spec 2026-07-18 §6/§8). Deliberately free of React and Dexie imports
 * beyond types — every side effect is a collaborator passed in — so the four
 * flows are unit-testable without rendering `ChatPage`. `chat-page.tsx` is a
 * thin caller: it rebuilds `EditOrchestrationDeps` fresh each render (the
 * returned closures read the values captured at that call) and wires the
 * four functions to the composer's onEdit/onCancelEdit/onReplace/onBranchEdit.
 */
export interface EditOrchestrationDeps {
  /** The active chat. Edit flows are chat-mode only — enter/cancel/commit are
   *  no-ops (or return early) when this is null. */
  activeChatId: string | null;
  /** The persona driving this chat's replies. Replace/Branch are no-ops
   *  without one — mirrors chat-page's onSend guard. */
  personaId: string | null;
  /** The message currently open for edit, or null. */
  editingMessageId: string | null;
  /** The composer's current draft text. */
  draft: string;
  reasoning: ReasoningState;
  editStagedRemovals: string[];
  setDraft: (v: string) => void;
  resetEditSession: () => void;
  clearPendingAttachments: (chatId: string) => Promise<void>;
  updateChat: {
    mutateAsync: (args: { id: string; patch: Partial<ChatRow> }) => Promise<unknown>;
  };
  editAndReplace: { mutateAsync: (args: EditReplaceArgs) => Promise<void> };
  editAndBranch: { mutateAsync: (args: EditBranchArgs) => Promise<string> };
  navigate: (path: string) => void;
}

export interface EditOrchestration {
  /** Start editing `m`: reset any stale staged removals, load its text into
   *  the draft, and mark it as the chat's edit target. */
  enterEdit: (m: MessageRow) => Promise<void>;
  /** Abandon the in-progress edit: discard pending attachment additions made
   *  during it, clear the draft and staged removals, and clear the edit target. */
  cancelEdit: () => Promise<void>;
  /** Commit Replace-in-place: overwrite the edited message, apply the staged
   *  attachment changes, and re-roll the reply. No-op if there is no edit
   *  target or no persona to reply with. */
  onReplace: () => Promise<void>;
  /** Commit Branch-on-edit: fork the chat up to the edited message, carry the
   *  edited attachments over, and re-send into the new chat. No-op under the
   *  same guard as `onReplace`. */
  onBranchEdit: () => Promise<void>;
}

/** What a send trigger (Enter, dictation finishing, live-voice finishing, the
 *  touch send button) should do. */
export type SendAction = 'replace' | 'branch' | 'send';

/**
 * The single decision behind every send affordance. While an edit is in
 * progress, EVERY trigger must commit the same action the `EditSendButton`
 * primary would — never the plain new-message send (Laura HARD defect,
 * spec 2026-07-18): Replace when the edited message is still reachable,
 * Branch otherwise. Outside an edit, a trigger is always a plain send.
 *
 * Kept pure and separate from `buildEditOrchestration` so `chat-page.tsx`'s
 * one `onSend` chokepoint — which every keyboard, dictation, and live-voice
 * send path funnels through — can consult it without duplicating the
 * canReplace/editingMessageId logic at each call site.
 */
export function resolveSendAction(
  editingMessageId: string | null,
  canReplace: boolean,
): SendAction {
  if (editingMessageId === null) return 'send';
  return canReplace ? 'replace' : 'branch';
}

export function buildEditOrchestration(deps: EditOrchestrationDeps): EditOrchestration {
  const enterEdit = async (m: MessageRow): Promise<void> => {
    if (!deps.activeChatId) return;
    deps.resetEditSession();
    deps.setDraft(messageText(m));
    await deps.updateChat.mutateAsync({
      id: deps.activeChatId,
      patch: { editingMessageId: m.id },
    });
  };

  const cancelEdit = async (): Promise<void> => {
    if (!deps.activeChatId) return;
    await deps.clearPendingAttachments(deps.activeChatId);
    deps.resetEditSession();
    deps.setDraft('');
    await deps.updateChat.mutateAsync({
      id: deps.activeChatId,
      patch: { editingMessageId: null },
    });
  };

  const onReplace = async (): Promise<void> => {
    if (!deps.activeChatId || !deps.editingMessageId || !deps.personaId) return;
    await deps.editAndReplace.mutateAsync({
      chatId: deps.activeChatId,
      messageId: deps.editingMessageId,
      text: deps.draft,
      stagedRemovals: deps.editStagedRemovals,
      reasoning: deps.reasoning,
    });
    deps.resetEditSession();
    deps.setDraft('');
  };

  const onBranchEdit = async (): Promise<void> => {
    if (!deps.activeChatId || !deps.editingMessageId || !deps.personaId) return;
    const newChatId = await deps.editAndBranch.mutateAsync({
      sourceChatId: deps.activeChatId,
      personaId: deps.personaId,
      editingMessageId: deps.editingMessageId,
      text: deps.draft,
      stagedRemovals: deps.editStagedRemovals,
      reasoning: deps.reasoning,
    });
    deps.resetEditSession();
    deps.setDraft('');
    deps.navigate(`/app/chat/${newChatId}`);
  };

  return { enterEdit, cancelEdit, onReplace, onBranchEdit };
}
