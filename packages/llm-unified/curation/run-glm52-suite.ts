// SPDX-License-Identifier: LGPL-3.0-only
//
// Live verification harness for the GLM 5.2 offerings across all five providers
// (run via the /curate skill, NEVER in CI — it needs the per-provider keys under
// keys/). Runs the deterministic conversation-suite against each GLM 5.2 offering
// across its full reasoning permutation matrix. GLM 5.2 is text-only, so no
// vision scenario. Prints a Markdown PASS/FAIL report per offering.
//
//   bun run curation/run-glm52-suite.ts            (from packages/llm-unified)
//   bun run curation/run-glm52-suite.ts chutes     (substring-filter by provider)
import { readFileSync } from 'node:fs';
import type { ModelAdapter, ToolDef } from '../src/adapter-contract.js';
import { chutesAdapter } from '../src/adapters/chutes-openai.js';
import { nanoGptSlugSwapAdapter } from '../src/adapters/nano-gpt-slug-swap.js';
import { novitaThinkingAdapter } from '../src/adapters/novita-thinking.js';
import { ollamaNativeAdapter } from '../src/adapters/ollama-native.js';
import { tensorixAdapter } from '../src/adapters/tensorix-openai.js';
import type { Offering } from '../src/catalogue/types.js';
import { chutes } from '../src/providers/chutes.js';
import { nanoGpt } from '../src/providers/nano-gpt.js';
import { novita } from '../src/providers/novita.js';
import { ollamaCloud } from '../src/providers/ollama-cloud.js';
import { tensorix } from '../src/providers/tensorix.js';
import type { ProviderConfig } from '../src/types.js';
import {
  coreScenario,
  makeLiveBinding,
  permutationsForReasoning,
  renderSuiteReport,
  runSuite,
} from './conversation-suite/index.js';

const key = (file: string) =>
  readFileSync(new URL(`../../../keys/${file}`, import.meta.url), 'utf8').trim();

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

const direct: (baseUrl: string) => ProviderConfig = (baseUrl) => ({
  baseUrl,
  routing: { kind: 'direct' },
});

interface Target {
  providerId: string;
  keyFile: string;
  config: ProviderConfig;
  offering: Offering;
  adapter: ModelAdapter;
}

function glmOffering(offerings: Offering[]): Offering {
  const o = offerings.find((x) => x.canonicalRef === 'glm-5.2');
  if (!o) throw new Error('glm-5.2 offering not found');
  return o;
}

const chutesO = glmOffering(chutes.offerings);
const novitaO = glmOffering(novita.offerings);
const tensorixO = glmOffering(tensorix.offerings);
const ollamaO = glmOffering(ollamaCloud.offerings);
const nanoO = glmOffering(nanoGpt.offerings);

const targets: Target[] = [
  {
    providerId: 'chutes',
    keyFile: '.chutes-test-key',
    config: direct(chutes.baseUrl),
    offering: chutesO,
    adapter: chutesAdapter(chutesO.upstreamSlug, chutesO.profile.vision),
  },
  {
    providerId: 'tensorix',
    keyFile: '.tensorix-test-key',
    config: direct(tensorix.baseUrl),
    offering: tensorixO,
    adapter: tensorixAdapter(tensorixO.upstreamSlug, {
      vision: tensorixO.profile.vision,
      reasoning: tensorixO.profile.reasoning,
    }),
  },
  {
    providerId: 'novita',
    keyFile: '.novita-test-key',
    config: direct(novita.baseUrl),
    offering: novitaO,
    adapter: novitaThinkingAdapter(novitaO.upstreamSlug, novitaO.profile.vision),
  },
  {
    providerId: 'nano-gpt',
    keyFile: '.nano-test-key',
    config: direct(nanoGpt.baseUrl),
    offering: nanoO,
    adapter: nanoGptSlugSwapAdapter(
      nanoO.upstreamSlug,
      nanoO.profile.vision,
      nanoO.profile.reasoning,
    ),
  },
  {
    providerId: 'ollama-cloud',
    keyFile: '.ollama-test-key',
    config: direct(ollamaCloud.baseUrl),
    offering: ollamaO,
    adapter: ollamaNativeAdapter(ollamaO.upstreamSlug, {
      vision: ollamaO.profile.vision,
      reasoning: ollamaO.profile.reasoning,
    }),
  },
];

const filter = process.argv[2];
const selected = filter
  ? targets.filter((t) => t.providerId.toLowerCase().includes(filter.toLowerCase()))
  : targets;

for (const t of targets.length === selected.length ? targets : selected) {
  const ref = `${t.providerId}:${t.offering.upstreamSlug}`;
  const bar = '='.repeat(72);
  console.log(`\n${bar}\nOFFERING ${ref}  reasoning=${t.offering.profile.reasoning.mode}\n${bar}`);
  const binding = makeLiveBinding({
    offeringRef: ref,
    providerConfig: t.config,
    apiKey: key(t.keyFile),
    adapter: t.adapter,
    tools,
  });
  const perms = permutationsForReasoning(t.offering.profile.reasoning);
  const core = await runSuite(coreScenario, perms, binding);
  console.log(renderSuiteReport(core));
}

console.log('\nDONE.');
