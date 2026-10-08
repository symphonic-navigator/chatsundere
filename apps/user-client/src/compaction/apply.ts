// SPDX-License-Identifier: AGPL-3.0-only
import type { ChatRow, MessageRow } from '../boot/client-data-db.js';
import { getActiveCheckpoint } from './repo.js';

/**
 * If the chat has an active compaction checkpoint, replace the compressed
 * prefix with its summary (injected as a distinct block before the memory
 * context) and slice the history to the verbatim tail. Otherwise a no-op.
 */
export async function applyActiveCompaction(
  chat: ChatRow,
  priorMessages: MessageRow[],
  memoryContext: string,
): Promise<{ priorMessages: MessageRow[]; memoryContext: string }> {
  const checkpoint = await getActiveCheckpoint(chat);
  if (!checkpoint) return { priorMessages, memoryContext };

  const boundary = priorMessages.find((m) => m.id === checkpoint.tailStartMessageId);
  const sliced = boundary
    ? priorMessages.filter((m) => m.createdAt >= boundary.createdAt)
    : priorMessages;

  // The summary is model output over untrusted tool text; it must not be able
  // to close its block and speak from outside it.
  const summary = checkpoint.summaryMarkdown.replace(
    /<(\s*\/?\s*conversation_compact)/gi,
    '&lt;$1',
  );
  const block = `<conversation_compact>\n${summary}\n</conversation_compact>`;
  const combined = memoryContext ? `${block}\n${memoryContext}` : block;
  return { priorMessages: sliced, memoryContext: combined };
}
