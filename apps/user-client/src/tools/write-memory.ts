// SPDX-License-Identifier: AGPL-3.0-only
import { addJournalEntries, listJournal } from '../memory/repo.js';
import type { Tool, ToolResult } from './types.js';

/** Context for the write_memory_entry tool: which persona owns the memory, and
 *  an optional hook to refresh the Memory Page after a successful write. */
export interface MemoryToolContext {
  personaId: string;
  /** Invoked after a successful write so the caller can invalidate the
   *  Memory-Page journal query (no useLiveQuery in this project). */
  onWritten?: () => void;
}

const SYSTEM_INSTRUCTION =
  'You keep a long-term memory of the user. When they share a lasting fact, ' +
  'preference, or correction worth remembering, you may call write_memory_entry ' +
  'to save it. Do not save momentary states or one-off requests.';

/** The active write_memory_entry tool for a persona that has memory enabled.
 *  Always returns a single-element tuple so callers may safely destructure. */
export function contributeMemoryTool(ctx: MemoryToolContext): [Tool] {
  const tool: Tool = {
    name: 'write_memory_entry',
    description:
      'Save a durable fact, preference, or correction about the user to your ' +
      'long-term memory, so you still know it in future conversations. Use it ' +
      'when the user shares something lasting and worth remembering — not for ' +
      'momentary states or one-off requests.',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The fact or preference to remember, as a short self-contained statement.',
        },
        correction: {
          type: 'boolean',
          description: 'True if this corrects or replaces something already known about the user.',
        },
      },
      required: ['content'],
    },
    systemPromptInstruction: SYSTEM_INSTRUCTION,
    async execute(args): Promise<ToolResult> {
      const raw = typeof args.content === 'string' ? args.content.trim() : '';
      if (!raw) return { ok: false, output: '', error: 'Nothing to remember.' };
      const correction = args.correction === true;

      const existing = (await listJournal(ctx.personaId)).filter((e) => e.state !== 'archived');
      const key = raw.toLowerCase();
      if (existing.some((e) => e.content.trim().toLowerCase() === key)) {
        return { ok: true, output: 'Already remembered.', error: null };
      }

      const [row] = await addJournalEntries(ctx.personaId, [
        { content: raw, category: correction ? 'correction' : 'fact', isCorrection: correction },
      ]);
      ctx.onWritten?.();
      return { ok: true, output: 'Saved to memory.', error: null, meta: { entryId: row?.id } };
    },
  };
  return [tool];
}
