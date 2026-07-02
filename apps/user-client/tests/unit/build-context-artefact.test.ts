// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from 'vitest';
import { buildIntegrationContext } from '../../src/integrations/build-context.js';

test('context carries chatId, personaId and personaOffering', () => {
  const ctx = buildIntegrationContext(
    { adultPersona: false },
    { search: null, fetch: null },
    null,
    { useProxy: false, webSearchTierId: null },
    {
      chatId: 'c1',
      personaId: 'p1',
      personaOffering: { providerId: 'nano-gpt', upstreamSlug: 'glm-5.1' },
    },
  );
  expect(ctx.chatId).toBe('c1');
  expect(ctx.personaId).toBe('p1');
  expect(ctx.personaOffering).toEqual({ providerId: 'nano-gpt', upstreamSlug: 'glm-5.1' });
});
