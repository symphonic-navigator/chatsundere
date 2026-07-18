// SPDX-License-Identifier: LGPL-3.0-only
//
// One-off live verification harness for the nano-gpt Hy3 / MiniMax M3 /
// Nemotron 3 Ultra offerings (run via the /curate skill, NEVER in CI — it needs
// keys/.nano-test-key). Runs the deterministic conversation-suite across each
// offering's reasoning permutation matrix. All three are text-only, so no vision
// scenario. Prints a Markdown PASS/FAIL report per offering.
//
//   bun run curation/run-nano-newmodels-suite.ts     (from packages/llm-unified)
import { readFileSync } from 'node:fs';
import type { ToolDef } from '../src/adapter-contract.js';
import { nanoGptSlugSwapAdapter } from '../src/adapters/nano-gpt-slug-swap.js';
import { nanoGpt } from '../src/providers/nano-gpt.js';
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

const CANONICALS = ['hy3', 'minimax-m3'];
const VISION_PERM: ReasoningPermutation[] = [{ label: 'default', intent: { enabled: false } }];

for (const canonicalRef of CANONICALS) {
  const o = nanoGpt.offerings.find((x) => x.canonicalRef === canonicalRef);
  if (!o) throw new Error(`offering not found on nano-gpt: ${canonicalRef}`);

  // Mirror registerNanoGpt: Hy3 has no `:thinking` sibling, so its thinking slug
  // IS the base slug; the others use the default `${base}:thinking`.
  const adapter =
    canonicalRef === 'hy3'
      ? nanoGptSlugSwapAdapter(
          o.upstreamSlug,
          o.profile.vision,
          o.profile.reasoning,
          o.upstreamSlug,
        )
      : nanoGptSlugSwapAdapter(o.upstreamSlug, o.profile.vision, o.profile.reasoning);

  const binding = makeLiveBinding({
    offeringRef: `nano-gpt:${o.upstreamSlug}`,
    providerConfig,
    apiKey,
    adapter,
    tools,
  });

  console.log(
    `\n${'='.repeat(72)}\nOFFERING nano-gpt:${o.upstreamSlug}  reasoning=${o.profile.reasoning.mode}\n${'='.repeat(72)}`,
  );
  const perms = permutationsForReasoning(o.profile.reasoning);
  const core = await runSuite(coreScenario, perms, binding);
  console.log(renderSuiteReport(core));

  if (o.profile.vision) {
    // Tools-free binding for the image-INPUT check (mirrors the Inkling harness):
    // an image-gen tool offered during an image-description turn only confounds it.
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
