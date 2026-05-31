// SPDX-License-Identifier: LGPL-3.0-only
//
// One-off live verification harness for the OpenRouter offerings (run via the
// /curate skill, NEVER in CI — it needs keys/.or-test-key). Runs the
// deterministic conversation-suite against each OpenRouter offering across its
// full reasoning permutation matrix, plus the vision scenario for
// vision-capable offerings. Prints a Markdown PASS/FAIL report per offering.
//
//   bun run curation/run-openrouter-suite.ts            (from packages/llm-unified)
//   bun run curation/run-openrouter-suite.ts glm         (substring-filter offerings)
import { readFileSync } from 'node:fs';
import type { ToolDef } from '../src/adapter-contract.js';
import { openRouterAdapter } from '../src/adapters/openrouter-openai.js';
import { openrouter } from '../src/providers/openrouter.js';
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

const apiKey = readFileSync(new URL('../../../keys/.or-test-key', import.meta.url), 'utf8').trim();

const providerConfig: ProviderConfig = {
  baseUrl: openrouter.baseUrl,
  routing: { kind: 'direct' }, // server-side run: no CORS, talk to OpenRouter directly
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

// Optional argv[2] substring filter, e.g. `bun run … glm` runs only the GLM
// offerings — handy when re-verifying a newly added subset.
const slugFilter = process.argv[2];
const targets = slugFilter
  ? openrouter.offerings.filter((o) =>
      o.upstreamSlug.toLowerCase().includes(slugFilter.toLowerCase()),
    )
  : openrouter.offerings;

for (const o of targets) {
  const adapter = openRouterAdapter(o.upstreamSlug, {
    vision: o.profile.vision,
    reasoning: o.profile.reasoning,
  });
  const binding = makeLiveBinding({
    offeringRef: `openrouter:${o.upstreamSlug}`,
    providerConfig,
    apiKey,
    adapter,
    tools,
  });

  console.log(`\n${'='.repeat(72)}\nOFFERING openrouter:${o.upstreamSlug}\n${'='.repeat(72)}`);

  const perms = permutationsForReasoning(o.profile.reasoning);
  const core = await runSuite(coreScenario, perms, binding);
  console.log(renderSuiteReport(core));

  if (o.profile.vision) {
    const vision = await runSuite(visionScenario, VISION_PERM, binding);
    console.log(renderSuiteReport(vision));
  }
}

console.log('\nDONE.');
