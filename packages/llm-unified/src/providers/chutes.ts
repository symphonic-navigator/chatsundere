// SPDX-License-Identifier: LGPL-3.0-only
import { registerAdapter } from '../adapter-registry.js';
import { chutesAdapter } from '../adapters/chutes-openai.js';
import type { Offering, ReasoningControl } from '../catalogue/types.js';
import { registerProvider } from '../registry.js';
import type { ProviderDefinition } from '../types.js';
import { apiKeyField } from './_helpers.js';

// Reasoning on chutes is a symmetric chat_template_kwargs toggle, not steps:
// the effort buckets do not measurably modulate the trace (probed live
// 2026-05-31), so a toggle is the honest control. The on-switch
// (enable_thinking:true) and channel parsing live in `chutesAdapter`.
const TOGGLE: ReasoningControl = { mode: 'toggle', defaultOn: true };

function chutesOffering(
  canonicalRef: string,
  slug: string,
  vision: boolean,
  ctx: number,
): Offering {
  return {
    canonicalRef,
    providerId: 'chutes',
    upstreamSlug: slug,
    adapter: { kind: 'catalogue', adapterId: `chutes:${slug}` },
    profile: {
      reasoning: TOGGLE,
      toolCalls: { supported: true, streaming: true, concurrentWithReasoning: false },
      vision,
      replayReasoning: false,
    },
    context: { recommended: ctx, max: ctx },
    trust: { tee: true, zdr: false },
    freedomOrientedDeployment: true,
    source: 'curated',
    confidence: 'verified',
    serviceKind: 'llm',
  };
}

const offerings: Offering[] = [
  chutesOffering('deepseek-v3.2', 'deepseek-ai/DeepSeek-V3.2-TEE', false, 131_072),
  chutesOffering('kimi-k2.6', 'moonshotai/Kimi-K2.6-TEE', true, 262_144),
  chutesOffering('glm-5', 'zai-org/GLM-5-TEE', false, 202_752),
  chutesOffering('glm-5.1', 'zai-org/GLM-5.1-TEE', false, 202_752),
  chutesOffering('gemma-4-31b', 'google/gemma-4-31B-turbo-TEE', true, 131_072),
];

export const chutes: ProviderDefinition = {
  id: 'chutes',
  displayName: 'Chutes',
  iconKey: 'chutes',
  baseUrl: 'https://llm.chutes.ai/v1',
  shape: 'openai-chat-completions',
  capabilities: ['llm', 'streaming', 'tools'],
  configFields: [apiKeyField('Chutes API key')],
  probe: { path: '/models', method: 'GET' },
  secretFields: new Set(['api_key']),
  corsHint: 'direct',
  offerings,
  sortPriority: 10,
};

export function registerChutes(): void {
  registerProvider(chutes);
  for (const o of offerings) {
    if (o.adapter.kind === 'catalogue') {
      registerAdapter(o.adapter.adapterId, chutesAdapter(o.upstreamSlug, o.profile.vision));
    }
  }
}
