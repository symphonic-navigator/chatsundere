// SPDX-License-Identifier: AGPL-3.0-only
import type { StreamChunk } from '@chatsundere/llm-unified';
import { describe, expect, it, vi } from 'vitest';
import {
  EXPERT_SYSTEM_PROMPT,
  type ExpertBase,
  createAskExpertTool,
} from '../../src/tools/ask-expert.js';
import type { ToolProgress } from '../../src/tools/types.js';

const BASE = {} as ExpertBase; // the tool only forwards it to streamFn; tests inspect the call

async function* yields(chunks: StreamChunk[]): AsyncIterable<StreamChunk> {
  for (const c of chunks) yield c;
}

describe('ask_expert tool', () => {
  it('forwards ONLY [system(EXPERT_PROMPT), user(question)] — structural isolation', async () => {
    const streamFn = vi.fn(() => yields([{ type: 'token', text: 'answer' }]));
    const tool = createAskExpertTool(
      BASE,
      'Big Model',
      { enabled: true, effort: 'high' },
      true,
      streamFn as never,
    );
    await tool.execute({ question: 'What is a Lie group?' });
    const call = (streamFn.mock.calls[0] as unknown[])[0] as {
      messages: unknown[];
      bodyExtras: unknown;
      tools?: unknown;
    };
    expect(call.messages).toEqual([
      { role: 'system', content: EXPERT_SYSTEM_PROMPT },
      { role: 'user', content: 'What is a Lie group?' },
    ]);
    expect(call.bodyExtras).toEqual({ reasoning: { enabled: true, effort: 'high' } });
    expect(call.tools).toBeUndefined();
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
    expect(r.meta).toEqual({ question: 'q', model: 'Big Model' });
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
