// SPDX-License-Identifier: LGPL-3.0-only
//
// One-off live verification harness for the Claude offerings on nano-gpt (run
// via the /curate skill, NEVER in CI — it needs keys/.nano-test-key). Runs the
// deterministic conversation-suite across the reasoning matrix, then a bespoke
// two-turn cache check that asserts Anthropic prompt-cache engages (cached
// prompt tokens > 0 on the second turn). Prints a Markdown report.
//
// nano-gpt is the DEFAULT Claude route (ADR 0032). The OpenRouter offerings
// (Sonnet 5, Opus 5) are covered by run-openrouter-suite.ts instead — they are a
// permissible second route since ADR 0037, and this harness's bespoke cache
// check is written against nano-gpt's usage envelope.
//
//   bun run curation/run-claude-suite.ts            (from packages/llm-unified)
//   bun run curation/run-claude-suite.ts opus-4.8   (substring-filter offerings)
import { readFileSync } from 'node:fs';
import type { ModelAdapter, ToolDef } from '../src/adapter-contract.js';
import { getAdapter } from '../src/adapter-registry.js';
import { nanoGpt, registerNanoGpt } from '../src/providers/nano-gpt.js';
import type { ProviderConfig, WireMessage } from '../src/types.js';
import {
  coreScenario,
  makeLiveBinding,
  permutationsForReasoning,
  renderSuiteReport,
  runSuite,
} from './conversation-suite/index.js';

registerNanoGpt();

const apiKey = readFileSync(
  new URL('../../../keys/.nano-test-key', import.meta.url),
  'utf8',
).trim();

const providerConfig: ProviderConfig = {
  baseUrl: nanoGpt.baseUrl,
  routing: { kind: 'direct' }, // server-side run: no CORS, talk to nano-gpt directly
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

const slugFilter = process.argv[2];
const claudeTargets = nanoGpt.offerings.filter(
  (o) =>
    o.canonicalRef?.startsWith('claude-') &&
    (!slugFilter || o.upstreamSlug.toLowerCase().includes(slugFilter.toLowerCase())),
);

// A large, stable system prefix (≈ 6k tokens) — comfortably above Anthropic's
// minimum cacheable block, so a cache_control breakpoint on it can be reused.
const bigSystem = 'You are a meticulous, concise assistant. '.repeat(800);

for (const o of claudeTargets) {
  if (o.adapter.kind !== 'catalogue') continue;
  const adapter = getAdapter(o.adapter.adapterId) as ModelAdapter;
  const binding = makeLiveBinding({
    offeringRef: o.adapter.adapterId,
    providerConfig,
    apiKey,
    adapter,
    tools,
  });

  console.log(
    `\n${'='.repeat(72)}\nOFFERING ${o.upstreamSlug} (${o.canonicalRef})\n${'='.repeat(72)}`,
  );

  // (a) Correctness + reasoning matrix (off / on for a toggle).
  const perms = permutationsForReasoning(o.profile.reasoning);
  const core = await runSuite(coreScenario, perms, binding);
  console.log(renderSuiteReport(core));

  // (b) Cache engagement: a large stable prefix, two turns. Turn 2 must report
  // cached prompt tokens > 0 if cache_control passes through nano-gpt.
  const turn1: WireMessage[] = [
    { role: 'system', content: bigSystem },
    { role: 'user', content: 'Say hello in one word.' },
  ];
  const u1 = await binding.runTurn(turn1, { enabled: false });
  const turn2: WireMessage[] = [
    ...turn1,
    { role: 'assistant', content: 'Hello.' },
    { role: 'user', content: 'Now say goodbye in one word.' },
  ];
  const u2 = await binding.runTurn(turn2, { enabled: false });
  const engaged = (u2.usage?.cachedTokens ?? 0) > 0 ? 'ENGAGED ✅' : 'NOT engaged ❌';
  console.log(
    `\nCACHE CHECK\n  turn1: prompt=${u1.usage?.promptTokens ?? '?'} cached=${u1.usage?.cachedTokens ?? 0}\n  turn2: prompt=${u2.usage?.promptTokens ?? '?'} cached=${u2.usage?.cachedTokens ?? 0}\n  → cache ${engaged}`,
  );
}

console.log('\nDONE.');
