// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import type { ReasoningControl } from '../../src/catalogue/types.js';
import { assertReasoningAbsent } from './assertions.js';
import { permutationsForReasoning } from './permutations.js';
import type { RunnerBinding } from './runner.js';
import { runSuite } from './runner.js';
import type { ConversationScenario } from './scenario.js';

describe('permutationsForReasoning', () => {
  test('none → a single off permutation asserting reasoning-absent', () => {
    const p = permutationsForReasoning({ mode: 'none' });
    expect(p.map((x) => x.label)).toEqual(['reasoning-off']);
    expect(p[0]?.intent).toEqual({ enabled: false });
  });

  test('fixed-on → a single on permutation', () => {
    const p = permutationsForReasoning({ mode: 'fixed-on' });
    expect(p.map((x) => x.label)).toEqual(['reasoning-on']);
    expect(p[0]?.intent).toEqual({ enabled: true });
  });

  test('toggle → off then on', () => {
    const p = permutationsForReasoning({ mode: 'toggle', defaultOn: true });
    expect(p.map((x) => x.label)).toEqual(['reasoning-off', 'reasoning-on']);
  });

  test('steps with an offStep → off plus one effort permutation per step', () => {
    const p = permutationsForReasoning({
      mode: 'steps',
      steps: ['low', 'medium', 'high'],
      offStep: 'off',
      defaultStep: 'medium',
    });
    expect(p.map((x) => x.label)).toEqual([
      'reasoning-off',
      'effort:low',
      'effort:medium',
      'effort:high',
    ]);
    expect(p[0]?.intent).toEqual({ enabled: false });
    expect(p.find((x) => x.label === 'effort:high')?.intent).toEqual({
      enabled: true,
      effort: 'high',
    });
  });

  test('steps with offStep null → no off permutation', () => {
    const p = permutationsForReasoning({
      mode: 'steps',
      steps: ['low', 'medium', 'high'],
      offStep: null,
      defaultStep: 'medium',
    });
    expect(p.map((x) => x.label)).toEqual(['effort:low', 'effort:medium', 'effort:high']);
  });

  test('every permutation carries at least one assertion', () => {
    const modes: ReasoningControl[] = [
      { mode: 'none' },
      { mode: 'fixed-on' },
      { mode: 'toggle', defaultOn: false },
      { mode: 'steps', steps: ['low'], offStep: 'off', defaultStep: 'low' },
    ];
    for (const m of modes) {
      for (const p of permutationsForReasoning(m)) {
        expect(p.assertions?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });
});

describe('runPermutation applies a permutation assertion to the first turn', () => {
  // A binding whose turn leaks reasoning regardless of the intent — models the
  // chutes "off still thinks" bug. The reasoning-off permutation must catch it.
  const leakyBinding: RunnerBinding = {
    offeringRef: 'fake:model',
    async runTurn() {
      return {
        httpStatus: 200,
        chunks: [],
        text: 'ok',
        reasoning: 'leaked thinking',
        toolCalls: [],
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        finishReason: 'stop',
      };
    },
    toolResultFor: (name) => ({ role: 'tool', content: '{}', name }),
  };

  const scenario: ConversationScenario = {
    id: 'mini',
    description: 'one plain turn',
    turns: [{ id: 'plain', send: [{ role: 'user', content: 'hi' }], assertions: [] }],
  };

  test('reasoning-absent fails when reasoning leaks despite an off intent', async () => {
    const run = await runSuite(
      scenario,
      [{ label: 'reasoning-off', intent: { enabled: false }, assertions: [assertReasoningAbsent] }],
      leakyBinding,
    );
    const result = run.permutations[0]?.turns[0]?.results.find(
      (r) => r.assertion === 'reasoning-absent',
    );
    expect(result?.status).toBe('fail');
  });

  test('a permutation with no assertions adds nothing to the turn results', async () => {
    const run = await runSuite(
      scenario,
      [{ label: 'plain', intent: { enabled: false } }],
      leakyBinding,
    );
    expect(run.permutations[0]?.turns[0]?.results).toEqual([]);
  });
});
