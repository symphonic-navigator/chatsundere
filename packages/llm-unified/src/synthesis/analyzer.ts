// SPDX-License-Identifier: LGPL-3.0-only
import type { CapturedFixture } from './fixture-types.js';

export interface PromptArgs {
  contract: string;
  providerDocs: string;
  fixtures: CapturedFixture[];
  /** Validation failures from a previous round, for self-repair. */
  priorFailures?: string[];
}

/**
 * Build the analyzer prompt. The model is given the canonical contract, the
 * provider documentation and — crucially — the REAL captured probe evidence,
 * and must return exactly one fenced code block exporting `adapter`
 * (buildRequest + parseChunk + profile). Empirical evidence over docs.
 */
export function buildAnalyzerPrompt(args: PromptArgs): string {
  const fixtureBlock = args.fixtures
    .map(
      (f) =>
        `### Probe ${f.probeId} (${f.dimension}) → HTTP ${f.status}\n` +
        `Request body: ${JSON.stringify(f.requestBody)}\n` +
        `Raw response:\n${f.rawResponse}`,
    )
    .join('\n\n');

  const repair = args.priorFailures?.length
    ? `\n\n## Previous attempt FAILED validation. Fix these and try again:\n${args.priorFailures.join('\n')}`
    : '';

  return `You are writing a per-model adapter for an LLM gateway. It must mediate
between our canonical internal API and this specific model's real wire
behaviour, which you can see in the captured evidence below.

## Canonical contract (TypeScript)
${args.contract}

## Provider documentation
${args.providerDocs}

## Captured probe evidence (ground truth — trust this over the docs)
${fixtureBlock}

## Your task
Return exactly one single fenced TypeScript code block and nothing else of substance.
The block must \`export const adapter\` implementing the ModelAdapter contract:
a pure \`buildRequest\`, a pure \`parseChunk\` that correctly reassembles
fragmented streamed tool calls across deltas, and a \`profile\` whose fields
match what the evidence demonstrates. No imports, no I/O, no network, no
storage access — pure functions only.${repair}`;
}

/** Extract the first fenced code block's contents from a model reply. */
export function extractAdapterModule(reply: string): string {
  const match = reply.match(/```(?:ts|typescript|js|javascript)?\n([\s\S]*?)```/);
  if (!match || !match[1]) throw new Error('analyzer reply contained no code block');
  return match[1].trim();
}
