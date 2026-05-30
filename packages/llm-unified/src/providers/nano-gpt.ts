// SPDX-License-Identifier: LGPL-3.0-only

import { registerAdapter } from '../adapter-registry.js';
import { nanoGptGlmAdapter } from '../adapters/nano-gpt-glm.js';
import type { Offering, ReasoningControl } from '../catalogue/types.js';
import { registerProvider } from '../registry.js';
import type { ProviderDefinition } from '../types.js';
import { apiKeyField } from './_helpers.js';

const TOGGLE_ON: ReasoningControl = { mode: 'toggle', defaultOn: true };
const STEPS: ReasoningControl = {
  mode: 'steps',
  steps: ['low', 'medium', 'high'],
  offStep: 'off',
  defaultStep: 'medium',
};
// glm-5.1 on nano-gpt: bare slug is cleanly reasoning-off, `:thinking` honours
// effort → the full steps surface. glm-5 differs: its bare slug reasons
// regardless (probed live), so reasoning cannot be disabled → fixed-on. Both
// share the slug-swap adapter; only the declared control differs.
const GLM_FIXED_ON: ReasoningControl = { mode: 'fixed-on' };

function genericOffering(
  canonicalRef: string,
  slug: string,
  reasoning: ReasoningControl,
  vision: boolean,
  ctx: number,
): Offering {
  return {
    canonicalRef,
    providerId: 'nano-gpt',
    upstreamSlug: slug,
    adapter: { kind: 'generic' },
    profile: {
      reasoning,
      toolCalls: { supported: true, streaming: true, concurrentWithReasoning: false },
      vision,
      replayReasoning: false,
    },
    context: { recommended: ctx, max: ctx },
    trust: { tee: false, zdr: false },
    freedomOrientedDeployment: null,
    source: 'curated',
    confidence: 'heuristic',
  };
}

// A live-curated GLM offering: hand-written slug-swap adapter, verified.
function glmOffering(
  canonicalRef: string,
  slug: string,
  reasoning: ReasoningControl,
  ctx: number,
): Offering {
  return {
    canonicalRef,
    providerId: 'nano-gpt',
    upstreamSlug: slug,
    adapter: { kind: 'catalogue', adapterId: `nano-gpt:${slug}` },
    profile: {
      reasoning,
      toolCalls: { supported: true, streaming: false, concurrentWithReasoning: true },
      vision: false,
      replayReasoning: false,
    },
    context: { recommended: ctx, max: ctx },
    trust: { tee: false, zdr: false },
    freedomOrientedDeployment: true, // Chris (2026-05-30): nano-gpt adds no censorship
    source: 'curated',
    confidence: 'verified',
  };
}

const offerings: Offering[] = [
  genericOffering('deepseek-v4-flash', 'deepseek/deepseek-v4-flash', STEPS, false, 200_000),
  genericOffering('deepseek-v4-pro', 'deepseek/deepseek-v4-pro', STEPS, false, 200_000),
  glmOffering('glm-5', 'zai-org/glm-5', GLM_FIXED_ON, 200_000),
  glmOffering('glm-5.1', 'zai-org/glm-5.1', STEPS, 200_000),
  genericOffering('kimi-k2.6', 'moonshotai/kimi-k2.6', TOGGLE_ON, true, 256_000),
  genericOffering('gemma-4-31b', 'google/gemma-4-31b-it', TOGGLE_ON, true, 262_144),
];

export const nanoGpt: ProviderDefinition = {
  id: 'nano-gpt',
  displayName: 'nano-gpt',
  iconKey: 'nano-gpt',
  baseUrl: 'https://nano-gpt.com/api/v1',
  shape: 'openai-chat-completions',
  capabilities: ['llm', 'streaming'],
  configFields: [apiKeyField('nano-gpt API key')],
  probe: { path: '/models', method: 'GET' },
  secretFields: new Set(['api_key']),
  corsHint: 'inofficial',
  offerings,
  sortPriority: 40,
};

export function registerNanoGpt(): void {
  registerProvider(nanoGpt);
  for (const o of offerings) {
    if (o.adapter.kind === 'catalogue') {
      registerAdapter(
        o.adapter.adapterId,
        nanoGptGlmAdapter(o.upstreamSlug, o.profile.vision, o.profile.reasoning),
      );
    }
  }
}
