// SPDX-License-Identifier: LGPL-3.0-only

import { registerProvider } from '../registry.js';
import { apiKeyField } from './_helpers.js';

export function registerNanoGpt(): void {
  registerProvider({
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
    knownModels: [
      { id: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash', notes: 'Block 1 demo default' },
    ],
    sortPriority: 10,
  });
}
