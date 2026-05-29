// SPDX-License-Identifier: LGPL-3.0-only
import type { ParseState } from '../adapter-contract.js';
import type { ModelProfile } from '../catalogue/types.js';
import type { StreamChunk } from '../types.js';
import { deriveObservedProfile } from './derive-profile.js';
import type { CapturedFixture, ProbeDimension } from './fixture-types.js';
import type { AdapterHandle } from './sandbox-host.js';
import { frameSse } from './sse-framing.js';
import { type Verdict, checkProfile } from './validate.js';

interface Delta {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{ function?: { name?: string } }>;
    };
  }>;
}

function rawHasReasoning(deltas: unknown[]): boolean {
  return deltas.some((d) => {
    const delta = (d as Delta).choices?.[0]?.delta;
    return Boolean(delta?.reasoning || delta?.reasoning_content);
  });
}

function rawHasContent(deltas: unknown[]): boolean {
  return deltas.some((d) => Boolean((d as Delta).choices?.[0]?.delta?.content));
}

function rawHasToolCall(deltas: unknown[]): boolean {
  return deltas.some((d) =>
    ((d as Delta).choices?.[0]?.delta?.tool_calls ?? []).some((tc) => Boolean(tc.function?.name)),
  );
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

export interface ValidateAgainstFixturesArgs {
  candidate: AdapterHandle;
  fixtures: CapturedFixture[];
}

/**
 * Baseline-free validation: the generated adapter must REFLECT what each captured
 * fixture actually contains (reasoning → reasoning event; content → token event;
 * tool call → a tool-call event with VALID-JSON arguments — the reassembly
 * correctness check), and its declared profile must match the observed facts.
 * This generalises to any target model, unlike baseline-equivalence.
 */
export async function validateAgainstFixtures(args: ValidateAgainstFixturesArgs): Promise<Verdict> {
  const failures: string[] = [];

  for (const fx of args.fixtures) {
    if (fx.status !== 200) continue;
    const deltas = frameSse(fx.rawResponse);
    const events = await replay(args.candidate, deltas);

    if (rawHasReasoning(deltas) && !events.some((e) => e.type === 'reasoning')) {
      failures.push(
        `Fixture ${fx.probeId}: raw shows reasoning but the adapter emitted no reasoning event.`,
      );
    }
    if (rawHasContent(deltas) && !events.some((e) => e.type === 'token')) {
      failures.push(
        `Fixture ${fx.probeId}: raw shows content but the adapter emitted no token event.`,
      );
    }
    if (rawHasToolCall(deltas)) {
      const toolCalls = events.filter((e) => e.type === 'tool-call');
      if (toolCalls.length === 0) {
        failures.push(`Fixture ${fx.probeId}: raw shows a tool call but the adapter emitted none.`);
      }
      for (const tc of toolCalls) {
        const argsJson = (tc as { argumentsJson: string }).argumentsJson;
        try {
          JSON.parse(argsJson);
        } catch {
          failures.push(
            `Fixture ${fx.probeId}: tool-call argumentsJson is not valid JSON (reassembly bug): ${argsJson}`,
          );
        }
      }
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
