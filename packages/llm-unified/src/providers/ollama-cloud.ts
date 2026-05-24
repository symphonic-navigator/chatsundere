// SPDX-License-Identifier: LGPL-3.0-only

import { registerProvider } from '../registry.js';
import type { ProviderDefinition } from '../types.js';
import { apiKeyField } from './_helpers.js';

export const ollamaCloud: ProviderDefinition = {
  id: 'ollama-cloud',
  displayName: 'Ollama Cloud',
  iconKey: 'ollama',
  baseUrl: 'https://ollama.com/v1',
  shape: 'openai-chat-completions',
  capabilities: ['llm', 'streaming'],
  configFields: [apiKeyField('Ollama Cloud API key')],
  probe: { path: '/models', method: 'GET' },
  secretFields: new Set(['api_key']),
  corsHint: 'requires-proxy',
  knownModels: [
    {
      id: 'deepseek-v4-flash',
      displayName: 'DeepSeek V4 Flash',
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
      id: 'deepseek-v4-pro',
      displayName: 'DeepSeek V4 Pro',
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
      id: 'glm-5',
      displayName: 'GLM 5',
      contextWindow: 200_000,
      reasoning: { kind: 'optional', defaultOn: true, replayReasoning: false },
      vision: false,
      tools: true,
    },
    {
      id: 'glm-5.1',
      displayName: 'GLM 5.1',
      contextWindow: 200_000,
      reasoning: { kind: 'optional', defaultOn: true, replayReasoning: false },
      vision: false,
      tools: true,
    },
    {
      id: 'kimi-k2.6',
      displayName: 'Kimi K2.6',
      contextWindow: 256_000,
      reasoning: { kind: 'optional', defaultOn: true, replayReasoning: false },
      vision: true,
      tools: true,
    },
    {
      id: 'gemma4:31b',
      displayName: 'Gemma 4 31B',
      contextWindow: 262_144,
      reasoning: { kind: 'optional', defaultOn: true, replayReasoning: false },
      vision: true,
      tools: true,
    },
  ],
  sortPriority: 30,
};

export function registerOllamaCloud(): void {
  registerProvider(ollamaCloud);
}
