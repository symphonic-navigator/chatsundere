// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import type { WireMessage } from '../../src/types.js';
import { assertTextPresent } from './assertions.js';
import { type RunnerBinding, runSuite } from './runner.js';
import type { ConversationScenario } from './scenario.js';
import { coreScenario } from './scenarios/core.js';
import type { TurnOutcome } from './types.js';

function outcome(partial: Partial<TurnOutcome>): TurnOutcome {
  return {
    httpStatus: 200,
    chunks: [],
    text: '',
    reasoning: '',
    toolCalls: [],
    usage: null,
    finishReason: null,
    ...partial,
  };
}

/** Fake binding: replies from a queue and records every history it was sent. */
function fakeBinding(replies: TurnOutcome[]) {
  const sent: WireMessage[][] = [];
  const binding: RunnerBinding = {
    offeringRef: 'fake:model',
    runTurn: async (messages) => {
      sent.push(structuredClone(messages));
      const next = replies.shift();
      if (!next) throw new Error('unexpected extra turn');
      return next;
    },
    toolResultFor: (call) => ({ role: 'tool', tool_call_id: call.id, content: '{"status":"ok"}' }),
  };
  return { binding, sent };
}

const toolScenario: ConversationScenario = {
  id: 'tool-continuation',
  description: 'test',
  turns: [
    { id: 'call', send: [{ role: 'user', content: 'draw' }], assertions: [] },
    { id: 'continue', send: [], requiresToolResult: true, assertions: [assertTextPresent] },
  ],
};
const perm = [{ label: 'reasoning-off', intent: { enabled: false } }];

describe('runSuite tool-result continuation', () => {
  it('sends the continuation with the tool result as the last message', async () => {
    const call = { id: 'c1', name: 'generate_image', argumentsJson: '{"prompt":"fox"}' };
    const { binding, sent } = fakeBinding([
      outcome({ toolCalls: [call] }),
      outcome({ text: 'Here is your fox.' }),
    ]);
    const run = await runSuite(toolScenario, perm, binding);
    expect(sent).toHaveLength(2);
    expect(sent[1]?.at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'c1',
      content: '{"status":"ok"}',
    });
    expect(run.permutations[0]?.turns[1]?.results.map((r) => r.status)).toEqual(['pass']);
  });

  it('skips the continuation and fails it when no tool result exists', async () => {
    const { binding, sent } = fakeBinding([outcome({ text: 'I drew nothing.' })]);
    const run = await runSuite(toolScenario, perm, binding);
    expect(sent).toHaveLength(1);
    const results = run.permutations[0]?.turns[1]?.results ?? [];
    expect(results).toHaveLength(1);
    expect(results[0]?.assertion).toBe('tool-result-available');
    expect(results[0]?.status).toBe('fail');
  });
});

describe('coreScenario', () => {
  it('checks the reply to the generate_image tool result', () => {
    const ids = coreScenario.turns.map((t) => t.id);
    const continuation = coreScenario.turns.find((t) => t.id === 'tool-result-continuation');
    expect(ids.indexOf('tool-result-continuation')).toBe(
      ids.indexOf('tool-call-generate-image') + 1,
    );
    expect(continuation?.requiresToolResult).toBe(true);
    expect(continuation?.send).toEqual([]);
  });

  it('uses a memory token that no other turn mentions', () => {
    const memory = coreScenario.turns.find((t) => t.id === 'memory-echo');
    const others = coreScenario.turns.filter((t) => t.id !== 'memory-echo');
    const otherText = JSON.stringify(others.map((t) => t.send)).toLowerCase();
    expect(JSON.stringify(memory?.send).toLowerCase()).toContain('bassoon');
    expect(otherText).not.toContain('bassoon');
  });
});
