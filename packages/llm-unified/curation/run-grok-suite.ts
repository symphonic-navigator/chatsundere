// SPDX-License-Identifier: LGPL-3.0-only
//
// Live verification harness for the Grok offerings added 2026-06-28 (run via the
// /curate skill, NEVER in CI — it needs keys/.{or,nano,xai}-test-key). Runs the
// deterministic conversation-suite against each new Grok offering across its
// reasoning permutation matrix plus the vision scenario, with the SAME adapter
// the provider registers in production. Prints a Markdown PASS/FAIL report.
//
//   bun run curation/run-grok-suite.ts            (from packages/llm-unified)
//   bun run curation/run-grok-suite.ts openrouter (substring-filter by label)
import { readFileSync } from 'node:fs';
import type { ModelAdapter, ToolDef } from '../src/adapter-contract.js';
import { openRouterAdapter } from '../src/adapters/openrouter-openai.js';
import { xaiSlugSwapAdapter } from '../src/adapters/xai-openai.js';
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

interface GrokTarget {
  label: string;
  baseUrl: string;
  apiKey: string;
  adapter: ModelAdapter;
}

// Each target wires the EXACT adapter the provider registers in production, so a
// green run validates the real wire path (incl. OpenRouter's provider:{zdr:true}).
const targets: GrokTarget[] = [
  {
    label: 'openrouter:x-ai/grok-4.3 (ZDR)',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: key('.or-test-key'),
    adapter: openRouterAdapter('x-ai/grok-4.3', {
      vision: true,
      reasoning: { mode: 'toggle', defaultOn: true },
      zdr: true,
    }),
  },
  {
    label: 'openrouter:x-ai/grok-4.20 (ZDR)',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: key('.or-test-key'),
    adapter: openRouterAdapter('x-ai/grok-4.20', {
      vision: true,
      reasoning: { mode: 'toggle', defaultOn: true },
      zdr: true,
    }),
  },
  {
    label: 'nano-gpt:x-ai/grok-4.3',
    baseUrl: 'https://nano-gpt.com/api/v1',
    apiKey: key('.nano-test-key'),
    adapter: openRouterAdapter('x-ai/grok-4.3', {
      vision: true,
      reasoning: { mode: 'toggle', defaultOn: true },
    }),
  },
  {
    label: 'xai:grok-4.20 (slug-swap)',
    baseUrl: 'https://api.x.ai/v1',
    apiKey: key('.xai-test-key'),
    adapter: xaiSlugSwapAdapter('grok-4.20-0309-non-reasoning', 'grok-4.20-0309-reasoning', {
      vision: true,
    }),
  },
];

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
