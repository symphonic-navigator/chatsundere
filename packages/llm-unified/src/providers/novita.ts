// SPDX-License-Identifier: LGPL-3.0-only

import { registerProvider } from '../registry.js';
import type { ProviderDefinition } from '../types.js';
import { apiKeyField } from './_helpers.js';

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
  knownModels: [
    {
      id: 'deepseek/deepseek-v4-flash',
      displayName: 'DeepSeek V4 Flash',
      notes: 'Fast reasoning + tools',
      contextWindow: 200_000,
      reasoning: {
        kind: 'optional',
        effort: { buckets: ['low', 'medium', 'high'], defaultBucket: 'medium' },
        defaultOn: true,
        replayReasoning: false,
      },
      vision: false,
      tools: true,
    },
    {
      id: 'deepseek/deepseek-v4-pro',
      displayName: 'DeepSeek V4 Pro',
      notes: 'Stronger reasoning + tools',
      contextWindow: 200_000,
      reasoning: {
        kind: 'optional',
        effort: { buckets: ['low', 'medium', 'high'], defaultBucket: 'medium' },
        defaultOn: true,
        replayReasoning: false,
      },
      vision: false,
      tools: true,
    },
    {
      id: 'zai-org/glm-5',
      displayName: 'GLM 5',
      contextWindow: 200_000,
      reasoning: { kind: 'optional', defaultOn: true, replayReasoning: false },
      vision: false,
      tools: true,
    },
    {
      id: 'zai-org/glm-5.1',
      displayName: 'GLM 5.1',
      contextWindow: 200_000,
      reasoning: { kind: 'optional', defaultOn: true, replayReasoning: false },
      vision: false,
      tools: true,
    },
    {
      id: 'moonshotai/kimi-k2.6',
      displayName: 'Kimi K2.6',
      notes: 'Vision-capable',
      contextWindow: 256_000,
      reasoning: { kind: 'optional', defaultOn: true, replayReasoning: false },
      vision: true,
      tools: true,
    },
    {
      id: 'google/gemma-4-31b-it',
      displayName: 'Gemma 4 31B IT',
      notes: 'Open weight, vision-capable, tools occasionally hit-and-miss',
      contextWindow: 262_144,
      reasoning: { kind: 'optional', defaultOn: true, replayReasoning: false },
      vision: true,
      tools: true,
    },
  ],
  sortPriority: 20,
};

export function registerNovita(): void {
  registerProvider(novita);
}
