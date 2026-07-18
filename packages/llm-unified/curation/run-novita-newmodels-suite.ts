// SPDX-License-Identifier: LGPL-3.0-only
//
// One-off live verification harness for the novita Hy3 / Kimi K3 / MiniMax M3
// offerings (run via the /curate skill, NEVER in CI — it needs
// keys/.novita-test-key). Runs the deterministic conversation-suite against each
// offering across its full reasoning permutation matrix, plus the vision
// scenario for the vision-capable slugs. Prints a Markdown PASS/FAIL report.
//
//   bun run curation/run-novita-newmodels-suite.ts   (from packages/llm-unified)
import { readFileSync } from 'node:fs';
import type { ToolDef } from '../src/adapter-contract.js';
import { novitaReasoningEffortAdapter } from '../src/adapters/novita-reasoning-effort.js';
import { novita } from '../src/providers/novita.js';
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
  new URL('../../../keys/.novita-test-key', import.meta.url),
  'utf8',
).trim();

const providerConfig: ProviderConfig = {
  baseUrl: novita.baseUrl,
  routing: { kind: 'direct' },
};

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

const NEW_SLUGS = new Set(['moonshotai/kimi-k3', 'tencent/hy3', 'minimax/minimax-m3']);
const targets = novita.offerings.filter((o) => NEW_SLUGS.has(o.upstreamSlug));

for (const o of targets) {
  const adapter = novitaReasoningEffortAdapter(
    o.upstreamSlug,
    o.profile.vision,
    o.profile.reasoning,
  );
  const binding = makeLiveBinding({
    offeringRef: `novita:${o.upstreamSlug}`,
    providerConfig,
    apiKey,
    adapter,
    tools,
  });

  console.log(`\n${'='.repeat(72)}\nOFFERING novita:${o.upstreamSlug}\n${'='.repeat(72)}`);

  const perms = permutationsForReasoning(o.profile.reasoning);
  const core = await runSuite(coreScenario, perms, binding);
  console.log(renderSuiteReport(core));

  if (o.profile.vision) {
    const vision = await runSuite(visionScenario, VISION_PERM, binding);
    console.log(renderSuiteReport(vision));
  }
}

console.log('\nDONE.');
