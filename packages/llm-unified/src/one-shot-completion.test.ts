// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { _runOneShotWith, runOneShotCompletion } from './one-shot-completion.js';
import type { StreamChunk } from './types.js';

const baseArgs = {
  provider: { id: 'ollama-cloud' } as never,
  providerConfig: { baseUrl: 'https://ollama.com', routing: { kind: 'direct' } } as never,
  apiKey: 'k',
  target: { slug: 'glm-5.2:cloud', adapterId: 'ollama-cloud:glm-5.2:cloud' },
  messages: [{ role: 'user' as const, content: 'hi' }],
  bodyExtras: { temperature: 0.3, max_tokens: 256, reasoning: { enabled: false } },
};

function streamOf(chunks: StreamChunk[]) {
  return async function* () {
    for (const c of chunks) yield c;
  };
}

describe('runOneShotCompletion', () => {
  it('folds token chunks into the returned content', async () => {
    const result = await _runOneShotWith(
      baseArgs as never,
      streamOf([
        { type: 'token', text: 'Sorting ' },
        { type: 'token', text: 'lists' },
        { type: 'finish', reason: 'stop' },
      ]) as never,
    );
    expect(result).toBe('Sorting lists');
  });

  it('reports content, reasoning and finishReason through onRawResponse', async () => {
    let raw: unknown = null;
    await _runOneShotWith(
      {
        ...baseArgs,
        onRawResponse: (r: unknown) => {
          raw = r;
        },
      } as never,
      streamOf([
        { type: 'reasoning', text: 'thinking…' },
        { type: 'token', text: 'answer' },
        { type: 'finish', reason: 'stop' },
      ]) as never,
    );
    expect(raw).toEqual({ content: 'answer', reasoning: 'thinking…', finishReason: 'stop' });
  });

  it('fires onRawResponse BEFORE throwing on empty content (reasoning-only case)', async () => {
    let raw: unknown = null;
    const p = _runOneShotWith(
      {
        ...baseArgs,
        onRawResponse: (r: unknown) => {
          raw = r;
        },
      } as never,
      streamOf([{ type: 'reasoning', text: 'only thinking' }]) as never,
    );
    await expect(p).rejects.toThrow('one-shot returned empty content');
    expect(raw).toEqual({ content: '', reasoning: 'only thinking', finishReason: null });
  });

  it('rejects with the upstream error chunk message, after onRawResponse has fired', async () => {
    let raw: unknown = null;
    const p = _runOneShotWith(
      {
        ...baseArgs,
        onRawResponse: (r: unknown) => {
          raw = r;
        },
      } as never,
      streamOf([
        { type: 'token', text: 'partial' },
        { type: 'error', message: 'upstream exploded mid-stream' },
      ]) as never,
    );
    await expect(p).rejects.toThrow('upstream exploded mid-stream');
    expect(raw).toEqual({ content: 'partial', reasoning: '', finishReason: null });
  });

  it('sends neither tools nor a cacheKey', async () => {
    let seen: Record<string, unknown> = {};
    await _runOneShotWith(
      baseArgs as never,
      ((a: Record<string, unknown>) => {
        seen = a;
        return streamOf([{ type: 'token', text: 'x' }])();
      }) as never,
    );
    expect(seen.tools).toBeUndefined();
    expect(seen.cacheKey).toBeUndefined();
    expect(seen.operation).toBe('one-shot');
    // Critical: the caller's overall budget (default 30 000 ms), NOT
    // streamCompletion's own 15 s default — inheriting that would impose a
    // new time-to-first-byte cap on dreaming (180 s) and compaction (180 s).
    expect(seen.initialResponseTimeoutMs).toBe(30_000);
    expect(seen.signal).toBeDefined();
  });

  it('is exported with an unchanged public signature', () => {
    expect(typeof runOneShotCompletion).toBe('function');
  });
});
