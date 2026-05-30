// SPDX-License-Identifier: LGPL-3.0-only

import { registerAdapter } from '../adapter-registry.js';
import { novitaThinkingAdapter } from '../adapters/novita-thinking.js';
import type { Offering, ReasoningControl } from '../catalogue/types.js';
import { registerProvider } from '../registry.js';
import type { ProviderDefinition } from '../types.js';
import { apiKeyField } from './_helpers.js';

const TOGGLE_ON: ReasoningControl = { mode: 'toggle', defaultOn: true };

// A live-curated novita offering: hand-written `enable_thinking`-toggle adapter,
// verified. Serves the GLM, DeepSeek, Kimi and Gemma families (all disable
// cleanly via enable_thinking on novita).
function thinkingOffering(
  canonicalRef: string,
  slug: string,
  vision: boolean,
  ctx: number,
): Offering {
  return {
    canonicalRef,
    providerId: 'novita',
    upstreamSlug: slug,
    adapter: { kind: 'catalogue', adapterId: `novita:${slug}` },
    profile: {
      reasoning: TOGGLE_ON,
      toolCalls: { supported: true, streaming: false, concurrentWithReasoning: true },
      vision,
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
  thinkingOffering('deepseek-v4-flash', 'deepseek/deepseek-v4-flash', false, 200_000),
  thinkingOffering('deepseek-v4-pro', 'deepseek/deepseek-v4-pro', false, 200_000),
  thinkingOffering('glm-5', 'zai-org/glm-5', false, 200_000),
  thinkingOffering('glm-5.1', 'zai-org/glm-5.1', false, 200_000),
  thinkingOffering('kimi-k2.6', 'moonshotai/kimi-k2.6', true, 256_000),
  thinkingOffering('gemma-4-31b', 'google/gemma-4-31b-it', true, 262_144),
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
      registerAdapter(o.adapter.adapterId, novitaThinkingAdapter(o.upstreamSlug, o.profile.vision));
    }
  }
}
