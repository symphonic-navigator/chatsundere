// SPDX-License-Identifier: LGPL-3.0-only
//
// One-off live verification harness for the Mistral offerings (run via the
// /curate skill, NEVER in CI — it needs keys/.mistral-test-key and
// keys/.nano-test-key). Runs the deterministic conversation-suite against each
// Mistral offering across its full reasoning permutation matrix, plus the vision
// scenario for vision-capable offerings. Prints a Markdown PASS/FAIL report per
// offering.
//
// It covers BOTH deployments:
//   - the direct Mistral Cloud provider (the polymorphic thinking-in-content
//     parser is the novel risk being verified here), and
//   - the Mistral offerings on the nano-gpt anonymous-router (slug-swap
//     reasoning for Small 4 / Medium 3.5, a `reasoning_effort` body flag for
//     Large 4; standard `reasoning` channel). Their adapters are resolved from
//     the registry after `registerNanoGpt()`, so the run exercises the
//     production wiring rather than a hand-picked adapter.
//
//   bun run curation/run-mistral-suite.ts                (from packages/llm-unified)
//   bun run curation/run-mistral-suite.ts mistral        (provider-id filter)
//   bun run curation/run-mistral-suite.ts nano-gpt small (provider-id + slug substring)
import { readFileSync } from 'node:fs';
import type { ModelAdapter, ToolDef } from '../src/adapter-contract.js';
import { getAdapter } from '../src/adapter-registry.js';
import { mistralAdapter } from '../src/adapters/mistral-openai.js';
import type { Offering } from '../src/catalogue/types.js';
import { mistral } from '../src/providers/mistral.js';
import { nanoGpt, registerNanoGpt } from '../src/providers/nano-gpt.js';
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

function readKey(file: string): string {
  return readFileSync(new URL(`../../../keys/${file}`, import.meta.url), 'utf8').trim();
}

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

interface ProviderTarget {
  providerId: string;
  apiKey: string;
  providerConfig: ProviderConfig;
  offerings: Offering[];
  /** Build the hand-written adapter for one offering on this provider. */
  adapterFor(o: Offering): ModelAdapter;
}

registerNanoGpt();

const targets: ProviderTarget[] = [
  {
    providerId: 'mistral',
    apiKey: readKey('.mistral-test-key'),
    providerConfig: { baseUrl: mistral.baseUrl, routing: { kind: 'direct' } },
    offerings: mistral.offerings,
    adapterFor: (o) =>
      mistralAdapter(o.upstreamSlug, { vision: o.profile.vision, reasoning: o.profile.reasoning }),
  },
  {
    providerId: 'nano-gpt',
    apiKey: readKey('.nano-test-key'),
    providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } },
    // Only the Mistral-family offerings on nano-gpt.
    offerings: nanoGpt.offerings.filter((o) => o.canonicalRef?.startsWith('mistral-')),
    adapterFor: (o) => {
      const adapter = o.adapter.kind === 'catalogue' ? getAdapter(o.adapter.adapterId) : undefined;
      if (!adapter)
        throw new Error(`No catalogue adapter registered for nano-gpt:${o.upstreamSlug}`);
      return adapter;
    },
  },
];

// Optional argv filters: argv[2] = provider-id substring, argv[3] = slug substring.
const providerFilter = process.argv[2];
const slugFilter = process.argv[3];

for (const t of targets) {
  if (providerFilter && !t.providerId.includes(providerFilter)) continue;
  const offs = slugFilter
    ? t.offerings.filter((o) => o.upstreamSlug.toLowerCase().includes(slugFilter.toLowerCase()))
    : t.offerings;

  for (const o of offs) {
    const adapter = t.adapterFor(o);
    const binding = makeLiveBinding({
      offeringRef: `${t.providerId}:${o.upstreamSlug}`,
      providerConfig: t.providerConfig,
      apiKey: t.apiKey,
      adapter,
      tools,
    });

    console.log(
      `\n${'='.repeat(72)}\nOFFERING ${t.providerId}:${o.upstreamSlug}\n${'='.repeat(72)}`,
    );

    const perms = permutationsForReasoning(o.profile.reasoning);
    const core = await runSuite(coreScenario, perms, binding);
    console.log(renderSuiteReport(core));

    if (o.profile.vision) {
      const vision = await runSuite(visionScenario, VISION_PERM, binding);
      console.log(renderSuiteReport(vision));
    }
  }
}

console.log('\nDONE.');
