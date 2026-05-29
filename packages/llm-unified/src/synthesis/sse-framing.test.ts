import { describe, expect, it } from 'bun:test';
import { frameSse } from './sse-framing.js';

describe('frameSse', () => {
  it('extracts JSON payloads, skipping comments, blanks and [DONE]', () => {
    const raw = [
      ': keep-alive comment',
      'data: {"choices":[{"delta":{"content":"hi"}}]}',
      '',
      'data: {"choices":[{"delta":{"content":" there"}}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');
    const out = frameSse(raw);
    expect(out).toEqual([
      { choices: [{ delta: { content: 'hi' } }] },
      { choices: [{ delta: { content: ' there' } }] },
    ]);
  });

  it('throws on a malformed JSON payload so capture flaws surface loudly', () => {
    expect(() => frameSse('data: {not json}\n\n')).toThrow();
  });
});
