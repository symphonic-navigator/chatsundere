// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useState } from 'react';
import { QK } from '../data/queryKeys.js';
import { type MemoryActionError, classifyMemoryActionError } from '../memory/classify-error.js';
import { releaseMemoryLock, tryAcquireMemoryLock } from '../memory/mutex.js';
import { type MemoryRawResponse, runDreaming, runExtraction } from '../memory/pipeline.js';
import { resolveMemoryPipelineArgs } from '../memory/resolve-args.js';
import { toastStore } from '../state/toast.store.js';
import { queryClient } from './queryClient.js';

export interface MemoryActionState {
  status: 'idle' | 'pending' | 'error';
  error?: MemoryActionError;
  /** Consolidation slices checkpointed before a failure (partial progress). */
  partialSlices?: number;
  /**
   * The raw model answer from the failing call (content + reasoning, split),
   * when one was parsed. Present only on `error` and only when a 2xx body was
   * received — powers the "show the model's answer" debug view. Absent for
   * timeouts and non-2xx failures, which never yield a model message.
   */
  response?: MemoryRawResponse;
}

const IDLE: MemoryActionState = { status: 'idle' };

/** On-demand "learn from this chat" / "consolidate now" actions for the memory
 *  page. Resolves credentials lazily on click; never on render. Takes the same
 *  per-persona mutex as the background pipeline so the two never interleave. */
export function useMemoryActions(chatId: string): {
  learnState: MemoryActionState;
  consolidateState: MemoryActionState;
  learnNow: () => Promise<void>;
  consolidateNow: () => Promise<void>;
  lastAttempted: 'learn' | 'consolidate' | null;
} {
  const [learnState, setLearnState] = useState<MemoryActionState>(IDLE);
  const [consolidateState, setConsolidateState] = useState<MemoryActionState>(IDLE);
  const [lastAttempted, setLastAttempted] = useState<'learn' | 'consolidate' | null>(null);

  const run = useCallback(
    async (
      kind: 'learn' | 'consolidate',
      setState: (s: MemoryActionState) => void,
    ): Promise<void> => {
      setLastAttempted(kind);
      let personaId: string | null = null;
      let slices = 0;
      // Last parsed model answer — held so the error path can offer a debug view
      // of what the model actually returned (chiefly: reasoning but no content).
      let lastResponse: MemoryRawResponse | undefined;
      const onRawResponse = (r: MemoryRawResponse): void => {
        lastResponse = r;
      };
      try {
        const args = await resolveMemoryPipelineArgs(chatId, `memory-${kind}`);
        personaId = args.persona.id;
        if (!tryAcquireMemoryLock(personaId)) {
          toastStore.show({
            message: 'Already working on this — give it a moment.',
            tone: 'info',
            durationMs: 4000,
          });
          return;
        }
        setState({ status: 'pending' });
        try {
          if (kind === 'learn') {
            await runExtraction(args, { force: true, onRawResponse });
          } else {
            const id = personaId;
            await runDreaming(args, {
              force: true,
              onRawResponse,
              onSlice: () => {
                slices += 1;
                void queryClient.invalidateQueries({ queryKey: QK.memory(id) });
              },
            });
          }
          setState(IDLE);
        } finally {
          releaseMemoryLock(personaId);
        }
      } catch (e) {
        setState({
          status: 'error',
          error: classifyMemoryActionError(e),
          partialSlices: slices,
          response: lastResponse,
        });
      } finally {
        // Error paths must refresh too: a mid-drain failure has already archived
        // slices, and the committed list must show the true remainder (Laura HARD-1).
        if (personaId) void queryClient.invalidateQueries({ queryKey: QK.memory(personaId) });
        void queryClient.invalidateQueries({ queryKey: QK.unextractedCount(chatId) });
      }
    },
    [chatId],
  );

  const learnNow = useCallback(() => run('learn', setLearnState), [run]);
  const consolidateNow = useCallback(() => run('consolidate', setConsolidateState), [run]);

  return { learnState, consolidateState, learnNow, consolidateNow, lastAttempted };
}
