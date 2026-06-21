// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useState } from 'react';
import { QK } from '../data/queryKeys.js';
import { runDreaming, runExtraction } from '../memory/pipeline.js';
import { resolveMemoryPipelineArgs } from '../memory/resolve-args.js';
import { queryClient } from './queryClient.js';

export interface MemoryActionState {
  status: 'idle' | 'pending' | 'error';
  error?: 'no-credentials' | 'failed';
}

const IDLE: MemoryActionState = { status: 'idle' };

/** On-demand "learn from this chat" / "consolidate now" actions for the memory overlay.
 *  Resolves credentials lazily on click; never on render. */
export function useMemoryActions(chatId: string): {
  learnState: MemoryActionState;
  consolidateState: MemoryActionState;
  learnNow: () => Promise<void>;
  consolidateNow: () => Promise<void>;
} {
  const [learnState, setLearnState] = useState<MemoryActionState>(IDLE);
  const [consolidateState, setConsolidateState] = useState<MemoryActionState>(IDLE);

  const run = useCallback(
    async (
      kind: 'learn' | 'consolidate',
      setState: (s: MemoryActionState) => void,
    ): Promise<void> => {
      setState({ status: 'pending' });
      try {
        const args = await resolveMemoryPipelineArgs(chatId, `memory-${kind}`);
        if (kind === 'learn') await runExtraction(args, { force: true });
        else await runDreaming(args, { force: true });
        void queryClient.invalidateQueries({ queryKey: QK.memory(args.persona.id) });
        void queryClient.invalidateQueries({ queryKey: QK.unextractedCount(chatId) });
        setState(IDLE);
      } catch (e) {
        const msg = e instanceof Error ? e.message : '';
        setState({
          status: 'error',
          error: msg.includes('master key') ? 'no-credentials' : 'failed',
        });
      }
    },
    [chatId],
  );

  const learnNow = useCallback(() => run('learn', setLearnState), [run]);
  const consolidateNow = useCallback(() => run('consolidate', setConsolidateState), [run]);

  return { learnState, consolidateState, learnNow, consolidateNow };
}
