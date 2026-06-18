// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { mapChatsuneMessage } from '../../../src/lib/chatsune-import/message-map.js';

const BASE = 1_700_000_000_000;

describe('mapChatsuneMessage', () => {
  it('maps a user text message', () => {
    const out = mapChatsuneMessage(
      { role: 'user', content: 'hello', created_at: '2026-01-01T00:00:00Z' },
      BASE,
    );
    expect(out).not.toBeNull();
    expect(out?.role).toBe('user');
    expect(out?.contentBlocks).toEqual([{ type: 'text', text: 'hello' }]);
    expect(out?.createdAt).toBe(Date.parse('2026-01-01T00:00:00Z'));
  });

  it('maps assistant role to persona and includes a reasoning block', () => {
    const out = mapChatsuneMessage(
      { role: 'assistant', content: 'answer', thinking: 'pondering' },
      BASE,
    );
    expect(out?.role).toBe('persona');
    expect(out?.contentBlocks).toEqual([
      { type: 'text', text: 'answer' },
      { type: 'reasoning', text: 'pondering' },
    ]);
  });

  it('appends a dropped-content hint as a final text block', () => {
    const out = mapChatsuneMessage(
      { role: 'assistant', content: 'see image', image_refs: [{}, {}], tool_calls: [{}] },
      BASE,
    );
    expect(out?.contentBlocks).toEqual([
      { type: 'text', text: 'see image' },
      {
        type: 'text',
        text: '[2 images and 1 tool call from the original message were not imported.]',
      },
    ]);
  });

  it('uses refusal_text when content is empty and the message was refused', () => {
    const out = mapChatsuneMessage(
      {
        role: 'assistant',
        content: '',
        status: 'refused',
        refusal_text: 'I cannot help with that.',
      },
      BASE,
    );
    expect(out?.contentBlocks).toEqual([{ type: 'text', text: 'I cannot help with that.' }]);
  });

  it('returns null for an assistant message with no text, no thinking, and no dropped content', () => {
    expect(mapChatsuneMessage({ role: 'assistant', content: '', thinking: '' }, BASE)).toBeNull();
  });

  it('skips tool-role messages', () => {
    expect(mapChatsuneMessage({ role: 'tool', content: 'result' }, BASE)).toBeNull();
  });

  it('falls back to the provided timestamp when created_at is missing or invalid', () => {
    expect(mapChatsuneMessage({ role: 'user', content: 'x' }, BASE)?.createdAt).toBe(BASE);
    expect(
      mapChatsuneMessage({ role: 'user', content: 'x', created_at: 'not-a-date' }, BASE)?.createdAt,
    ).toBe(BASE);
  });
});
