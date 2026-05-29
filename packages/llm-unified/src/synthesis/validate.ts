// SPDX-License-Identifier: LGPL-3.0-only
import type { ModelProfile, ParseState } from '../adapter-contract.js';
import type { ReasoningControl } from '../catalogue/types.js';
import type { StreamChunk } from '../types.js';
import { type ObservedFacts, deriveObservedProfile } from './derive-profile.js';
import type { CapturedFixture, ProbeDimension } from './fixture-types.js';
import type { AdapterHandle } from './sandbox-host.js';
import { frameSse } from './sse-framing.js';

export interface Verdict {
  passed: boolean;
  failures: string[];
}

export interface ValidateArgs {
  candidate: AdapterHandle;
  baseline: AdapterHandle;
  fixtures: CapturedFixture[];
}

async function replay(handle: AdapterHandle, deltas: unknown[]): Promise<StreamChunk[]> {
  let state: ParseState = {};
  const events: StreamChunk[] = [];
  for (const d of deltas) {
    const r = await handle.parseChunk(d, state);
    state = r.state;
    events.push(...r.events);
  }
  return events;
}

function controlToKind(
  c: ReasoningControl | undefined,
): 'no_reasoning' | 'optional' | 'always_on' | undefined {
  switch (c?.mode) {
    case 'none':
      return 'no_reasoning';
    case 'fixed-on':
      return 'always_on';
    case 'toggle':
    case 'steps':
      return 'optional';
    default:
      return undefined;
  }
}

/**
 * Compare the candidate's declared profile against the facts the fixtures
 * actually demonstrate. ONLY fields whose probe dimension is present are
 * checked — absence of a reasoning probe is not evidence of 'no_reasoning'.
 * Fields that no probe can determine (vision, replayReasoning) are deliberately
 * not asserted here; those belong to injected provider metadata, not
 * behavioural synthesis.
 */
function checkProfile(
  profile: ModelProfile | undefined,
  observed: ObservedFacts,
  probed: Set<ProbeDimension>,
): string[] {
  const out: string[] = [];
  if (!profile) return ['adapter exposes no `profile` object'];

  if (probed.has('reasoning-on') || probed.has('reasoning-off')) {
    const profileKind = controlToKind(profile.reasoning);
    if (profileKind !== observed.reasoningKind) {
      const note = observed.reasoningKind === 'always_on' ? 'still emitted' : 'did not emit';
      out.push(
        `profile.reasoning implies "${profileKind}" but the evidence shows "${observed.reasoningKind}" (reasoning-off ${note} reasoning).`,
      );
    }
  }

  if (probed.has('tool-call')) {
    if (profile.toolCalls?.supported !== observed.toolCallsSupported) {
      out.push(
        `profile.toolCalls.supported is ${profile.toolCalls?.supported} but the evidence shows ${observed.toolCallsSupported}.`,
      );
    }
    if (profile.toolCalls?.streaming !== observed.toolCallsStreaming) {
      const arrival = observed.toolCallsStreaming ? 'more than one delta' : 'a single block';
      out.push(
        `profile.toolCalls.streaming is ${profile.toolCalls?.streaming} but the evidence shows ${observed.toolCallsStreaming} (tool-call arguments arrived in ${arrival}).`,
      );
    }
  }

  if (probed.has('reasoning-and-tools')) {
    if (profile.toolCalls?.concurrentWithReasoning !== observed.concurrentWithReasoning) {
      out.push(
        `profile.toolCalls.concurrentWithReasoning is ${profile.toolCalls?.concurrentWithReasoning} but the evidence shows ${observed.concurrentWithReasoning}.`,
      );
    }
  }

  return out;
}

/**
 * Validate a generated adapter against the captured evidence on two axes:
 *  1. Event equivalence — replay each fixture through both the candidate and
 *     the hand-ported baseline; their canonical event streams must match.
 *  2. Profile correctness — the candidate's declared behavioural facts must
 *     match what the fixtures demonstrate (only for probed dimensions).
 * Both must hold. Verdict failures are phrased for the analyzer to self-repair.
 */
export async function validateAdapter(args: ValidateArgs): Promise<Verdict> {
  const failures: string[] = [];

  for (const fx of args.fixtures) {
    if (fx.status !== 200) continue;
    const deltas = frameSse(fx.rawResponse);
    const candidateEvents = await replay(args.candidate, deltas);
    const baselineEvents = await replay(args.baseline, deltas);
    if (JSON.stringify(candidateEvents) !== JSON.stringify(baselineEvents)) {
      failures.push(
        `Fixture ${fx.probeId}: candidate events diverge from baseline.\n` +
          `  baseline:  ${JSON.stringify(baselineEvents)}\n` +
          `  candidate: ${JSON.stringify(candidateEvents)}`,
      );
    }
  }

  const observed = deriveObservedProfile(args.fixtures);
  const probed = new Set(
    args.fixtures.filter((f) => f.status === 200).map((f) => f.dimension),
  ) as Set<ProbeDimension>;
  failures.push(
    ...checkProfile(args.candidate.profile as ModelProfile | undefined, observed, probed),
  );

  return { passed: failures.length === 0, failures };
}
