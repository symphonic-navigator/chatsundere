// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { IntegrationContext } from '../../src/integrations/types.js';
import type { KnowledgeContext } from '../../src/knowledge/query-tool.js';
import type { McpToolContext } from '../../src/mcp/mcp-tools.js';
import type { ExpertBase } from '../../src/tools/ask-expert.js';
import {
  type ExpertToolContext,
  dispatch,
  resolveActiveTools,
  systemPromptSegment,
  toolDefs,
} from '../../src/tools/registry.js';
import type { Tool } from '../../src/tools/types.js';

const fakeTool: Tool = {
  name: 'echo',
  description: 'Echo',
  parameters: { type: 'object', properties: {} },
  systemPromptInstruction: 'Use echo to repeat.',
  execute: async (args) => ({ ok: true, output: String(args.text ?? ''), error: null }),
};

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

describe('tool registry composition', () => {
  it('always includes calculate_js and the four artefact tools, and nothing web-side when dormant', () => {
    const tools = resolveActiveTools(dormantCtx);
    expect(tools.map((t) => t.name)).toEqual([
      'calculate_js',
      'list_artefacts',
      'create_artefact',
      'modify_artefact',
      'inspect_artefact',
    ]);
  });

  it('appends query_knowledgebase when a knowledge context has libraries', () => {
    const knowledge: KnowledgeContext = {
      libraries: [{ id: 'a', name: 'A', description: '' }],
      retrieve: async () => [],
    };
    const tools = resolveActiveTools(dormantCtx, knowledge);
    expect(tools.some((t) => t.name === 'query_knowledgebase')).toBe(true);
  });

  it('omits query_knowledgebase when knowledge is null', () => {
    const tools = resolveActiveTools(dormantCtx, null);
    expect(tools.some((t) => t.name === 'query_knowledgebase')).toBe(false);
  });

  it('omits query_knowledgebase when knowledge has no libraries', () => {
    const knowledge: KnowledgeContext = {
      libraries: [],
      retrieve: async () => [],
    };
    const tools = resolveActiveTools(dormantCtx, knowledge);
    expect(tools.some((t) => t.name === 'query_knowledgebase')).toBe(false);
  });

  it('toolDefs projects each tool to its wire definition', () => {
    const defs = toolDefs([fakeTool]);
    expect(defs).toEqual([
      { name: 'echo', description: 'Echo', parameters: { type: 'object', properties: {} } },
    ]);
  });

  it('systemPromptSegment joins non-null instructions, or null when empty', () => {
    expect(systemPromptSegment([fakeTool])).toContain('Use echo');
    expect(systemPromptSegment([{ ...fakeTool, systemPromptInstruction: null }])).toBeNull();
  });

  it('dispatch routes by name and returns a structured error for unknown tools', async () => {
    const ok = await dispatch([fakeTool], 'echo', { text: 'hi' });
    expect(ok).toEqual({ ok: true, output: 'hi', error: null });
    const miss = await dispatch([fakeTool], 'nope', {});
    expect(miss.ok).toBe(false);
    expect(miss.error).toContain('Unknown tool');
  });

  it('includes ask_expert iff an expert context is given', () => {
    const expert: ExpertToolContext = {
      base: {} as ExpertBase,
      modelLabel: 'M',
      reasoning: { enabled: true },
      runtimeEnabled: true,
    };
    expect(resolveActiveTools(dormantCtx, null, null).some((t) => t.name === 'ask_expert')).toBe(
      false,
    );
    expect(resolveActiveTools(dormantCtx, null, expert).some((t) => t.name === 'ask_expert')).toBe(
      true,
    );
  });

  it('runtimeEnabled:false still includes the tool (cache-prefix stability)', () => {
    const expert: ExpertToolContext = {
      base: {} as ExpertBase,
      modelLabel: 'M',
      reasoning: { enabled: true },
      runtimeEnabled: false,
    };
    expect(resolveActiveTools(dormantCtx, null, expert).some((t) => t.name === 'ask_expert')).toBe(
      true,
    );
  });

  it('includes MCP tools when an mcp context is given', () => {
    const mcp: McpToolContext = {
      servers: [
        {
          id: 's',
          name: 'S',
          prefix: 'srv',
          routing: 'direct',
          resolvedEndpoint: 'https://s/mcp',
          auth: null,
          autoRun: true,
          tools: [{ name: 'go', description: 'd', inputSchema: {} }],
          hiddenTools: [],
        },
      ],
      getServerKey: async () => null,
      requestApproval: async () => true,
    };
    const tools = resolveActiveTools(dormantCtx, null, null, mcp);
    expect(tools.some((t) => t.name === 'srv_go')).toBe(true);
  });

  it('omits MCP tools when mcp context is null', () => {
    const tools = resolveActiveTools(dormantCtx, null, null, null);
    expect(tools.every((t) => !t.name.startsWith('srv_'))).toBe(true);
  });
});
