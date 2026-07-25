// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from 'vitest';
import type { IntegrationContext } from '../../src/integrations/types.js';
import { resolveActiveTools } from '../../src/tools/registry.js';

test('artefact tools are among the active tools in stable order', () => {
  const ctx: IntegrationContext = {
    nsfwAllowed: false,
    tonalityEnabled: false,
    globalInstructions: '',
    location: null,
    webSearch: null,
    webFetch: null,
    useProxy: false,
    webSearchTierId: null,
    artefactExpert: null,
    chatId: 'c1',
    personaId: 'p1',
    personaOffering: { providerId: 'nano-gpt', upstreamSlug: 'glm-5.1' },
    getKey: async () => null,
  };
  const names = resolveActiveTools(ctx).map((t) => t.name);
  const artefactNames = names.filter((n) =>
    ['list_artefacts', 'create_artefact', 'modify_artefact', 'inspect_artefact'].includes(n),
  );
  expect(artefactNames).toEqual([
    'list_artefacts',
    'create_artefact',
    'modify_artefact',
    'inspect_artefact',
  ]);
});
