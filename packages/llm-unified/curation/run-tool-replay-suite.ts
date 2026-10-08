// SPDX-License-Identifier: LGPL-3.0-only
//
// Live verification for tool history replay (spec 2026-10-08 §5.5). Run via the
// /curate skill, NEVER in CI — it reads keys/. For each target it runs:
//   - tool-replay (gate): with tools, the model must call generate_image from a
//     replayed history;
//   - tool-then-user (gate): with tools, a replayed history ending on a tool
//     result followed directly by a user turn (an interrupted call); a FAIL
//     means the client must emit a closing assistant message for that case;
//   - orphan-tool-replay (informational): WITHOUT tools; PASS ⇒ set
//     `toolCalls.orphanReplay: true` on that offering, an HTTP 400 ⇒ keep false.
// Run targets ONE AT A TIME and read every report in full.
//
//   bun run curation/run-tool-replay-suite.ts                 (all targets, serially)
//   bun run curation/run-tool-replay-suite.ts nano-gpt        (provider-id filter)
//   bun run curation/run-tool-replay-suite.ts nano-gpt claude (provider-id + slug substring)
import { readFileSync } from 'node:fs';
import type { ToolDef } from '../src/adapter-contract.js';
import { getAdapter } from '../src/adapter-registry.js';
import type { Offering } from '../src/catalogue/types.js';
import { registerBuiltinProviders } from '../src/providers/_register-builtins.js';
import { chutes } from '../src/providers/chutes.js';
import { mistral } from '../src/providers/mistral.js';
import { nanoGpt } from '../src/providers/nano-gpt.js';
import { novita } from '../src/providers/novita.js';
import { ollamaCloud } from '../src/providers/ollama-cloud.js';
import { openrouter } from '../src/providers/openrouter.js';
import { tensorix } from '../src/providers/tensorix.js';
import { wafer } from '../src/providers/wafer.js';
import type { ProviderDefinition } from '../src/types.js';
import {
  makeLiveBinding,
  orphanReplayScenario,
  permutationsForReasoning,
  renderSuiteReport,
  runSuite,
  toolReplayScenario,
  toolThenUserScenario,
} from './conversation-suite/index.js';

registerBuiltinProviders();

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

// One representative per provider, plus Claude on nano-gpt (an Anthropic
// backend behind an OpenAI surface — the strictest about tool history).
// xAI is not listed: there is no keys/.xai-test-key.
const TARGETS: { provider: ProviderDefinition; keyFile: string; slug: string }[] = [
  { provider: mistral, keyFile: '.mistral-test-key', slug: 'mistral-large-4' },
  { provider: nanoGpt, keyFile: '.nano-test-key', slug: 'mistralai/mistral-large-4' },
  { provider: nanoGpt, keyFile: '.nano-test-key', slug: 'claude-haiku-4-5-20251001' },
  { provider: chutes, keyFile: '.chutes-test-key', slug: 'zai-org/GLM-5.2-TEE' },
  { provider: novita, keyFile: '.novita-test-key', slug: 'moonshotai/kimi-k2.6' },
  { provider: ollamaCloud, keyFile: '.ollama-test-key', slug: 'glm-5.2:cloud' },
  // The OpenRouter test key only allows OpenAI-served routes (account setting),
  // so the representative is an OpenAI backend.
  { provider: openrouter, keyFile: '.or-test-key', slug: 'openai/gpt-4.1' },
  { provider: tensorix, keyFile: '.tensorix-test-key', slug: 'z-ai/glm-5.2' },
  { provider: wafer, keyFile: '.wafer-test-key', slug: 'GLM-5.2' },
];

function readKey(file: string): string {
  return readFileSync(new URL(`../../../keys/${file}`, import.meta.url), 'utf8').trim();
}

const providerFilter = process.argv[2];
const slugFilter = process.argv[3]?.toLowerCase();

for (const t of TARGETS) {
  if (providerFilter && !t.provider.id.includes(providerFilter)) continue;
  if (slugFilter && !t.slug.toLowerCase().includes(slugFilter)) continue;
  const offering = (t.provider.offerings as Offering[]).find((o) => o.upstreamSlug === t.slug);
  if (!offering) throw new Error(`No offering ${t.provider.id}:${t.slug}`);
  if (offering.adapter.kind !== 'catalogue') throw new Error(`${t.slug} has no catalogue adapter`);
  const adapter = getAdapter(offering.adapter.adapterId);
  if (!adapter) throw new Error(`Adapter ${offering.adapter.adapterId} not registered`);

  const ref = `${t.provider.id}:${t.slug}`;
  const common = {
    offeringRef: ref,
    providerConfig: { baseUrl: t.provider.baseUrl, routing: { kind: 'direct' as const } },
    apiKey: readKey(t.keyFile),
    adapter,
  };
  // Every reasoning permutation: on nano-gpt a reasoning toggle can swap to a
  // different upstream slug (`…-thinking`, `:thinking`), so orphanReplay and
  // the gates must hold on each of them.
  const perm = permutationsForReasoning(offering.profile.reasoning);

  console.log(`\n${'='.repeat(72)}\nOFFERING ${ref}\n${'='.repeat(72)}`);
  console.log(
    renderSuiteReport(
      await runSuite(toolReplayScenario, perm, makeLiveBinding({ ...common, tools })),
    ),
  );
  console.log(
    renderSuiteReport(
      await runSuite(toolThenUserScenario, perm, makeLiveBinding({ ...common, tools })),
    ),
  );
  console.log(
    renderSuiteReport(await runSuite(orphanReplayScenario, perm, makeLiveBinding(common))),
  );
}

console.log('\nDONE.');
