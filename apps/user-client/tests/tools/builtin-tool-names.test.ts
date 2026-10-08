// SPDX-License-Identifier: AGPL-3.0-only
import type { WebContext, WebInterfacingProvider } from '@chatsundere/llm-unified';
import { describe, expect, it, vi } from 'vitest';
import type { IntegrationContext } from '../../src/integrations/types.js';
import { buildWebTools } from '../../src/integrations/web/build-web-tools.js';
import type { KnowledgeContext } from '../../src/knowledge/query-tool.js';
import type { ExpertBase } from '../../src/tools/ask-expert.js';
import { BUILTIN_TOOL_NAMES } from '../../src/tools/builtin-tool-names.js';
import { resolveActiveTools } from '../../src/tools/registry.js';

const dormantCtx: IntegrationContext = {
  nsfwAllowed: false,
  tonalityEnabled: false,
  globalInstructions: '',
  location: null,
  webSearch: null,
  webFetch: null,
  useProxy: false,
  webSearchTierId: null,
  artefactExpert: null,
  getKey: async () => null,
  chatId: '',
  personaId: '',
  personaOffering: { providerId: '', upstreamSlug: '' },
};

const webCtx: WebContext = { nsfwAllowed: false, location: null, useProxy: true };
const webProvider: WebInterfacingProvider = {
  search: async (query) => ({ query, hits: [] }),
  fetch: async (url) => ({ url, content: '' }),
};

describe('BUILTIN_TOOL_NAMES', () => {
  it('is exactly the set of tools the registry can produce without MCP', () => {
    const knowledge: KnowledgeContext = {
      libraries: [{ id: 'a', name: 'A', description: '' }],
      retrieve: async () => [],
    };
    const registryTools = resolveActiveTools(
      dormantCtx,
      knowledge,
      {
        base: {} as ExpertBase,
        modelLabel: 'M',
        reasoning: { enabled: true },
        runtimeEnabled: true,
      },
      null,
      {
        chatId: 'c1',
        personaId: 'p1',
        primary: null,
        nsfwSlot: null,
        nsfwParamAllowed: false,
        generate: vi.fn(),
        persistImage: vi.fn(),
      },
      { personaId: 'p1' },
    );
    // The web integration resolves catalogue offerings first; its tools come
    // from buildWebTools, which it calls with the resolved backends.
    const webTools = buildWebTools({
      search: { provider: webProvider, providerId: 'p', tierParams: {} },
      fetch: { provider: webProvider, providerId: 'p' },
      ctx: webCtx,
      getKey: async () => null,
    });
    const produced = new Set([...registryTools, ...webTools].map((t) => t.name));
    expect(produced).toEqual(new Set(BUILTIN_TOOL_NAMES));
  });
});
