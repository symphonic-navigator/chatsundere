// SPDX-License-Identifier: LGPL-3.0-only

import { registerAdapter } from '../adapter-registry.js';
import { novitaGlmAdapter } from '../adapters/novita-glm.js';
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

function genericOffering(
  canonicalRef: string,
  slug: string,
  reasoning: ReasoningControl,
  vision: boolean,
  ctx: number,
): Offering {
  return {
    canonicalRef,
    providerId: 'novita',
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

// A live-curated GLM offering: hand-written `enable_thinking`-toggle adapter,
// verified. Both glm-5 and glm-5.1 disable cleanly via enable_thinking on novita.
function glmOffering(canonicalRef: string, slug: string, ctx: number): Offering {
  return {
    canonicalRef,
    providerId: 'novita',
    upstreamSlug: slug,
    adapter: { kind: 'catalogue', adapterId: `novita:${slug}` },
    profile: {
      reasoning: TOGGLE_ON,
      toolCalls: { supported: true, streaming: false, concurrentWithReasoning: true },
      vision: false,
      replayReasoning: false,
    },
    context: { recommended: ctx, max: ctx },
    trust: { tee: false, zdr: false },
    freedomOrientedDeployment: true, // Chris (2026-05-30): novita adds no censorship
    source: 'curated',
    confidence: 'verified',
  };
}

const offerings: Offering[] = [
  genericOffering('deepseek-v4-flash', 'deepseek/deepseek-v4-flash', STEPS, false, 200_000),
  genericOffering('deepseek-v4-pro', 'deepseek/deepseek-v4-pro', STEPS, false, 200_000),
  glmOffering('glm-5', 'zai-org/glm-5', 200_000),
  glmOffering('glm-5.1', 'zai-org/glm-5.1', 200_000),
  genericOffering('kimi-k2.6', 'moonshotai/kimi-k2.6', TOGGLE_ON, true, 256_000),
  genericOffering('gemma-4-31b', 'google/gemma-4-31b-it', TOGGLE_ON, true, 262_144),
];

export const novita: ProviderDefinition = {
  id: 'novita',
  displayName: 'Novita AI',
  iconKey: 'novita',
  baseUrl: 'https://api.novita.ai/v3/openai',
  shape: 'openai-chat-completions',
  capabilities: ['llm', 'streaming'],
  configFields: [apiKeyField('Novita AI API key')],
  probe: { path: '/models', method: 'GET' },
  secretFields: new Set(['api_key']),
  corsHint: 'direct',
  offerings,
  sortPriority: 20,
};

export function registerNovita(): void {
  registerProvider(novita);
  for (const o of offerings) {
    if (o.adapter.kind === 'catalogue') {
      registerAdapter(o.adapter.adapterId, novitaGlmAdapter(o.upstreamSlug, o.profile.vision));
    }
  }
}
