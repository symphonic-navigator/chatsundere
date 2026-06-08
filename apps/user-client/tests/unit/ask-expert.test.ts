// SPDX-License-Identifier: AGPL-3.0-only
import type { StreamChunk } from '@chatsundere/llm-unified';
import { describe, expect, it, vi } from 'vitest';
import { buildWebTools } from '../../src/integrations/web/build-web-tools.js';
import {
  EXPERT_SYSTEM_PROMPT,
  type ExpertBase,
  createAskExpertTool,
} from '../../src/tools/ask-expert.js';
import type { ToolProgress } from '../../src/tools/types.js';

const BASE = {} as ExpertBase; // the tool only forwards it to streamFn; tests inspect the call

function streamOf(chunks: StreamChunk[]): AsyncIterable<StreamChunk> {
  return (async function* () {
    for (const c of chunks) yield c;
  })();
}

async function* yields(chunks: StreamChunk[]): AsyncIterable<StreamChunk> {
  for (const c of chunks) yield c;
}

describe('ask_expert tool', () => {
  it('keeps the expert isolated: only system+question, then its own tool traffic', async () => {
    const webTools = buildWebTools({
      search: {
        provider: {
          async search(q) {
            return { query: q, hits: [{ title: 'T', url: 'https://x', snippet: 'S' }] };
          },
        },
        providerId: 'test',
        tierParams: {},
      },
      fetch: null,
      ctx: { nsfwAllowed: true, location: null, corsProxyUrl: 'p', corsProxyKey: null },
      getKey: async () => 'k',
    });

    // Capture messages passed on each stream call
    const capturedMessages: Array<Array<{ role: string }>> = [];
    let call = 0;
    const streamFn = vi.fn(() => {
      call += 1;
      if (call === 1) {
        // First round: the expert makes a web_search tool call
        return streamOf([
          {
            type: 'tool-call',
            toolCallId: 'c1',
            name: 'web_search',
            argumentsJson: '{"query":"Lie group"}',
          },
        ]);
      }
      // Second round: the expert answers
      return streamOf([{ type: 'token', text: 'A Lie group is…' }]);
    }) as never;

    const capturingStreamFn = vi.fn((opts: { messages: Array<{ role: string }> }) => {
      capturedMessages.push([...opts.messages]);
      return (streamFn as unknown as (o: typeof opts) => AsyncIterable<StreamChunk>)(opts);
    }) as never;

    const tool = createAskExpertTool(
      BASE,
      'Big Model',
      { enabled: true, effort: 'high' },
      true,
      capturingStreamFn,
      { tools: webTools, maxRounds: 8 },
    );
    await tool.execute({ question: 'What is a Lie group?' });

    // Two stream calls must have occurred (first: tool call, second: answer)
    expect(capturedMessages).toHaveLength(2);

    // First call: EXACTLY [system, user] — no history, no persona, no extras
    const firstMessages = capturedMessages[0];
    expect(firstMessages).toHaveLength(2);
    expect(firstMessages?.[0]).toEqual({ role: 'system', content: EXPERT_SYSTEM_PROMPT });
    expect(firstMessages?.[1]).toEqual({ role: 'user', content: 'What is a Lie group?' });

    // Second call: begins with [system, user], then ONLY the expert's own tool traffic
    const secondMessages = capturedMessages[1];
    expect(secondMessages?.[0]).toEqual({ role: 'system', content: EXPERT_SYSTEM_PROMPT });
    expect(secondMessages?.[1]).toEqual({ role: 'user', content: 'What is a Lie group?' });
    for (const msg of secondMessages?.slice(2) ?? []) {
      expect(['assistant', 'tool']).toContain(msg.role);
    }

    // Single-shot (no expertWeb): no tools passed, exactly two messages
    const plainStreamFn = vi.fn(() => yields([{ type: 'token', text: 'answer' }]));
    const plainTool = createAskExpertTool(
      BASE,
      'Big Model',
      { enabled: true, effort: 'high' },
      true,
      plainStreamFn as never,
    );
    await plainTool.execute({ question: 'What is a Lie group?' });
    const plainCall = (plainStreamFn.mock.calls[0] as unknown[])[0] as {
      messages: unknown[];
      bodyExtras: unknown;
      tools?: unknown;
    };
    expect(plainCall.messages).toEqual([
      { role: 'system', content: EXPERT_SYSTEM_PROMPT },
      { role: 'user', content: 'What is a Lie group?' },
    ]);
    expect(plainCall.bodyExtras).toEqual({ reasoning: { enabled: true, effort: 'high' } });
    expect(plainCall.tools).toBeUndefined();
  });

  it('runtime-off → constructive error, never calls streamFn', async () => {
    const streamFn = vi.fn(() => yields([]));
    const tool = createAskExpertTool(BASE, 'M', { enabled: true }, false, streamFn as never);
    const r = await tool.execute({ question: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/switched off/i);
    expect(streamFn).not.toHaveBeenCalled();
  });

  it('empty question → no call', async () => {
    const streamFn = vi.fn(() => yields([]));
    const tool = createAskExpertTool(BASE, 'M', { enabled: true }, true, streamFn as never);
    const r = await tool.execute({ question: '   ' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no question/i);
    expect(streamFn).not.toHaveBeenCalled();
  });

  it('non-string question arg → no call', async () => {
    const streamFn = vi.fn(() => yields([]));
    const tool = createAskExpertTool(BASE, 'M', { enabled: true }, true, streamFn as never);
    const r = await tool.execute({ question: 42 });
    expect(r.ok).toBe(false);
    expect(streamFn).not.toHaveBeenCalled();
  });

  it('streams reasoning then answer, reports phased progress, returns answer + meta', async () => {
    const streamFn = vi.fn(() =>
      yields([
        { type: 'reasoning', text: 'think' },
        { type: 'token', text: 'Hel' },
        { type: 'token', text: 'lo' },
      ]),
    );
    const tool = createAskExpertTool(BASE, 'Big Model', { enabled: true }, true, streamFn as never);
    const progress: ToolProgress[] = [];
    const r = await tool.execute({ question: 'q' }, undefined, (p) => progress.push(p));
    expect(r.ok).toBe(true);
    expect(r.output).toBe('Hello');
    expect(r.meta).toEqual({ question: 'q', model: 'Big Model', webSteps: [] });
    expect(progress).toEqual([
      { charCount: 5, phase: 'reasoning' },
      { charCount: 3, phase: 'answer' },
      { charCount: 5, phase: 'answer' },
    ]);
  });

  it('error chunk → ok:false', async () => {
    const streamFn = vi.fn(() => yields([{ type: 'error', message: 'boom' }]));
    const tool = createAskExpertTool(BASE, 'M', { enabled: true }, true, streamFn as never);
    const r = await tool.execute({ question: 'q' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('boom');
  });

  it('no answer text → "returned no answer"', async () => {
    const streamFn = vi.fn(() => yields([{ type: 'reasoning', text: 'only thinking' }]));
    const tool = createAskExpertTool(BASE, 'M', { enabled: true }, true, streamFn as never);
    const r = await tool.execute({ question: 'q' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no answer/i);
  });
});
