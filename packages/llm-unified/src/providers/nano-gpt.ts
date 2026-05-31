// SPDX-License-Identifier: LGPL-3.0-only

import { registerAdapter } from '../adapter-registry.js';
import { nanoGptSlugSwapAdapter } from '../adapters/nano-gpt-slug-swap.js';
import type { Offering, ReasoningControl } from '../catalogue/types.js';
import { registerProvider } from '../registry.js';
import type { ProviderDefinition } from '../types.js';
import { apiKeyField } from './_helpers.js';

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

// Mistral on nano-gpt: reasoning is a binary on/off via the `:thinking` slug
// swap (no effort buckets — Mistral's reasoning toggle is binary), so a `toggle`
// rather than `steps`. The bare slug is cleanly reasoning-off and the `:thinking`
// sibling streams thinking on the standard `reasoning` channel — NOT the
// polymorphic content-array Mistral's own API uses (probed live 2026-05-31), so
// the existing nanoGptSlugSwapAdapter handles it unchanged. Large 3 has no
// `:thinking` sibling on nano-gpt → reasoning `none`.
const MISTRAL_TOGGLE: ReasoningControl = { mode: 'toggle', defaultOn: false };
const MISTRAL_NONE: ReasoningControl = { mode: 'none' };

// A live-curated nano-gpt offering: hand-written slug-swap adapter, verified.
// Serves the GLM, DeepSeek, Kimi and Gemma families (all slug-swap on nano-gpt).
function slugSwapOffering(
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
    adapter: { kind: 'catalogue', adapterId: `nano-gpt:${slug}` },
    profile: {
      reasoning,
      toolCalls: { supported: true, streaming: false, concurrentWithReasoning: true },
      vision,
      replayReasoning: false,
    },
    context: { recommended: ctx, max: ctx },
    trust: { tee: false, zdr: false },
    freedomOrientedDeployment: true, // Chris (2026-05-30): nano-gpt adds no censorship
    source: 'curated',
    confidence: 'verified',
    serviceKind: 'llm',
  };
}

const offerings: Offering[] = [
  slugSwapOffering('deepseek-v4-flash', 'deepseek/deepseek-v4-flash', STEPS, false, 200_000),
  slugSwapOffering('deepseek-v4-pro', 'deepseek/deepseek-v4-pro', STEPS, false, 200_000),
  slugSwapOffering('glm-5', 'zai-org/glm-5', GLM_FIXED_ON, false, 200_000),
  slugSwapOffering('glm-5.1', 'zai-org/glm-5.1', STEPS, false, 200_000),
  slugSwapOffering('kimi-k2.6', 'moonshotai/kimi-k2.6', STEPS, true, 256_000),
  slugSwapOffering('gemma-4-31b', 'google/gemma-4-31b-it', STEPS, true, 262_144),
  // Mistral family on nano-gpt (anonymous-router path). Small 4 and Medium 3.5
  // have `:thinking` siblings → binary toggle; Large 3 has none → no reasoning.
  // Vision is supported across the family (matches the direct-Mistral offerings).
  slugSwapOffering(
    'mistral-small-4',
    'mistralai/mistral-small-4-119b-2603',
    MISTRAL_TOGGLE,
    true,
    262_144,
  ),
  slugSwapOffering(
    'mistral-medium-3-5',
    'mistral/mistral-medium-3.5',
    MISTRAL_TOGGLE,
    true,
    262_144,
  ),
  slugSwapOffering(
    'mistral-large-3',
    'mistralai/mistral-large-3-675b-instruct-2512',
    MISTRAL_NONE,
    true,
    262_144,
  ),
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
        nanoGptSlugSwapAdapter(o.upstreamSlug, o.profile.vision, o.profile.reasoning),
      );
    }
  }
}
