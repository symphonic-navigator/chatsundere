// SPDX-License-Identifier: LGPL-3.0-only
import type { ReasoningIntent, StreamChunk, WireMessage } from '../../src/types.js';
import type { PermutationRun, SuiteRun, TurnRun } from './report.js';
import type { ConversationScenario, ReasoningPermutation } from './scenario.js';
import type { TurnOutcome } from './types.js';

/** How the caller wires the suite to a concrete provider + adapter + key. */
export interface RunnerBinding {
  offeringRef: string;
  /**
   * Execute one turn: send `messages` with the given reasoning intent, return
   * the assembled outcome. Implemented by the caller using streamCompletion +
   * the offering's adapter + the provider's key. Kept injectable so the
   * orchestration stays free of provider specifics.
   */
  runTurn(messages: WireMessage[], reasoning: ReasoningIntent): Promise<TurnOutcome>;
  /** Synthesise a tool-result message to feed back after a tool call. */
  toolResultFor(call: { id: string; name: string; argumentsJson: string }): WireMessage;
}

/** Assemble a TurnOutcome from a sequence of StreamChunks + an HTTP status. */
export function assembleOutcome(httpStatus: number, chunks: StreamChunk[]): TurnOutcome {
  let text = '';
  let reasoning = '';
  const toolCalls: { id: string; name: string; argumentsJson: string }[] = [];
  let usage: TurnOutcome['usage'] = null;
  let finishReason: string | null = null;
  for (const c of chunks) {
    if (c.type === 'token') text += c.text;
    else if (c.type === 'reasoning') reasoning += c.text;
    else if (c.type === 'tool-call')
      toolCalls.push({ id: c.toolCallId, name: c.name, argumentsJson: c.argumentsJson });
    else if (c.type === 'usage') usage = c.usage;
    else if (c.type === 'finish') finishReason = c.reason;
  }
  return { httpStatus, chunks, text, reasoning, toolCalls, usage, finishReason };
}

/** Run one scenario across one permutation. */
async function runPermutation(
  scenario: ConversationScenario,
  perm: ReasoningPermutation,
  binding: RunnerBinding,
): Promise<PermutationRun> {
  const history: WireMessage[] = [];
  const turns: TurnRun[] = [];
  for (const [i, turn] of scenario.turns.entries()) {
    history.push(...turn.send);
    const outcome = await binding.runTurn(history, perm.intent);
    const results = turn.assertions.map((a) => a(outcome));
    // Permutation-scoped assertions (e.g. reasoning present/absent) run on the
    // first turn — the reasoning probe, before tools/memory complicate it.
    if (i === 0 && perm.assertions) results.push(...perm.assertions.map((a) => a(outcome)));
    turns.push({ turnId: turn.id, results });
    // Replay the assistant's turn into history. When it made tool calls, the
    // assistant message must carry them (OpenAI shape) and EVERY call must be
    // answered by a `tool` message before the next turn — otherwise the history
    // is malformed and a strict provider rejects the continuation. Verified live
    // across chutes, nano-gpt and novita (2026-05-30).
    if (outcome.toolCalls.length > 0) {
      history.push({
        role: 'assistant',
        content: outcome.text,
        tool_calls: outcome.toolCalls.map((t) => ({
          id: t.id,
          type: 'function',
          function: { name: t.name, arguments: t.argumentsJson },
        })),
      });
      for (const call of outcome.toolCalls) history.push(binding.toolResultFor(call));
    } else if (outcome.text) {
      history.push({ role: 'assistant', content: outcome.text });
    }
  }
  return { label: perm.label, turns };
}

/** Run a scenario across every supplied reasoning permutation. */
export async function runSuite(
  scenario: ConversationScenario,
  permutations: ReasoningPermutation[],
  binding: RunnerBinding,
): Promise<SuiteRun> {
  const runs: PermutationRun[] = [];
  for (const perm of permutations) {
    runs.push(await runPermutation(scenario, perm, binding));
  }
  return { scenarioId: scenario.id, offeringRef: binding.offeringRef, permutations: runs };
}
