import { describe, expect, it } from 'vitest';
import type { IntegrationContext } from '../../src/integrations/types.js';
import {
  dispatch,
  resolveActiveTools,
  systemPromptSegment,
  toolDefs,
} from '../../src/tools/registry.js';

// At zero configured integrations the active set is exactly the static tools
// (calculate_js), so these concrete projection checks exercise the real tool.
const dormantCtx: IntegrationContext = {
  nsfwAllowed: false,
  location: null,
  webSearch: null,
  webFetch: null,
  corsProxyUrl: null,
  corsProxyKey: null,
  webSearchTierId: null,
  getKey: async () => null,
};

describe('tool registry', () => {
  it('projects registered tools into wire ToolDefs', () => {
    const defs = toolDefs(resolveActiveTools(dormantCtx));
    const calc = defs.find((d) => d.name === 'calculate_js');
    expect(calc).toBeDefined();
    expect(calc?.parameters).toHaveProperty('properties');
    // ToolDef carries only the wire-relevant fields.
    expect(Object.keys(calc ?? {}).sort()).toEqual(['description', 'name', 'parameters']);
  });

  it('joins non-null instructions into the system-prompt segment', () => {
    const seg = systemPromptSegment(resolveActiveTools(dormantCtx));
    expect(seg).not.toBeNull();
    expect(seg).toContain('calculate_js');
  });

  it('returns a structured error for an unknown tool name', async () => {
    const r = await dispatch(resolveActiveTools(dormantCtx), 'no_such_tool', {});
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Unknown tool');
  });
});
