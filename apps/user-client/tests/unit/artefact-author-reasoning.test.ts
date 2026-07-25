import type { StreamChunk } from '@chatsundere/llm-unified';
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { authorArtefact } from '../../src/lib/artefact-author.js';
import type { SubagentBase } from '../../src/lib/subagent-base.js';

const base = {} as SubagentBase;

async function* emit(text: string): AsyncIterable<StreamChunk> {
  yield { type: 'token', text } as StreamChunk;
}

describe('authorArtefact reasoning + budget', () => {
  it('passes the given reasoning intent and bumps max_tokens when enabled', async () => {
    let captured: Record<string, unknown> | undefined;
    const streamFn = ((args: { bodyExtras?: Record<string, unknown> }) => {
      captured = args.bodyExtras;
      return emit('<html></html>');
    }) as unknown as typeof import('@chatsundere/llm-unified').streamCompletion;

    await authorArtefact({
      base,
      brief: 'b',
      format: 'html',
      contentAxisPrompt: '',
      reasoning: { enabled: true, effort: 'medium' },
      streamFn,
    });
    expect(captured?.reasoning).toEqual({ enabled: true, effort: 'medium' });
    expect(captured?.max_tokens).toBe(16384);
  });

  it('keeps the 8192 budget when reasoning is disabled', async () => {
    let captured: Record<string, unknown> | undefined;
    const streamFn = ((args: { bodyExtras?: Record<string, unknown> }) => {
      captured = args.bodyExtras;
      return emit('<html></html>');
    }) as unknown as typeof import('@chatsundere/llm-unified').streamCompletion;

    await authorArtefact({
      base,
      brief: 'b',
      format: 'html',
      contentAxisPrompt: '',
      reasoning: { enabled: false },
      streamFn,
    });
    expect(captured?.reasoning).toEqual({ enabled: false });
    expect(captured?.max_tokens).toBe(8192);
  });
});
