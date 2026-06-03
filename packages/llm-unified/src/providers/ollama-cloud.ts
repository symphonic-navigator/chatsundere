// SPDX-License-Identifier: LGPL-3.0-only

import { registerAdapter } from '../adapter-registry.js';
import { ollamaNativeAdapter } from '../adapters/ollama-native.js';
import type { Offering, ReasoningControl } from '../catalogue/types.js';
import { registerProvider } from '../registry.js';
import type { ProviderDefinition } from '../types.js';
import { apiKeyField } from './_helpers.js';

// ollama.com serves reasoning-native models that cannot disable thinking
// (`think:false` still streams a `reasoning` channel) → fixed-on. Live-measured
// 2026-06-03.
const FIXED_ON: ReasoningControl = { mode: 'fixed-on' };

interface OllamaSpec {
  canonicalRef: string;
  slug: string;
  reasoning: ReasoningControl;
  vision: boolean;
  ctx: number;
}

function ollamaOffering(spec: OllamaSpec): Offering {
  return {
    canonicalRef: spec.canonicalRef,
    providerId: 'ollama-cloud',
    upstreamSlug: spec.slug,
    adapter: { kind: 'catalogue', adapterId: `ollama-cloud:${spec.slug}` },
    profile: {
      reasoning: spec.reasoning,
      toolCalls: { supported: true, streaming: true, concurrentWithReasoning: false },
      vision: spec.vision,
      replayReasoning: false,
    },
    context: { recommended: spec.ctx, max: spec.ctx },
    trust: { tee: false, zdr: false },
    freedomOrientedDeployment: null,
    source: 'curated',
    confidence: 'verified',
    serviceKind: 'llm',
  };
}

// Curated set, live-verified against ollama.com via run-ollama-suite.ts
// (2026-06-03). The earlier heuristic set carried three slugs that do not exist
// on ollama.com (`glm-5`, `deepseek-v4-flash`, `kimi-k2.6`) plus wrong reasoning
// controls — removed. `gemma4:31b` was dropped too: ollama serves a non-reasoning
// Gemma, which cannot satisfy the reasoning-required `gemma-4-31b` canonical.
//
// These talk to ollama's NATIVE `/api/chat` (NDJSON) via `ollamaNativeAdapter`,
// NOT the OpenAI-compat `/v1/chat/completions` shim — the shim makes these
// reasoning-native models re-call the tool instead of answering after a tool
// result (live-measured); the native endpoint answers correctly.
const SPECS: OllamaSpec[] = [
  { canonicalRef: 'glm-5.1', slug: 'glm-5.1', reasoning: FIXED_ON, vision: false, ctx: 200_000 },
  {
    canonicalRef: 'deepseek-v4-pro',
    slug: 'deepseek-v4-pro',
    reasoning: FIXED_ON,
    vision: false,
    ctx: 200_000,
  },
];

const offerings: Offering[] = SPECS.map(ollamaOffering);

export const ollamaCloud: ProviderDefinition = {
  id: 'ollama-cloud',
  displayName: 'Ollama Cloud',
  iconKey: 'ollama',
  // Bare host: the native adapter targets `/api/chat`; the probe hits
  // `/v1/models` (OpenAI-compat listing) explicitly.
  baseUrl: 'https://ollama.com',
  shape: 'openai-chat-completions',
  capabilities: ['llm', 'streaming'],
  configFields: [apiKeyField('Ollama Cloud API key')],
  probe: { path: '/v1/models', method: 'GET' },
  secretFields: new Set(['api_key']),
  corsHint: 'requires-proxy',
  offerings,
  sortPriority: 30,
};

export function registerOllamaCloud(): void {
  registerProvider(ollamaCloud);
  for (const spec of SPECS) {
    registerAdapter(
      `ollama-cloud:${spec.slug}`,
      ollamaNativeAdapter(spec.slug, { vision: spec.vision, reasoning: spec.reasoning }),
    );
  }
}
