// SPDX-License-Identifier: LGPL-3.0-only

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

const offerings: Offering[] = [
  genericOffering('deepseek-v4-flash', 'deepseek/deepseek-v4-flash', STEPS, false, 200_000),
  genericOffering('deepseek-v4-pro', 'deepseek/deepseek-v4-pro', STEPS, false, 200_000),
  genericOffering('glm-5', 'zai-org/glm-5', TOGGLE_ON, false, 200_000),
  genericOffering('glm-5.1', 'zai-org/glm-5.1', TOGGLE_ON, false, 200_000),
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
}
