// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { addGeneratedArtefact, getArtefact } from '../../src/data/artefacts.js';
import { QK } from '../../src/data/queryKeys.js';
import type { IntegrationContext } from '../../src/integrations/types.js';
import type { AgentLoopResult } from '../../src/lib/agent-loop.js';
import { runCraft, runCraftInspect, runCraftModify } from '../../src/lib/artefact-craft-runner.js';
import { makeCraftTools } from '../../src/lib/artefact-craft-tools.js';
import { queryClient } from '../../src/lib/queryClient.js';
import type { SubagentBase } from '../../src/lib/subagent-base.js';

const CHAT = 'chat-runner-1';
const PERSONA = 'persona-runner';

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
});

afterEach(async () => {
  await _resetClientDataDbForTests();
});

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
    chatId: CHAT,
    personaId: PERSONA,
    personaOffering: { providerId: 'nano-gpt', upstreamSlug: 'glm-5.1' },
    getKey: async () => 'api-key',
    ...over,
  };
}

const stubBase = {
  base: {
    provider: { id: 'x', baseUrl: 'https://x' },
    providerConfig: { baseUrl: 'https://x', routing: { kind: 'direct' as const } },
    apiKey: '',
    target: { slug: 'm' },
  } as unknown as SubagentBase,
  reasoning: { enabled: false as const },
};

