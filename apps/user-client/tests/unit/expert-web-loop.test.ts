// SPDX-License-Identifier: AGPL-3.0-only
import type { StreamChunk } from '@chatsundere/llm-unified';
import { describe, expect, it, vi } from 'vitest';
import { buildWebTools } from '../../src/integrations/web/build-web-tools.js';
import type { SubagentBase } from '../../src/lib/subagent-base.js';
import { createAskExpertTool } from '../../src/tools/ask-expert.js';

const base = {} as SubagentBase;

function streamOf(chunks: StreamChunk[]): AsyncIterable<StreamChunk> {
  return (async function* () {
    for (const c of chunks) yield c;
  })();
}

describe('expert tool loop', () => {
  it('dispatches a web_search call then returns the follow-up answer', async () => {
    const webTools = buildWebTools({
      search: {
        provider: {
          async search(q) {
            return { query: q, hits: [{ title: 'T', url: 'https://x', snippet: 'S' }] };
          },
        },
        providerId: 'nano-gpt',
        tierParams: {},
      },
      fetch: null,
      ctx: { nsfwAllowed: true, location: null, corsProxyUrl: 'p', corsProxyKey: null },
      getKey: async () => 'k',
    });

    let call = 0;
    const streamFn = vi.fn(() => {
      call += 1;
      if (call === 1) {
        return streamOf([
          {
            type: 'tool-call',
            toolCallId: 'c1',
            name: 'web_search',
            argumentsJson: '{"query":"q"}',
          },
        ]);
      }
      return streamOf([{ type: 'token', text: 'final answer' }]);
    }) as never;

    const phases: string[] = [];
    const tool = createAskExpertTool(base, 'opus', { enabled: true }, true, streamFn, {
      tools: webTools,
      maxRounds: 8,
    });
    const r = await tool.execute({ question: 'hard?' }, undefined, (p) => {
      if (p.phase) phases.push(p.phase);
    });
    expect(r.ok).toBe(true);
    expect(r.output).toBe('final answer');
    expect(phases).toContain('searching');
    expect(call).toBe(2);
    const meta = r.meta as { webSteps?: { kind: string; detail: string }[] };
    expect(meta.webSteps?.[0]).toEqual({ kind: 'searching', detail: 'q' });
  });

  it('still works as a single shot when no expertWeb is given', async () => {
    const streamFn = (() => streamOf([{ type: 'token', text: 'plain' }])) as never;
    const tool = createAskExpertTool(base, 'm', { enabled: true }, true, streamFn);
    const r = await tool.execute({ question: 'q' });
    expect(r.output).toBe('plain');
  });

  it('forces an answer after the round cap', async () => {
    const streamFn = (() =>
      streamOf([
        { type: 'tool-call', toolCallId: 'c', name: 'web_search', argumentsJson: '{"query":"x"}' },
      ])) as never;
    const webTools = buildWebTools({
      search: {
        provider: {
          async search(q) {
            return { query: q, hits: [] };
          },
        },
        providerId: 'p',
        tierParams: {},
      },
      fetch: null,
      ctx: { nsfwAllowed: true, location: null, corsProxyUrl: 'p', corsProxyKey: null },
      getKey: async () => 'k',
    });
    const tool = createAskExpertTool(base, 'm', { enabled: true }, true, streamFn, {
      tools: webTools,
      maxRounds: 2,
    });
    const r = await tool.execute({ question: 'q' });
    expect(r.ok).toBe(false);
  });
});
