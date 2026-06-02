import { describe, expect, it } from 'vitest';
import { dispatch, systemPromptSegment, toolDefs } from '../../src/tools/registry.js';

describe('tool registry', () => {
  it('projects registered tools into wire ToolDefs', () => {
    const defs = toolDefs();
    const calc = defs.find((d) => d.name === 'calculate_js');
    expect(calc).toBeDefined();
    expect(calc?.parameters).toHaveProperty('properties');
    // ToolDef carries only the wire-relevant fields.
    expect(Object.keys(calc ?? {}).sort()).toEqual(['description', 'name', 'parameters']);
  });

  it('joins non-null instructions into the system-prompt segment', () => {
    const seg = systemPromptSegment();
    expect(seg).not.toBeNull();
    expect(seg).toContain('calculate_js');
  });

  it('returns a structured error for an unknown tool name', async () => {
    const r = await dispatch('no_such_tool', {});
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Unknown tool');
  });
});
