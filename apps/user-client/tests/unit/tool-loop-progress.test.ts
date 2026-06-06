// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, vi } from 'vitest';
import type { PillRow } from '../../src/boot/client-data-db.js';
import type { StreamEngineResult } from '../../src/lib/stream-engine.js';
import { runToolLoop } from '../../src/lib/tool-loop.js';

function toolCallPill(id: string): PillRow {
  return {
    id,
    messageId: 'm1',
    kind: 'tool-call',
    positionHint: 'inline',
    status: 'pending',
    payload: {
      name: 'create_artefact',
      argumentsJson: '{"title":"X","brief":"b"}',
      toolCallId: 't1',
    },
    createdAt: 0,
  };
}

test('progress updates merge into the pill payload; meta merges on completion', async () => {
  const updates: PillRow[] = [];
  let round = 0;
  const result = await runToolLoop({
    streamOnce: async (): Promise<StreamEngineResult> => {
      round += 1;
      return round === 1
        ? { finalContentBlocks: [], pillRows: [toolCallPill('p1')], finishReason: 'tool_calls' }
        : {
            finalContentBlocks: [{ type: 'text', text: 'done' }],
            pillRows: [],
            finishReason: 'stop',
          };
    },
    dispatch: async (_name, _args, _signal, onProgress) => {
      onProgress?.({ charCount: 10 });
      onProgress?.({ charCount: 25 });
      return { ok: true, output: 'created', error: null, meta: { artefactId: 'a1', title: 'X' } };
    },
    toolDefs: [],
    maxRounds: 5,
    onPillUpdate: (p) => updates.push({ ...p, payload: { ...(p.payload as object) } }),
  });
  const last = updates.at(-1);
  expect((last?.payload as { charCount?: number }).charCount).toBe(25);
  expect((last?.payload as { artefactId?: string }).artefactId).toBe('a1');
  expect(last?.status).toBe('completed');
  expect(result.finishReason).toBe('stop');
});
