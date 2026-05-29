// SPDX-License-Identifier: LGPL-3.0-only
import type { ParseState } from '../adapter-contract.js';
import type { StreamChunk } from '../types.js';
import type { CapturedFixture } from './fixture-types.js';
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

/**
 * Replay each successful fixture through both the candidate (generated) and
 * baseline (hand-ported, known-good) adapters and require event-for-event
 * equivalence. Divergence means the generated adapter is wrong — the strongest
 * oracle available for the spike, and a direct hand-vs-AI comparison.
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
  return { passed: failures.length === 0, failures };
}
