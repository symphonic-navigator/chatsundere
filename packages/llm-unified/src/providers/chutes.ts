// SPDX-License-Identifier: LGPL-3.0-only
import { registerAdapter } from '../adapter-registry.js';
import { chutesAdapter } from '../adapters/chutes-openai.js';
import { registerProvider } from '../registry.js';
import type { KnownModel, ProviderDefinition } from '../types.js';
import { apiKeyField } from './_helpers.js';

const REASONING = {
  kind: 'optional' as const,
  effort: { buckets: ['low', 'medium', 'high'], defaultBucket: 'medium' },
  defaultOn: false,
  replayReasoning: false,
};

/** The curated chutes TEE models (all confidential_compute === true). */
const MODELS: Array<Omit<KnownModel, 'adapterId' | 'reasoning'> & { vision: boolean }> = [
  {
    id: 'deepseek-ai/DeepSeek-V3.2-TEE',
    displayName: 'DeepSeek V3.2 (TEE)',
    contextWindow: 131_072,
    vision: false,
    tools: true,
  },
  {
    id: 'moonshotai/Kimi-K2.6-TEE',
    displayName: 'Kimi K2.6 (TEE)',
    notes: 'QAT model',
    contextWindow: 262_144,
    vision: true,
    tools: true,
  },
  {
    id: 'zai-org/GLM-5.1-TEE',
    displayName: 'GLM 5.1 (TEE)',
    contextWindow: 202_752,
    vision: false,
    tools: true,
  },
  {
    id: 'google/gemma-4-31B-turbo-TEE',
    displayName: 'Gemma 4 31B Turbo (TEE)',
    notes: 'FP4 quant',
    contextWindow: 131_072,
    vision: true,
    tools: true,
  },
];

const knownModels: KnownModel[] = MODELS.map((m) => ({
  id: m.id,
  displayName: m.displayName,
  ...(m.notes ? { notes: m.notes } : {}),
  contextWindow: m.contextWindow,
  reasoning: REASONING,
  vision: m.vision,
  tools: m.tools,
  adapterId: `chutes:${m.id}`,
}));

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
  knownModels,
  sortPriority: 10,
};

export function registerChutes(): void {
  registerProvider(chutes);
  for (const m of MODELS) {
    registerAdapter(`chutes:${m.id}`, chutesAdapter(m.id, m.vision));
  }
}
