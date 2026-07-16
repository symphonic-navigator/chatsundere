// SPDX-License-Identifier: LGPL-3.0-only
//
// Live verification harness for the Inkling offering on nano-gpt (run via the
// /curate skill, NEVER in CI — it needs keys/.nano-test-key). Inkling is the one
// hidden-reasoning-trace case: it reasons internally (billed reasoning_tokens)
// but nano-gpt withholds the trace text on the OpenAI-compatible route, so the
// standard `reasoning-present` assertion does not apply on reasoning-on. Instead
// this harness asserts, for reasoning-on, that reasoning is BILLED but the
// channel stays EMPTY — and that assertion self-documents the flip: the day a
// trace surfaces (nano-gpt wiring the passthrough), it fails with a note to drop
// `reasoningTraceHidden` and revert to the ordinary `reasoning-present` matrix.
//
//   bun run curation/run-inkling-suite.ts            (from packages/llm-unified)
import { readFileSync } from 'node:fs';
import type { ToolDef } from '../src/adapter-contract.js';
import { openRouterAdapter } from '../src/adapters/openrouter-openai.js';
import { nanoGpt } from '../src/providers/nano-gpt.js';
import type { ProviderConfig } from '../src/types.js';
import {
  type Assertion,
  type ReasoningPermutation,
  assertReasoningAbsent,
  coreScenario,
  makeLiveBinding,
  renderSuiteReport,
  runSuite,
  visionScenario,
} from './conversation-suite/index.js';

const key = (file: string) =>
  readFileSync(new URL(`../../../keys/${file}`, import.meta.url), 'utf8').trim();

const tools: ToolDef[] = [
  {
    name: 'generate_image',
    description: 'Generate an image from a text prompt.',
    parameters: {
      type: 'object',
      properties: { prompt: { type: 'string', description: 'What to draw.' } },
      required: ['prompt'],
    },
  },
];

const direct: (baseUrl: string) => ProviderConfig = (baseUrl) => ({
  baseUrl,
  routing: { kind: 'direct' },
});

const offering = nanoGpt.offerings.find((o) => o.canonicalRef === 'inkling');
if (!offering) throw new Error('inkling offering not found on nano-gpt');

/**
 * Reasoning-on assertion for a hidden-trace offering: the model must reason
 * (billed reasoning_tokens) while the reasoning channel stays empty. Fails with
 * a directive when a trace DOES surface — that is the signal nano-gpt has wired
 * the passthrough and the offering should drop `reasoningTraceHidden`.
 */
const assertReasoningHiddenBilled: Assertion = (outcome) => {
  const channelEmpty = outcome.reasoning.trim().length === 0;
  const billed = (outcome.usage?.reasoningTokens ?? 0) > 0;
  const ok = channelEmpty && billed;
  return {
    assertion: 'reasoning-hidden-billed',
    status: ok ? 'pass' : 'fail',
    detail: ok
      ? `reasoning billed (${outcome.usage?.reasoningTokens} tokens), trace withheld by provider`
      : !channelEmpty
        ? 'a reasoning trace surfaced — nano-gpt may have wired the passthrough; drop reasoningTraceHidden and revert to the standard matrix'
        : 'no reasoning billed (usage.reasoningTokens is 0)',
  };
};

const inklingPerms: ReasoningPermutation[] = [
  { label: 'reasoning-off', intent: { enabled: false }, assertions: [assertReasoningAbsent] },
  { label: 'reasoning-on', intent: { enabled: true }, assertions: [assertReasoningHiddenBilled] },
];

const VISION_PERM: ReasoningPermutation[] = [{ label: 'default', intent: { enabled: false } }];

const ref = `nano-gpt:${offering.upstreamSlug}`;
const adapter = openRouterAdapter(offering.upstreamSlug, {
  vision: offering.profile.vision,
  reasoning: offering.profile.reasoning,
});
const binding = makeLiveBinding({
  offeringRef: ref,
  providerConfig: direct(nanoGpt.baseUrl),
  apiKey: key('.nano-test-key'),
  adapter,
  tools,
});
// Vision uses a TOOLS-FREE binding on purpose. The vision scenario probes image
// INPUT carriage; the generate_image tool is irrelevant to it. Inkling is tool-
// eager — offered generate_image alongside an "what colour is this image?" prompt
// it fires the tool instead of answering (0/5 with the tool; 6/6 without —
// probed 2026-07-16). Offering an image-GEN tool during an image-description task
// confounds the input-pipe check, so we drop it here and record the eagerness in
// the Model Curation Record rather than masking a real vision fault (there is
// none — the pipe carries the image reliably once the tool is out of the way).
const visionBinding = makeLiveBinding({
  offeringRef: ref,
  providerConfig: direct(nanoGpt.baseUrl),
  apiKey: key('.nano-test-key'),
  adapter,
});

const bar = '='.repeat(72);
console.log(
  `\n${bar}\nOFFERING ${ref}  reasoning=${offering.profile.reasoning.mode} (trace hidden)\n${bar}`,
);
const core = await runSuite(coreScenario, inklingPerms, binding);
console.log(renderSuiteReport(core));

console.log(`\n${bar}\nVISION ${ref}  (tools-free — Inkling is tool-eager)\n${bar}`);
const vision = await runSuite(visionScenario, VISION_PERM, visionBinding);
console.log(renderSuiteReport(vision));

console.log('\nDONE.');
