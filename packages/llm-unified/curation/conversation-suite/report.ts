// SPDX-License-Identifier: LGPL-3.0-only
import type { AssertionResult } from './types.js';

export interface TurnRun {
  turnId: string;
  results: AssertionResult[];
}

export interface PermutationRun {
  label: string;
  turns: TurnRun[];
}

export interface SuiteRun {
  scenarioId: string;
  offeringRef: string;
  permutations: PermutationRun[];
}

/** Deterministic Markdown summary of a suite run. No LLM, no judgement. */
export function renderSuiteReport(run: SuiteRun): string {
  const all = run.permutations.flatMap((p) => p.turns.flatMap((t) => t.results));
  const failed = all.filter((r) => r.status === 'fail');
  const overall = failed.length === 0 ? 'PASS' : 'FAIL';

  const lines: string[] = [];
  lines.push(`# Conversation-suite: ${run.offeringRef} — ${overall}`);
  lines.push('');
  lines.push(`Scenario: \`${run.scenarioId}\` · ${all.length} checks · ${failed.length} failed`);
  lines.push('');
  for (const perm of run.permutations) {
    lines.push(`## ${perm.label}`);
    for (const turn of perm.turns) {
      lines.push(`### ${turn.turnId}`);
      for (const r of turn.results) {
        const mark = r.status === 'pass' ? 'PASS' : 'FAIL';
        lines.push(`- [${mark}] \`${r.assertion}\` — ${r.detail}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}
