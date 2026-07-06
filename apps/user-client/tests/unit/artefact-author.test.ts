// SPDX-License-Identifier: AGPL-3.0-only
import type { StreamChunk } from '@chatsundere/llm-unified';
import { expect, test, vi } from 'vitest';
import { authorArtefact, stripFences } from '../../src/lib/artefact-author.js';

function fakeStream(chunks: StreamChunk[]) {
  return async function* () {
    for (const c of chunks) yield c;
  };
}

const base = {
  // minimal shapes — the fake stream ignores them
  provider: {} as never,
  providerConfig: {} as never,
  apiKey: 'k',
  target: { slug: 'm' } as never,
};

test('stripFences removes a leading ```html fence and trailing ```', () => {
  expect(stripFences('```html\n<h1>x</h1>\n```')).toBe('<h1>x</h1>');
  expect(stripFences('<h1>x</h1>')).toBe('<h1>x</h1>');
});

test('accumulates token text, fires onProgress with running char counts, strips fences', async () => {
  const onProgress = vi.fn();
  const streamFn = fakeStream([
    { type: 'token', text: '```html\n' },
    { type: 'token', text: '<h1>hi</h1>' },
    { type: 'token', text: '\n```' },
    { type: 'finish', reason: 'stop' },
  ]);
  const out = await authorArtefact({
    base,
    brief: 'a heading',
    reasoning: { enabled: false },
    onProgress,
    streamFn: streamFn as never,
  });
  expect(out).toBe('<h1>hi</h1>');
  expect(onProgress).toHaveBeenCalled();
  expect(onProgress.mock.calls.at(-1)?.[0]).toBeGreaterThan(0);
});

test('throws on an error chunk and on empty output', async () => {
  await expect(
    authorArtefact({
      base,
      brief: 'x',
      reasoning: { enabled: false },
      streamFn: fakeStream([{ type: 'error', message: 'boom' }]) as never,
    }),
  ).rejects.toThrow(/boom/);
  await expect(
    authorArtefact({
      base,
      brief: 'x',
      reasoning: { enabled: false },
      streamFn: fakeStream([{ type: 'finish', reason: 'stop' }]) as never,
    }),
  ).rejects.toThrow(/empty/i);
});
