// SPDX-License-Identifier: LGPL-3.0-only
//
// Live verification harness for the OpenAI (ChatGPT) offerings added 2026-07-06
// (run via the /curate skill, NEVER in CI — it needs keys/.{or,nano}-test-key).
// Runs the deterministic conversation-suite against each new ChatGPT offering
// across its reasoning permutation matrix plus the vision scenario, with the
// SAME adapter the provider registers in production (openRouterAdapter, with the
// OpenRouter reasoning offerings carrying include_reasoning exactly as
// registerOpenRouter binds them). Prints a Markdown PASS/FAIL report.
//
//   bun run curation/run-openai-suite.ts             (from packages/llm-unified)
//   bun run curation/run-openai-suite.ts openrouter  (substring-filter by label)
//   bun run curation/run-openai-suite.ts gpt-5.1      (filter to one slug)
import { readFileSync } from 'node:fs';
import type { ModelAdapter, ToolDef } from '../src/adapter-contract.js';
import { openRouterAdapter } from '../src/adapters/openrouter-openai.js';
import type { ReasoningControl } from '../src/catalogue/types.js';
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

const key = (file: string) =>
  readFileSync(new URL(`../../../keys/${file}`, import.meta.url), 'utf8').trim();

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

const STEPS: ReasoningControl = {
  mode: 'steps',
  steps: ['off', 'low', 'medium', 'high'],
  offStep: 'off',
  defaultStep: 'medium',
};
const NONE: ReasoningControl = { mode: 'none' };

const NANO = 'https://nano-gpt.com/api/v1';
const OR = 'https://openrouter.ai/api/v1';

interface Target {
  label: string;
  baseUrl: string;
  apiKey: string;
  adapter: ModelAdapter;
}

// Each canonical served on both nano-gpt and OpenRouter, wiring the EXACT adapter
// the provider registers in production: nano-gpt surfaces the reasoning summary
// natively (no flag); OpenRouter gates it behind include_reasoning.
interface Spec {
  slug: string;
  reasoning: ReasoningControl;
}
const specs: Spec[] = [
  { slug: 'openai/gpt-4o', reasoning: NONE },
  { slug: 'openai/gpt-4o-2024-11-20', reasoning: NONE },
  { slug: 'openai/gpt-4.1', reasoning: NONE },
  { slug: 'openai/gpt-5.1', reasoning: STEPS },
  { slug: 'openai/gpt-5.4', reasoning: STEPS },
  { slug: 'openai/gpt-5.5', reasoning: STEPS },
];

const nanoKey = key('.nano-test-key');
const orKey = key('.or-test-key');

const targets: Target[] = specs.flatMap((s): Target[] => [
  {
    label: `nano-gpt:${s.slug}`,
    baseUrl: NANO,
    apiKey: nanoKey,
    adapter: openRouterAdapter(s.slug, { vision: true, reasoning: s.reasoning }),
  },
  {
    label: `openrouter:${s.slug}`,
    baseUrl: OR,
    apiKey: orKey,
    adapter: openRouterAdapter(s.slug, {
      vision: true,
      reasoning: s.reasoning,
      includeReasoning: true,
    }),
  },
]);

const filter = process.argv[2];
const selected = filter
  ? targets.filter((t) => t.label.toLowerCase().includes(filter.toLowerCase()))
  : targets;

for (const t of selected) {
  const providerConfig: ProviderConfig = { baseUrl: t.baseUrl, routing: { kind: 'direct' } };
  const binding = makeLiveBinding({
    offeringRef: t.label,
    providerConfig,
    apiKey: t.apiKey,
    adapter: t.adapter,
    tools,
  });

  console.log(`\n${'='.repeat(72)}\nOFFERING ${t.label}\n${'='.repeat(72)}`);

  const perms = permutationsForReasoning(t.adapter.profile.reasoning);
  const core = await runSuite(coreScenario, perms, binding);
  console.log(renderSuiteReport(core));

  if (t.adapter.profile.vision) {
    const vision = await runSuite(visionScenario, VISION_PERM, binding);
    console.log(renderSuiteReport(vision));
  }
}

console.log('\nDONE.');
