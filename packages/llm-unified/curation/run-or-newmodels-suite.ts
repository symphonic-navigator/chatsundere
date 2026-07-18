// SPDX-License-Identifier: LGPL-3.0-only
//
// One-off live verification harness for the OpenRouter Hy3 / MiniMax M3
// offerings (run via the /curate skill, NEVER in CI — it needs keys/.or-test-key).
// Runs the deterministic conversation-suite across each offering's reasoning
// permutation matrix, plus the vision scenario for MiniMax M3. Prints a Markdown
// PASS/FAIL report per offering.
//
//   bun run curation/run-or-newmodels-suite.ts       (from packages/llm-unified)
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
const providerConfig: ProviderConfig = { baseUrl: openrouter.baseUrl, routing: { kind: 'direct' } };

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

const VISION_PERM: ReasoningPermutation[] = [{ label: 'default', intent: { enabled: false } }];

for (const canonicalRef of ['hy3', 'minimax-m3']) {
  const o = openrouter.offerings.find((x) => x.canonicalRef === canonicalRef);
  if (!o) throw new Error(`offering not found on openrouter: ${canonicalRef}`);

  const adapter = openRouterAdapter(o.upstreamSlug, {
    vision: o.profile.vision,
    reasoning: o.profile.reasoning,
    zdr: o.trust.zdr,
    includeReasoning: false,
  });
  const binding = makeLiveBinding({
    offeringRef: `openrouter:${o.upstreamSlug}`,
    providerConfig,
    apiKey,
    adapter,
    tools,
  });

  console.log(
    `\n${'='.repeat(72)}\nOFFERING openrouter:${o.upstreamSlug}  reasoning=${o.profile.reasoning.mode}\n${'='.repeat(72)}`,
  );
  const core = await runSuite(coreScenario, permutationsForReasoning(o.profile.reasoning), binding);
  console.log(renderSuiteReport(core));

  if (o.profile.vision) {
    const visionBinding = makeLiveBinding({
      offeringRef: `openrouter:${o.upstreamSlug}`,
      providerConfig,
      apiKey,
      adapter,
    });
    const vision = await runSuite(visionScenario, VISION_PERM, visionBinding);
    console.log(renderSuiteReport(vision));
  }
}

console.log('\nDONE.');
