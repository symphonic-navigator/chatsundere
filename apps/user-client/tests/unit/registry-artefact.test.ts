// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from 'vitest';
import type { IntegrationContext } from '../../src/integrations/types.js';
import { resolveActiveTools } from '../../src/tools/registry.js';

test('create_artefact is among the active tools', () => {
  const ctx: IntegrationContext = {
    nsfwAllowed: false,
    location: null,
    webSearch: null,
    webFetch: null,
    corsProxyUrl: null,
    corsProxyKey: null,
    webSearchTierId: null,
    chatId: 'c1',
    personaId: 'p1',
    personaOffering: { providerId: 'nano-gpt', upstreamSlug: 'glm-5.1' },
    getKey: async () => null,
  };
  expect(resolveActiveTools(ctx).map((t) => t.name)).toContain('create_artefact');
});
