// SPDX-License-Identifier: LGPL-3.0-only
import type { CapturedFixture, ProbeDimension } from './fixture-types.js';
import { frameSse } from './sse-framing.js';

export interface ObservedFacts {
  reasoningKind: 'no_reasoning' | 'optional' | 'always_on';
  toolCallsSupported: boolean;
  toolCallsStreaming: boolean;
  concurrentWithReasoning: boolean;
  effortMaxAccepted: boolean;
}

function deltasOf(fixtures: CapturedFixture[], dim: ProbeDimension): unknown[][] {
  return fixtures
    .filter((f) => f.dimension === dim && f.status === 200)
    .map((f) => frameSse(f.rawResponse));
}

function hasReasoning(deltas: unknown[]): boolean {
  return deltas.some((d) => {
    const delta = (
      d as { choices?: Array<{ delta?: { reasoning?: unknown; reasoning_content?: unknown } }> }
    ).choices?.[0]?.delta;
    return Boolean(delta?.reasoning || delta?.reasoning_content);
  });
}

function toolCallArgDeltaCount(deltas: unknown[]): number {
  let count = 0;
  for (const d of deltas) {
    const tcs = (
      d as {
        choices?: Array<{ delta?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
      }
    ).choices?.[0]?.delta?.tool_calls;
    // Count only NON-EMPTY argument fragments. The first streamed tool-call
    // delta carries id + name with `arguments: ''` — a structural marker, not
    // a fragment. Counting it would make a block response (empty initialiser +
    // one full-args delta) look like streaming, defeating the whole point.
    for (const tc of tcs ?? []) {
      const args = tc.function?.arguments;
      if (typeof args === 'string' && args.length > 0) count += 1;
    }
  }
  return count;
}

/**
 * Reduce captured fixtures to observed capability facts. Empirical truth:
 *  - reasoning-off that still emits reasoning ⇒ always_on (we refuse the
 *    "hidden reasoning" toggle; for us the model is simply always reasoning).
 *  - tool-call arguments spread across >1 delta ⇒ streaming tool calls.
 *  - a single response carrying both reasoning and a tool call ⇒ concurrency.
 *  - effort-max acceptance is read from the probe's HTTP status.
 */
export function deriveObservedProfile(fixtures: CapturedFixture[]): ObservedFacts {
  const offEmitsReasoning = deltasOf(fixtures, 'reasoning-off').some(hasReasoning);
  const onEmitsReasoning = deltasOf(fixtures, 'reasoning-on').some(hasReasoning);

  let reasoningKind: ObservedFacts['reasoningKind'] = 'no_reasoning';
  if (offEmitsReasoning) reasoningKind = 'always_on';
  else if (onEmitsReasoning) reasoningKind = 'optional';

  const toolDeltas = deltasOf(fixtures, 'tool-call');
  const toolCallsSupported = toolDeltas.some((d) => toolCallArgDeltaCount(d) > 0);
  const toolCallsStreaming = toolDeltas.some((d) => toolCallArgDeltaCount(d) > 1);

  const concurrentWithReasoning = deltasOf(fixtures, 'reasoning-and-tools').some(
    (d) => hasReasoning(d) && toolCallArgDeltaCount(d) > 0,
  );

  const effortMaxAccepted = fixtures
    .filter((f) => f.dimension === 'effort-max')
    .every((f) => f.status >= 200 && f.status < 300);

  return {
    reasoningKind,
    toolCallsSupported,
    toolCallsStreaming,
    concurrentWithReasoning,
    effortMaxAccepted: effortMaxAccepted && fixtures.some((f) => f.dimension === 'effort-max'),
  };
}