describe('runCraft preflight', () => {
  it('modify missing id fails without calling the model loop', async () => {
    const runLoop = vi.fn(async (): Promise<AgentLoopResult> => {
      throw new Error('should not run');
    });
    const r = await runCraftModify({
      ctx: ctx(),
      artefactId: 'does-not-exist',
      briefOrQuestion: 'make it blue',
      resolveBase: () => stubBase,
      runLoop,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not found/i);
    expect(runLoop).not.toHaveBeenCalled();
  });

  it('modify wrong chat fails without calling the model loop', async () => {
    const id = await addGeneratedArtefact({
      chatId: 'other-chat',
      personaId: PERSONA,
      title: 'X',
      content: '<html></html>',
    });
    const runLoop = vi.fn(async (): Promise<AgentLoopResult> => {
      throw new Error('should not run');
    });
    const r = await runCraftModify({
      ctx: ctx(),
      artefactId: id,
      briefOrQuestion: 'tweak',
      resolveBase: () => stubBase,
      runLoop,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not in this chat/i);
    expect(runLoop).not.toHaveBeenCalled();
  });

  it('empty brief fails without calling the model', async () => {
    const id = await addGeneratedArtefact({
      chatId: CHAT,
      personaId: PERSONA,
      title: 'X',
      content: '<html></html>',
    });
    const runLoop = vi.fn(async (): Promise<AgentLoopResult> => {
      throw new Error('should not run');
    });
    const r = await runCraftModify({
      ctx: ctx(),
      artefactId: id,
      briefOrQuestion: '   ',
      resolveBase: () => stubBase,
      runLoop,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/brief/i);
    expect(runLoop).not.toHaveBeenCalled();
  });
});

describe('runCraft modify / inspect with mocked loop', () => {
  it('modify success meta includes artefactId, updatedAt, complete from ledger', async () => {
    const id = await addGeneratedArtefact({
      chatId: CHAT,
      personaId: PERSONA,
      title: 'Calc',
      content: '<html>old</html>',
      format: 'html',
    });
    const updatedAt = 1_700_000_000_123;
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const runLoop = vi.fn(
      async (): Promise<AgentLoopResult> => ({
        finalText: 'Updated colours.',
        ledger: [
          {
            op: 'replace_current',
            targetId: id,
            success: true,
            resultingUpdatedAt: updatedAt,
            at: Date.now(),
          },
        ],
        roundsUsed: 2,
        roundLimitReached: false,
        stoppedByAbort: false,
      }),
    );

    // Simulate write already applied by loop tools
    const { updateArtefactContent } = await import('../../src/data/artefacts.js');
    await updateArtefactContent(id, '<html>new</html>');
    const after = await getArtefact(id);
    expect(after).toBeTruthy();

    const r = await runCraftModify({
      ctx: ctx(),
      artefactId: id,
      briefOrQuestion: 'make it new',
      resolveBase: () => stubBase,
      runLoop,
    });

    expect(r.ok).toBe(true);
    expect(r.output).toContain('Updated colours');
    expect(r.meta?.artefactId).toBe(id);
    expect(r.meta?.complete).toBe('complete');
    expect(r.meta?.format).toBe('html');
    expect(typeof r.meta?.updatedAt).toBe('number');
    expect(spy).toHaveBeenCalledWith({ queryKey: QK.chatArtefacts(CHAT) });
    spy.mockRestore();
  });

  it('inspect does not offer replace (allowWrite false) and returns explanation', async () => {
    const id = await addGeneratedArtefact({
      chatId: CHAT,
      personaId: PERSONA,
      title: 'Notes',
      content: '# Hello',
      format: 'markdown',
    });
    const makeTools = vi.fn(makeCraftTools);
    const runLoop = vi.fn(
      async (): Promise<AgentLoopResult> => ({
        finalText: 'It is a short markdown note titled Hello.',
        ledger: [{ op: 'read_current', targetId: id, success: true, at: Date.now() }],
        roundsUsed: 1,
        roundLimitReached: false,
        stoppedByAbort: false,
      }),
    );

    const r = await runCraftInspect({
      ctx: ctx(),
      artefactId: id,
      briefOrQuestion: 'What is this about?',
      resolveBase: () => stubBase,
      runLoop,
      makeTools,
    });

    expect(makeTools).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: CHAT, currentId: id, allowWrite: false }),
    );
    const tools = makeTools.mock.results[0]?.value as ReturnType<typeof makeCraftTools>;
    expect(tools.map((t) => t.name)).not.toContain('replace_current_artefact');

    expect(r.ok).toBe(true);
    expect(r.output).toContain('markdown note');
    expect(r.meta?.artefactId).toBe(id);
    expect(r.meta?.title).toBe('Notes');
    expect(r.meta?.complete).toBeUndefined();
  });

  it('modify with no replace yields complete no-change and does not require updatedAt', async () => {
    const id = await addGeneratedArtefact({
      chatId: CHAT,
      personaId: PERSONA,
      title: 'X',
      content: '<html>a</html>',
    });
    const runLoop = vi.fn(
      async (): Promise<AgentLoopResult> => ({
        finalText: 'Already fine.',
        ledger: [],
        roundsUsed: 1,
        roundLimitReached: false,
        stoppedByAbort: false,
      }),
    );
    const r = await runCraft({
      ctx: ctx(),
      artefactId: id,
      briefOrQuestion: 'maybe tweak',
      mode: 'modify',
      resolveBase: () => stubBase,
      runLoop,
    });
    expect(r.ok).toBe(true);
    expect(r.meta?.complete).toBe('no-change');
  });

  it('missing expert key returns artefactExpertUnavailable without loop', async () => {
    const id = await addGeneratedArtefact({
      chatId: CHAT,
      personaId: PERSONA,
      title: 'X',
      content: '<html></html>',
    });
    const runLoop = vi.fn(async (): Promise<AgentLoopResult> => {
      throw new Error('no');
    });
    const r = await runCraftModify({
      ctx: ctx({
        artefactExpert: { providerId: 'anthropic', upstreamSlug: 'opus' },
        getKey: async () => null,
      }),
      artefactId: id,
      briefOrQuestion: 'edit',
      resolveBase: () => stubBase,
      runLoop,
    });
    expect(r.ok).toBe(false);
    expect(r.meta?.artefactExpertUnavailable).toBe(true);
    expect(runLoop).not.toHaveBeenCalled();
  });
});
