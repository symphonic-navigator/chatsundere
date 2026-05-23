// SPDX-License-Identifier: LGPL-3.0-only

import { registerProvider } from '../registry.js';
import { apiKeyField } from './_helpers.js';

export function registerOllamaCloud(): void {
  registerProvider({
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
        id: 'kimi-k2.6',
        displayName: 'Kimi K2.6',
        notes: 'Block 1 demo default; routes via cors-proxy',
      },
    ],
    sortPriority: 30,
  });
}
