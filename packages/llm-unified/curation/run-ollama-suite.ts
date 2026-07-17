// SPDX-License-Identifier: LGPL-3.0-only
//
// Live verification harness for the ollama-cloud offerings (run via /curate,
// NEVER in CI — needs keys/.ollama-test-key). ollama-cloud talks to ollama's
// NATIVE `/api/chat` endpoint, so this drives the real production path via
// `makeLiveBinding` with `ollamaNativeAdapter`, exercising the conversation
// suite across each offering's reasoning permutations plus the vision
// scenario where applicable. It also runs each offering through the
// background-job path (`makeOneShotBinding`, mirroring title generation) and
// a dedicated sampling-cap scenario asserting a token cap actually reaches
// the wire, each with its own binding.
//
//   bun run curation/run-ollama-suite.ts        (from packages/llm-unified)
import { readFileSync } from 'node:fs';
import type { ToolDef } from '../src/adapter-contract.js';
import { ollamaNativeAdapter } from '../src/adapters/ollama-native.js';
import { ollamaCloud, registerOllamaCloud } from '../src/providers/ollama-cloud.js';
import type { ProviderConfig } from '../src/types.js';
import {
  type ReasoningPermutation,
  coreScenario,
  makeLiveBinding,
  makeOneShotBinding,
  oneShotScenario,
  permutationsForReasoning,
  renderSuiteReport,
  runSuite,
  samplingCapScenario,
  visionScenario,
} from './conversation-suite/index.js';

// The one-shot binding drives `runOneShotCompletion` → `streamCompletion`,
// which resolves the adapter via `getAdapter(target.adapterId)`. Unlike the
// core/vision/sampling-cap bindings above (which hand-construct the adapter
// and never touch the registry), this path needs `ollama-cloud:<slug>`
// registered — otherwise `getAdapter` returns undefined, `streamCompletion`
// silently falls back to the generic OpenAI-shaped body, and the one-shot
// turn proves nothing about the native adapter path it exists to verify.
registerOllamaCloud();

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

  // The background-job path — title generation, memory, compaction. Broken on
  // every ollama model until 2026-07-17 while core stayed green.
  const oneShot = await runSuite(
    oneShotScenario,
    [{ label: 'reasoning-off', intent: { enabled: false } }],
    makeOneShotBinding({
      offeringRef: `ollama-cloud:${o.upstreamSlug}`,
      provider: ollamaCloud,
      providerConfig,
      apiKey,
      target: {
        slug: o.upstreamSlug,
        adapterId: o.adapter.kind === 'catalogue' ? o.adapter.adapterId : undefined,
      },
      sampling: { temperature: 0.3, max_tokens: 256 },
    }),
  );
  console.log(renderSuiteReport(oneShot));

  if (o.profile.vision) {
    const vision = await runSuite(visionScenario, VISION_PERM, binding);
    console.log(renderSuiteReport(vision));
  }

  // The sampling-cap probe gets its OWN binding: the cap must reach the wire for
  // the assertion to mean anything, but must NOT truncate the core turns.
  const capBinding = makeLiveBinding({
    offeringRef: `ollama-cloud:${o.upstreamSlug}`,
    providerConfig,
    apiKey,
    adapter,
    sampling: { max_tokens: 16 },
  });
  const cap = await runSuite(
    samplingCapScenario,
    [{ label: 'reasoning-off', intent: { enabled: false } }],
    capBinding,
  );
  console.log(renderSuiteReport(cap));
}

console.log('\nDONE.');
