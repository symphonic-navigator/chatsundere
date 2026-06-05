// SPDX-License-Identifier: LGPL-3.0-only
//
// Live verification harness for the xAI Grok offering (run via /curate, NEVER in
// CI — needs keys/.xai-test-key). Runs the conversation-suite across the full
// reasoning permutation matrix plus the vision scenario. Prints a PASS/FAIL report.
//
//   bun run curation/run-xai-suite.ts        (from packages/llm-unified)
import { readFileSync } from 'node:fs';
import type { ToolDef } from '../src/adapter-contract.js';
import { xaiAdapter } from '../src/adapters/xai-openai.js';
import { xai } from '../src/providers/xai.js';
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

const apiKey = readFileSync(new URL('../../../keys/.xai-test-key', import.meta.url), 'utf8').trim();

const providerConfig: ProviderConfig = {
  baseUrl: xai.baseUrl,
  routing: { kind: 'direct' }, // server-side: no CORS, talk to xAI directly
};

// The tool the core scenario expects the model to call.
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

// A single neutral permutation for the vision run — vision is orthogonal to
// reasoning, so we exercise it once without re-asserting the reasoning channel.
const VISION_PERM: ReasoningPermutation[] = [{ label: 'default', intent: { enabled: false } }];

for (const o of xai.offerings) {
  const adapter = xaiAdapter(o.upstreamSlug, { vision: o.profile.vision });
  const binding = makeLiveBinding({
    offeringRef: `xai:${o.upstreamSlug}`,
    providerConfig,
    apiKey,
    adapter,
    tools,
  });

  console.log(`\n${'='.repeat(72)}\nOFFERING xai:${o.upstreamSlug}\n${'='.repeat(72)}`);

  const perms = permutationsForReasoning(o.profile.reasoning);
  const core = await runSuite(coreScenario, perms, binding);
  console.log(renderSuiteReport(core));

  if (o.profile.vision) {
    const vision = await runSuite(visionScenario, VISION_PERM, binding);
    console.log(renderSuiteReport(vision));
  }
}

console.log('\nDONE.');
