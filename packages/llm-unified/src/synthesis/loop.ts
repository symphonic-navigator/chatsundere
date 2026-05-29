// SPDX-License-Identifier: LGPL-3.0-only
import type { Verdict } from './validate.js';

export interface LoopArgs {
  /** Generate adapter source; receives prior failures for self-repair rounds. */
  generate: (priorFailures: string[]) => Promise<string>;
  /** Validate adapter source, returning a verdict. */
  validate: (adapterSource: string) => Promise<Verdict>;
  maxRounds: number;
}

export interface LoopResult {
  outcome: 'verified' | 'heuristic-fallback';
  rounds: number;
  adapterSource: string | null;
  lastFailures: string[];
}

/**
 * Drive generate → validate → self-repair. On a passing verdict, accept
 * (`verified`). After `maxRounds` failed attempts, give up and signal the
 * conservative heuristic fallback. Capture and probing happen before this loop;
 * it operates purely on already-captured evidence via the injected callbacks.
 */
export async function runSynthesisLoop(args: LoopArgs): Promise<LoopResult> {
  let failures: string[] = [];
  let lastSource: string | null = null;
  for (let round = 1; round <= args.maxRounds; round++) {
    const source = await args.generate(failures);
    lastSource = source;
    const verdict = await args.validate(source);
    if (verdict.passed) {
      return { outcome: 'verified', rounds: round, adapterSource: source, lastFailures: [] };
    }
    failures = verdict.failures;
  }
  return {
    outcome: 'heuristic-fallback',
    rounds: args.maxRounds,
    adapterSource: lastSource,
    lastFailures: failures,
  };
}
