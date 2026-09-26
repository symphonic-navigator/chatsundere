// SPDX-License-Identifier: LGPL-3.0-only
//
// One-off live verification harness for the September 2026 nano-gpt additions
// (run via the /curate skill, NEVER in CI — it needs keys/.nano-test-key). Unlike
// the older per-family harnesses it resolves each offering's adapter from the
// registry after `registerNanoGpt()`, so the suite exercises exactly the wiring
// the app uses. Runs the conversation-suite across each offering's reasoning
// permutation matrix, plus the vision scenario where the offering claims vision.
//
//   bun run curation/run-nano-sept2026-suite.ts [canonical ...]   (from packages/llm-unified)
import { readFileSync } from 'node:fs';
import type { ToolDef } from '../src/adapter-contract.js';
import { getAdapter } from '../src/adapter-registry.js';
import { nanoGpt, registerNanoGpt } from '../src/providers/nano-gpt.js';
import type { ProviderConfig } from '../src/types.js';
import {
  type ReasoningPermutation,
  coreScenario,
  makeLiveBinding,
  permutationsForReasoning,
  renderSuiteReport,
  runSuite,
  visionScenario,
} from './conversation-suite/index.js';

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

const ALL = [
  'glm-5.3',
  'glm-5.3-flash',
  'glm-5.3-flash-uncensored',
  'deepseek-v4.1-flash',
  'mimo-v2.6-pro',
  'mimo-v2.6-flash',
  'mimo-v2.6-flash-uncensored',
  'chatgpt-5.6-sol',
  'chatgpt-6-astra',
  'claude-fable-5.1',
  'claude-opus-5.5',
];
const selected = process.argv.slice(2);
const VISION_PERM: ReasoningPermutation[] = [{ label: 'default', intent: { enabled: false } }];

registerNanoGpt();

for (const canonicalRef of selected.length > 0 ? selected : ALL) {
  const o = nanoGpt.offerings.find((x) => x.canonicalRef === canonicalRef);
  if (!o) throw new Error(`offering not found on nano-gpt: ${canonicalRef}`);
  if (o.adapter.kind !== 'catalogue') throw new Error(`not a catalogue adapter: ${canonicalRef}`);
  const adapter = getAdapter(o.adapter.adapterId);
  if (!adapter) throw new Error(`adapter not registered: ${o.adapter.adapterId}`);

  console.log(
    `\n${'='.repeat(72)}\nOFFERING nano-gpt:${o.upstreamSlug}  reasoning=${JSON.stringify(o.profile.reasoning)}  vision=${o.profile.vision}\n${'='.repeat(72)}`,
  );
  const binding = makeLiveBinding({
    offeringRef: `nano-gpt:${o.upstreamSlug}`,
    providerConfig,
    apiKey,
    adapter,
    tools,
  });
  const core = await runSuite(coreScenario, permutationsForReasoning(o.profile.reasoning), binding);
  console.log(renderSuiteReport(core));

  if (o.profile.vision) {
    // Tools-free binding for the image-INPUT check: an image-generation tool
    // offered during an image-description turn only confounds it.
    const visionBinding = makeLiveBinding({
      offeringRef: `nano-gpt:${o.upstreamSlug}`,
      providerConfig,
      apiKey,
      adapter,
    });
    const vision = await runSuite(visionScenario, VISION_PERM, visionBinding);
    console.log(renderSuiteReport(vision));
  }
}

console.log('\nDONE.');
