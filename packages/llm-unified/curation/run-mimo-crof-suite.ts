// SPDX-License-Identifier: LGPL-3.0-only
//
// One-off live verification harness for MiMo V2.5 Pro on nano-gpt's CROF
// upstream (run via the /curate skill, NEVER in CI — it needs
// keys/.nano-test-key). Resolves the adapter through `registerNanoGpt` rather
// than constructing one, so the run exercises the production registration path
// and not a parallel rebuild of it. Text-only, so no vision scenario.
//
//   bun run curation/run-mimo-crof-suite.ts     (from packages/llm-unified)
import { readFileSync } from 'node:fs';
import type { ModelAdapter, ToolDef } from '../src/adapter-contract.js';
import { getAdapter } from '../src/adapter-registry.js';
import { nanoGpt, registerNanoGpt } from '../src/providers/nano-gpt.js';
import type { ProviderConfig } from '../src/types.js';
import {
  coreScenario,
  makeLiveBinding,
  permutationsForReasoning,
  renderSuiteReport,
  runSuite,
} from './conversation-suite/index.js';

registerNanoGpt();

const apiKey = readFileSync(
  new URL('../../../keys/.nano-test-key', import.meta.url),
  'utf8',
).trim();
const providerConfig: ProviderConfig = { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } };

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

const offering = nanoGpt.offerings.find((o) => o.upstreamSlug === 'xiaomi/mimo-v2.5-pro-crof');
if (!offering || offering.adapter.kind !== 'catalogue') {
  throw new Error('MiMo V2.5 Pro (CROF) offering not found on nano-gpt');
}

const binding = makeLiveBinding({
  offeringRef: offering.adapter.adapterId,
  providerConfig,
  apiKey,
  adapter: getAdapter(offering.adapter.adapterId) as ModelAdapter,
  tools,
});

console.log(
  `\n${'='.repeat(72)}\nOFFERING ${offering.adapter.adapterId}  reasoning=${offering.profile.reasoning.mode}\n${'='.repeat(72)}`,
);
const core = await runSuite(
  coreScenario,
  permutationsForReasoning(offering.profile.reasoning),
  binding,
);
console.log(renderSuiteReport(core));

console.log('\nDONE.');
