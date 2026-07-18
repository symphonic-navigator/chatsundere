// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { parseChatGptExport } from '../../src/lib/third-party-import/chatgpt.js';

/** Minimal node builder for the mapping graph. */
function node(
  id: string,
  parent: string | null,
  message: Record<string, unknown> | null,
): [string, Record<string, unknown>] {
  return [id, { id, parent, message }];
}

function msg(
  role: string,
  parts: unknown[],
  opts: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    author: { role },
    status: 'finished_successfully',
    create_time: 1721300000,
    content: { content_type: 'text', parts },
    ...opts,
  };
}

/** A branched conversation: root → u1 → a1 (dead) / a2 (regenerated, current). */
const BRANCHED = {
  conversation_id: 'conv-1',
  title: 'Branched',
  create_time: 1721300000,
  update_time: 1721303600,
  current_node: 'a2',
  mapping: Object.fromEntries([
    node('root', null, null),
    node('u1', 'root', msg('user', ['hello'])),
    node('a1', 'u1', msg('assistant', ['dead branch answer'])),
    node('a2', 'u1', msg('assistant', ['regenerated answer'])),
  ]),
};

describe('parseChatGptExport', () => {
  it('rejects non-arrays', () => {
    expect(() => parseChatGptExport({})).toThrow('not a ChatGPT export');
  });

  it('flattens to the current_node branch only', () => {
    const r = parseChatGptExport([BRANCHED]);
    expect(r.source).toBe('chatgpt');
    expect(r.failures).toEqual([]);
    expect(r.conversations).toHaveLength(1);
    const conv = r.conversations[0];
    expect(conv?.sourceId).toBe('chatgpt/conv-1');
    expect(conv?.title).toBe('Branched');
    expect(conv?.createdAt).toBe(1721300000000);
    expect(conv?.lastMessageAt).toBe(1721303600000);
    const texts = conv?.messages.map((m) => m.blocks.map((b) => b.text).join('|'));
    expect(texts).toEqual(['hello', 'regenerated answer']);
    expect(conv?.messages.map((m) => m.role)).toEqual(['user', 'persona']);
  });

  it('drops system/tool/hidden and counts non-text as dropped on the next kept message', () => {
    const r = parseChatGptExport([
      {
        conversation_id: 'conv-2',
        title: 'Filtered',
        create_time: 1721300000,
        update_time: 1721300100,
        current_node: 'a1',
        mapping: Object.fromEntries([
          node('root', null, null),
          node('sys', 'root', msg('system', ['system prompt'])),
          node(
            'hidden',
            'sys',
            msg('user', ['hidden'], { metadata: { is_visually_hidden_from_conversation: true } }),
          ),
          node('img', 'hidden', {
            author: { role: 'user' },
            status: 'finished_successfully',
            content: {
              content_type: 'multimodal_text',
              parts: [{ content_type: 'image_asset_pointer' }, 'look at this'],
            },
          }),
          node('u1', 'img', msg('user', ['real question'])),
          node('a1', 'u1', msg('assistant', ['answer'])),
        ]),
      },
    ]);
    const conv = r.conversations[0];
    expect(conv?.messages).toHaveLength(2);
    expect(conv?.messages[0]?.blocks[0]?.text).toBe('real question');
    // system + hidden + the multimodal message were dropped; the image counts.
    expect(conv?.messages[0]?.dropped.images).toBe(1);
    expect(conv?.messages[1]?.dropped.images).toBe(0);
  });

  it('turns user_editable_context into a synthetic first user message', () => {
    const r = parseChatGptExport([
      {
        conversation_id: 'conv-3',
        title: 'Context',
        create_time: 1721300000,
        update_time: 1721300100,
        current_node: 'a1',
        mapping: Object.fromEntries([
          node('root', null, null),
          node('ctx', 'root', {
            author: { role: 'user' },
            status: null,
            metadata: { is_visually_hidden_from_conversation: true },
            content: {
              content_type: 'user_editable_context',
              user_profile: 'I am Chris.',
              user_instructions: 'Be concise.',
            },
          }),
          node('u1', 'ctx', msg('user', ['hi'])),
          node('a1', 'u1', msg('assistant', ['hello'])),
        ]),
      },
    ]);
    const conv = r.conversations[0];
    expect(conv?.messages).toHaveLength(3);
    const first = conv?.messages[0];
    expect(first?.role).toBe('user');
    expect(first?.blocks[0]?.text).toContain('[User Profile]');
    expect(first?.blocks[0]?.text).toContain('I am Chris.');
    expect(first?.blocks[0]?.text).toContain('[Custom Instructions]');
    expect(first?.blocks[0]?.text).toContain('Be concise.');
    expect(first?.createdAt).toBe(1721300000000 - 1000);
  });

  it('survives a mapping cycle without hanging', () => {
    const r = parseChatGptExport([
      {
        conversation_id: 'conv-4',
        title: 'Cycle',
        create_time: 1721300000,
        update_time: 1721300100,
        current_node: 'b',
        mapping: Object.fromEntries([
          node('a', 'b', msg('user', ['a'])),
          node('b', 'a', msg('assistant', ['b'])),
        ]),
      },
    ]);
    expect(r.conversations).toHaveLength(1);
    expect(r.conversations[0]?.messages.length).toBe(2);
  });

  it('reports an unreadable conversation as a failure, not a crash', () => {
    const r = parseChatGptExport([{ title: 'Broken', mapping: 'nonsense' }, BRANCHED]);
    expect(r.failures).toEqual([{ title: 'Broken', reason: 'Unreadable conversation structure' }]);
    expect(r.conversations).toHaveLength(1);
  });
});
