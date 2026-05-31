// SPDX-License-Identifier: LGPL-3.0-only
//
// One-off live verification harness for the wafer offerings (run via the
// /curate skill, NEVER in CI — it needs keys/.wafer-test-key). Runs the
// deterministic conversation-suite against each wafer offering across its full
// reasoning permutation matrix, plus the vision scenario for vision-capable
// offerings. Prints a Markdown PASS/FAIL report per offering.
//
//   bun run curation/run-wafer-suite.ts      (from packages/llm-unified)
import { readFileSync } from 'node:fs';
import type { ToolDef } from '../src/adapter-contract.js';
import { waferAdapter } from '../src/adapters/wafer-openai.js';
import { wafer } from '../src/providers/wafer.js';
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
  new URL('../../../keys/.wafer-test-key', import.meta.url),
  'utf8',
).trim();

const providerConfig: ProviderConfig = {
  baseUrl: wafer.baseUrl,
  routing: { kind: 'direct' }, // server-side run: no CORS, talk to wafer directly
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

// Optional argv[2] substring filter, e.g. `bun run … deepseek` runs only the
// DeepSeek offerings — handy when re-verifying a newly added subset.
const slugFilter = process.argv[2];
const targets = slugFilter
  ? wafer.offerings.filter((o) => o.upstreamSlug.toLowerCase().includes(slugFilter.toLowerCase()))
  : wafer.offerings;

for (const o of targets) {
  const adapter = waferAdapter(o.upstreamSlug, {
    vision: o.profile.vision,
    zdr: o.trust.zdr,
    reasoning: o.profile.reasoning,
  });
  const binding = makeLiveBinding({
    offeringRef: `wafer:${o.upstreamSlug}`,
    providerConfig,
    apiKey,
    adapter,
    tools,
  });

  console.log(`\n${'='.repeat(72)}\nOFFERING wafer:${o.upstreamSlug}\n${'='.repeat(72)}`);

  const perms = permutationsForReasoning(o.profile.reasoning);
  const core = await runSuite(coreScenario, perms, binding);
  console.log(renderSuiteReport(core));

  if (o.profile.vision) {
    const vision = await runSuite(visionScenario, VISION_PERM, binding);
    console.log(renderSuiteReport(vision));
  }
}

console.log('\nDONE.');
