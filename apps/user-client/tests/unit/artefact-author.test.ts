// SPDX-License-Identifier: AGPL-3.0-only
import type { StreamChunk, WireMessage } from '@chatsundere/llm-unified';
import { NSFW_PROMPT } from '@chatsundere/llm-unified';
import { expect, test, vi } from 'vitest';
import {
  AUTHOR_SYSTEM_PROMPT,
  authorArtefact,
  authorCraftRules,
  stripFences,
} from '../../src/lib/artefact-author.js';

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

/** Capture the system message the author sends to the stream. */
function captureSystemStream(tokenText: string) {
  let messages: WireMessage[] | undefined;
  const streamFn = async function* (args: { messages: WireMessage[] }) {
    messages = args.messages;
    yield { type: 'token', text: tokenText } as StreamChunk;
  };
  return {
    streamFn: streamFn as never,
    getSystem: () => {
      const sys = messages?.find((m) => m.role === 'system');
      return typeof sys?.content === 'string' ? sys.content : '';
    },
  };
}

test('stripFences removes a leading ```html fence and trailing ```', () => {
  expect(stripFences('```html\n<h1>x</h1>\n```')).toBe('<h1>x</h1>');
  expect(stripFences('<h1>x</h1>')).toBe('<h1>x</h1>');
});

test('authorCraftRules: html matches AUTHOR_SYSTEM_PROMPT; markdown is document-author', () => {
  expect(authorCraftRules('html')).toBe(AUTHOR_SYSTEM_PROMPT);
  const md = authorCraftRules('markdown');
  expect(md).toMatch(/document author/i);
  expect(md).toMatch(/EXACTLY ONE Markdown document/i);
  expect(md).toMatch(/```markdown|```md/);
  expect(md).not.toMatch(/self-contained HTML/);
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
    format: 'html',
    contentAxisPrompt: '',
    reasoning: { enabled: false },
    onProgress,
    streamFn: streamFn as never,
  });
  expect(out).toBe('<h1>hi</h1>');
  expect(onProgress).toHaveBeenCalled();
  expect(onProgress.mock.calls.at(-1)?.[0]).toBeGreaterThan(0);
});

test('system prompt is craft rules only when content axis is empty', async () => {
  const cap = captureSystemStream('<h1>x</h1>');
  await authorArtefact({
    base,
    brief: 'x',
    format: 'html',
    contentAxisPrompt: '',
    reasoning: { enabled: false },
    streamFn: cap.streamFn,
  });
  expect(cap.getSystem()).toBe(AUTHOR_SYSTEM_PROMPT);
});

test('system prompt appends content axis (e.g. NSFW) after craft rules', async () => {
  const cap = captureSystemStream('<h1>x</h1>');
  await authorArtefact({
    base,
    brief: 'x',
    format: 'html',
    contentAxisPrompt: NSFW_PROMPT,
    reasoning: { enabled: false },
    streamFn: cap.streamFn,
  });
  const sys = cap.getSystem();
  expect(sys.startsWith(AUTHOR_SYSTEM_PROMPT)).toBe(true);
  expect(sys).toContain(NSFW_PROMPT);
  expect(sys).toBe(`${AUTHOR_SYSTEM_PROMPT}\n\n${NSFW_PROMPT}`);
});

test('markdown format uses markdown craft rules in the system message', async () => {
  const cap = captureSystemStream('# Hello\n\nBody.');
  await authorArtefact({
    base,
    brief: 'a note',
    format: 'markdown',
    contentAxisPrompt: '',
    reasoning: { enabled: false },
    streamFn: cap.streamFn,
  });
  expect(cap.getSystem()).toBe(authorCraftRules('markdown'));
});

test('throws on an error chunk and on empty output', async () => {
  await expect(
    authorArtefact({
      base,
      brief: 'x',
      format: 'html',
      contentAxisPrompt: '',
      reasoning: { enabled: false },
      streamFn: fakeStream([{ type: 'error', message: 'boom' }]) as never,
    }),
  ).rejects.toThrow(/boom/);
  await expect(
    authorArtefact({
      base,
      brief: 'x',
      format: 'html',
      contentAxisPrompt: '',
      reasoning: { enabled: false },
      streamFn: fakeStream([{ type: 'finish', reason: 'stop' }]) as never,
    }),
  ).rejects.toThrow(/empty/i);
});
