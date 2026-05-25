// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { parseOpenAiSseStream } from './streaming.js';
import type { StreamChunk } from './types.js';

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

async function collect(iter: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of iter) out.push(c);
  return out;
}

describe('parseOpenAiSseStream', () => {
  it('parses three token deltas followed by [DONE]', async () => {
    const stream = streamOf(
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"!"}}]}\n\n',
      'data: [DONE]\n\n',
    );
    const chunks = await collect(parseOpenAiSseStream(stream));
    expect(chunks).toEqual([
      { type: 'token', text: 'Hel' },
      { type: 'token', text: 'lo' },
      { type: 'token', text: '!' },
    ]);
  });

  it('emits a finish chunk when a delta carries a finish_reason', async () => {
    const stream = streamOf(
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    );
    const chunks = await collect(parseOpenAiSseStream(stream));
    expect(chunks).toEqual([
      { type: 'token', text: 'hi' },
      { type: 'finish', reason: 'stop' },
    ]);
  });

  it('handles chunks split across multiple network reads', async () => {
    const stream = streamOf(
      'data: {"choices":[{"delta":{"con',
      'tent":"split"}}]}\n\n',
      'data: [DONE]\n\n',
    );
    const chunks = await collect(parseOpenAiSseStream(stream));
    expect(chunks).toEqual([{ type: 'token', text: 'split' }]);
  });

  it('ignores comment lines and blank lines', async () => {
    const stream = streamOf(
      ': keep-alive comment\n',
      '\n',
      'data: {"choices":[{"delta":{"content":"x"}}]}\n\n',
      'data: [DONE]\n\n',
    );
    const chunks = await collect(parseOpenAiSseStream(stream));
    expect(chunks).toEqual([{ type: 'token', text: 'x' }]);
  });

  it('emits an error chunk on malformed JSON', async () => {
    const stream = streamOf('data: not-json\n\n', 'data: [DONE]\n\n');
    const chunks = await collect(parseOpenAiSseStream(stream));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.type).toBe('error');
  });

  it('aborts cleanly when the signal is fired mid-stream', async () => {
    const ac = new AbortController();
    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"a"}}]}\n\n'));
        // Never enqueue [DONE]; signal aborts the consumer instead.
      },
    });
    const iter = parseOpenAiSseStream(stream, { signal: ac.signal });
    const out: StreamChunk[] = [];
    const reader = (async () => {
      for await (const c of iter) {
        out.push(c);
        if (out.length === 1) ac.abort();
      }
    })();
    await reader;
    expect(out).toEqual([{ type: 'token', text: 'a' }]);
  });

  it('emits tool-call chunks when delta.tool_calls is present', async () => {
    const stream = streamOf(
      'data: {"choices":[{"delta":{"tool_calls":[{"id":"call_1","type":"function","function":{"name":"web_search","arguments":"{\\"q\\":\\"hi\\"}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    );
    const chunks = await collect(parseOpenAiSseStream(stream));
    expect(chunks).toEqual([
      { type: 'tool-call', toolCallId: 'call_1', name: 'web_search', argumentsJson: '{"q":"hi"}' },
    ]);
  });
});

describe('parseOpenAiSseStream — reasoning', () => {
  it('emits a reasoning chunk from delta.reasoning (modern field)', async () => {
    const stream = streamOf(
      'data: {"choices":[{"delta":{"reasoning":"Let me think..."}}]}\n\n',
      'data: [DONE]\n\n',
    );
    const chunks = await collect(parseOpenAiSseStream(stream));
    expect(chunks).toEqual([{ type: 'reasoning', text: 'Let me think...' }]);
  });

  it('emits a reasoning chunk from delta.reasoning_content (legacy field)', async () => {
    const stream = streamOf(
      'data: {"choices":[{"delta":{"reasoning_content":"Pondering deeply"}}]}\n\n',
      'data: [DONE]\n\n',
    );
    const chunks = await collect(parseOpenAiSseStream(stream));
    expect(chunks).toEqual([{ type: 'reasoning', text: 'Pondering deeply' }]);
  });

  it('concatenates modern and legacy reasoning fields into a single chunk', async () => {
    const stream = streamOf(
      'data: {"choices":[{"delta":{"reasoning":"modern-","reasoning_content":"legacy"}}]}\n\n',
      'data: [DONE]\n\n',
    );
    const chunks = await collect(parseOpenAiSseStream(stream));
    expect(chunks).toEqual([{ type: 'reasoning', text: 'modern-legacy' }]);
  });

  it('emits reasoning before token when both are present in the same event', async () => {
    const stream = streamOf(
      'data: {"choices":[{"delta":{"reasoning":"think","content":"speak"}}]}\n\n',
      'data: [DONE]\n\n',
    );
    const chunks = await collect(parseOpenAiSseStream(stream));
    expect(chunks).toEqual([
      { type: 'reasoning', text: 'think' },
      { type: 'token', text: 'speak' },
    ]);
  });

  it('emits no reasoning chunk when reasoning fields are empty or null', async () => {
    const stream = streamOf(
      'data: {"choices":[{"delta":{"reasoning":"","reasoning_content":null,"content":"hi"}}]}\n\n',
      'data: [DONE]\n\n',
    );
    const chunks = await collect(parseOpenAiSseStream(stream));
    expect(chunks).toEqual([{ type: 'token', text: 'hi' }]);
  });
});
