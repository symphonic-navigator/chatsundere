// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import type { IntegrationContext } from '../../src/integrations/types.js';
import type { ImageToolContext } from '../../src/tools/generate-image.js';
import { resolveActiveTools } from '../../src/tools/registry.js';

const dormantCtx: IntegrationContext = {
  nsfwAllowed: false,
  location: null,
  webSearch: null,
  webFetch: null,
  useProxy: false,
  webSearchTierId: null,
  getKey: async () => null,
  chatId: '',
  personaId: '',
  personaOffering: { providerId: '', upstreamSlug: '' },
};

function imagesCtx(primary: ImageToolContext['primary']): ImageToolContext {
  return {
    chatId: 'c1',
    personaId: 'p1',
    primary,
    nsfwSlot: null,
    nsfwParamAllowed: false,
    generate: vi.fn(),
    persistImage: vi.fn(),
  };
}

describe('resolveActiveTools — images', () => {
  it('includes generate_image when an images context is present — even unconfigured', () => {
    const tools = resolveActiveTools(dormantCtx, null, null, null, imagesCtx(null));
    expect(tools.some((t) => t.name === 'generate_image')).toBe(true);
  });

  it('omits it when images context is null (back-compat)', () => {
    const tools = resolveActiveTools(dormantCtx, null, null, null, null);
    expect(tools.some((t) => t.name === 'generate_image')).toBe(false);
  });
});
