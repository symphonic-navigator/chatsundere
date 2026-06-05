// SPDX-License-Identifier: LGPL-3.0-only
//
// Live verification harness for the ollama-cloud offerings (run via /curate,
// NEVER in CI — needs keys/.ollama-test-key). ollama-cloud uses the GENERIC
// adapter path, so this drives the real production path via
// `makeGenericLiveBinding` (buildBody + parseOpenAiSseStream), exercising the
// conversation-suite across each offering's reasoning permutations plus the
// vision scenario where applicable.
//
//   bun run curation/run-ollama-suite.ts        (from packages/llm-unified)
import { readFileSync } from 'node:fs';
import type { ToolDef } from '../src/adapter-contract.js';
import { ollamaNativeAdapter } from '../src/adapters/ollama-native.js';
import { ollamaCloud } from '../src/providers/ollama-cloud.js';
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

const apiKey =
  process.env.OLLAMA_API_KEY?.trim() ??
  readFileSync(new URL('../../../keys/.ollama-test-key', import.meta.url), 'utf8').trim();

const providerConfig: ProviderConfig = {
  baseUrl: ollamaCloud.baseUrl,
  routing: { kind: 'direct' }, // server-side Bun: no CORS, talk to ollama.com directly
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

// Vision is orthogonal to reasoning — exercise it once.
const VISION_PERM: ReasoningPermutation[] = [{ label: 'default', intent: { enabled: false } }];

for (const o of ollamaCloud.offerings) {
  const adapter = ollamaNativeAdapter(o.upstreamSlug, {
    vision: o.profile.vision,
    reasoning: o.profile.reasoning,
  });
  const binding = makeLiveBinding({
    offeringRef: `ollama-cloud:${o.upstreamSlug}`,
    providerConfig,
    apiKey,
    adapter,
    tools,
  });

  console.log(`\n${'='.repeat(72)}\nOFFERING ollama-cloud:${o.upstreamSlug}\n${'='.repeat(72)}`);

  const perms = permutationsForReasoning(o.profile.reasoning);
  const core = await runSuite(coreScenario, perms, binding);
  console.log(renderSuiteReport(core));

  if (o.profile.vision) {
    const vision = await runSuite(visionScenario, VISION_PERM, binding);
    console.log(renderSuiteReport(vision));
  }
}

console.log('\nDONE.');
