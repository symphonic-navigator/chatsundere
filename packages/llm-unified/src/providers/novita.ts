// SPDX-License-Identifier: LGPL-3.0-only

import { registerProvider } from '../registry.js';
import { apiKeyField } from './_helpers.js';

export function registerNovita(): void {
  registerProvider({
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
    knownModels: [{ id: 'glm-5.1', displayName: 'GLM 5.1', notes: 'The exotic one' }],
    sortPriority: 20,
  });
}
