// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from '@tanstack/react-query';
import type { AttachmentRow, ChatRow, MessageRow, PillRow } from '../../../boot/client-data-db.js';
import { getClientDataDb } from '../../../boot/client-data-db.js';
import type { ChatExportState } from '../../../components/chat/ChatQuickMenu.js';
import {
  chatExportFileName,
  chatExportStartedAt,
  chatExportTitle,
  chatToMarkdown,
} from '../../../lib/chat-export.js';
import { loadReplayAttachments, loadReplayPills } from '../../../lib/replay-pills.js';
import { deliverFile } from '../../../lib/share-or-download.js';
import { toastStore } from '../../../state/toast.store.js';

interface ExportRows {
  chat: ChatRow;
  messages: MessageRow[];
  pills: Map<string, PillRow>;
  attachments: Map<string, AttachmentRow[]>;
}

/** The rows an export reads, fresh from the DB; null when the chat row is gone. */
async function loadExportRows(chatId: string): Promise<ExportRows | null> {
  const db = getClientDataDb();
  const chat = await db.chats.get(chatId);
  if (!chat) return null;
  const messages = await db.messages.where('chatId').equals(chatId).sortBy('createdAt');
  const ids = messages.map((m) => m.id);
  const [pills, attachments] = await Promise.all([
    loadReplayPills(ids),
    loadReplayAttachments(ids),
  ]);
  return { chat, messages, pills, attachments };
}

const failed = (): void =>
  toastStore.show({ message: "Couldn't export this chat", tone: 'warn', durationMs: 3500 });

/**
 * The quick menu's Export chat (spec 2026-11-18 B3). The rows load while the
 * menu is open, so `onExport` builds the file and reaches `navigator.share`
 * synchronously inside the tap, as iOS demands. A download is confirmed with
 * a toast; a share or a cancelled share says nothing; any failure says so.
 */
export function useChatExport(args: {
  /** Whether the quick menu is open; the rows load only then. */
  open: boolean;
  /** Null for a lazy, not-yet-sent chat. */
  chatId: string | null;
  /** Null while the persona still resolves. */
  personaName: string | null;
  userName: string;
  /** The draft of the reply streaming now, left out of the file. */
  streamingMessageId: string | null;
}): { exportState: ChatExportState; onExport: () => void } {
  const { chatId, personaName, streamingMessageId } = args;
  const rows = useQuery({
    // The draft id is in the key so a stream ending while the menu is open
    // reloads the finished reply instead of exporting it as interrupted.
    queryKey: ['chat-export', chatId, streamingMessageId],
    queryFn: () => loadExportRows(chatId ?? ''),
    enabled: args.open && chatId !== null,
    // Every opening reloads: the export must match the chat as it is now.
    staleTime: 0,
    gcTime: 0,
  });

  const exportState = ((): ChatExportState => {
    if (chatId === null) return 'empty';
    // A failed load keeps the entry enabled, so the tap can say what went wrong.
    if (rows.isError) return streamingMessageId ? 'streaming' : 'ready';
    if (personaName === null || rows.isFetching || rows.data === undefined) return 'preparing';
    const shown = rows.data?.messages.filter((m) => m.id !== streamingMessageId) ?? [];
    if (shown.length === 0) return 'empty';
    return streamingMessageId ? 'streaming' : 'ready';
  })();

  const onExport = (): void => {
    try {
      const data = rows.data;
      if (!data || personaName === null) throw new Error('chat export rows not loaded');
      const input = {
        chat: data.chat,
        personaName,
        userName: args.userName,
        messages: data.messages,
        pills: data.pills,
        attachments: data.attachments,
        exportedAt: Date.now(),
        streamingMessageId,
      };
      const file = new File(
        [chatToMarkdown(input)],
        chatExportFileName(personaName, data.chat.title, chatExportStartedAt(input)),
        { type: 'text/markdown' },
      );
      deliverFile(file, chatExportTitle(data.chat, personaName)).then((outcome) => {
        if (outcome === 'downloaded') {
          toastStore.show({ message: 'Chat exported', tone: 'success', durationMs: 2500 });
        }
      }, failed);
    } catch {
      failed();
    }
  };

  return { exportState, onExport };
}
