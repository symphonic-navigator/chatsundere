// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import {
  makeInspectArtefactTool,
  makeModifyArtefactTool,
} from '../../src/integrations/artefact/artefact-integration.js';
import type { IntegrationContext } from '../../src/integrations/types.js';
import type { ToolResult } from '../../src/tools/types.js';

function ctx(over: Partial<IntegrationContext> = {}): IntegrationContext {
  return {
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
    getKey: async () => 'k',
    ...over,
  };
}

describe('modify_artefact / inspect_artefact persona tools', () => {
  it('modify missing artefactId fails without calling runModify', async () => {
    const runModify = vi.fn(async (): Promise<ToolResult> => {
      throw new Error('should not run');
    });
    const tool = makeModifyArtefactTool(ctx(), { runModify });
    const r = await tool.execute({ brief: 'do stuff' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/artefactId/i);
    expect(runModify).not.toHaveBeenCalled();
  });

  it('modify empty brief fails without calling runModify', async () => {
    const runModify = vi.fn(async (): Promise<ToolResult> => {
      throw new Error('should not run');
    });
    const tool = makeModifyArtefactTool(ctx(), { runModify });
    const r = await tool.execute({ artefactId: 'a1', brief: '  ' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/brief/i);
    expect(runModify).not.toHaveBeenCalled();
  });

  it('modify forwards artefactId and brief to runModify', async () => {
    const runModify = vi.fn(
      async (): Promise<ToolResult> => ({
        ok: true,
        output: 'done',
        error: null,
        meta: { artefactId: 'a1', complete: 'complete' },
      }),
    );
    const tool = makeModifyArtefactTool(ctx(), { runModify });
    const r = await tool.execute({ artefactId: 'a1', brief: 'make blue' });
    expect(r.ok).toBe(true);
    expect(runModify).toHaveBeenCalledWith(
      expect.objectContaining({
        artefactId: 'a1',
        briefOrQuestion: 'make blue',
      }),
    );
  });

  it('inspect missing question fails without calling runInspect', async () => {
    const runInspect = vi.fn(async (): Promise<ToolResult> => {
      throw new Error('should not run');
    });
    const tool = makeInspectArtefactTool(ctx(), { runInspect });
    const r = await tool.execute({ artefactId: 'a1', question: '' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/question/i);
    expect(runInspect).not.toHaveBeenCalled();
  });

  it('inspect forwards question to runInspect', async () => {
    const runInspect = vi.fn(
      async (): Promise<ToolResult> => ({
        ok: true,
        output: 'It has a form.',
        error: null,
        meta: { artefactId: 'a1', title: 'T' },
      }),
    );
    const tool = makeInspectArtefactTool(ctx(), { runInspect });
    const r = await tool.execute({ artefactId: 'a1', question: 'What widgets?' });
    expect(r.ok).toBe(true);
    expect(r.output).toContain('form');
    expect(runInspect).toHaveBeenCalledWith(
      expect.objectContaining({
        artefactId: 'a1',
        briefOrQuestion: 'What widgets?',
      }),
    );
  });
});
