// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { parseGrokExport } from '../../src/lib/third-party-import/grok.js';

function resp(
  id: string,
  parent: string | null,
  sender: string,
  message: string,
  createTime: number,
  extra: Record<string, unknown> = {},
): { response: Record<string, unknown> } {
  return {
    response: {
      _id: id,
      parent_response_id: parent,
      sender,
      message,
      create_time: createTime,
      ...extra,
    },
  };
}

const T0 = 1721300000000;

/** Branched: u1 → a1 (old) / a2 (regenerated, newer) → u2 → a3 (newest). */
const BRANCHED = {
  conversations: [
    {
      conversation: {
        id: 'g-1',
        title: 'Branched',
        create_time: { $date: '2026-07-18T10:00:00.000Z' },
        modify_time: { $date: '2026-07-18T11:00:00.000Z' },
      },
      responses: [
        resp('u1', null, 'human', 'hello', T0),
        resp('a1', 'u1', 'ASSISTANT', 'old answer', T0 + 1000),
        resp('a2', 'u1', 'grok-4', 'regenerated answer', T0 + 2000, {
          thinking_trace: 'let me think',
        }),
        resp('u2', 'a2', 'human', 'follow-up', T0 + 3000),
        resp('a3', 'u2', 'grok-4-auto', 'newest answer', T0 + 4000),
        resp('p1', 'a3', 'grok-4', 'half-written', T0 + 5000, { partial: true }),
      ],
    },
  ],
  projects: [],
  tasks: [],
  media_posts: [],
};

describe('parseGrokExport', () => {
  it('rejects payloads without a conversations array', () => {
    expect(() => parseGrokExport({ nope: true })).toThrow('not a Grok export');
    expect(() => parseGrokExport([])).toThrow('not a Grok export');
  });

  it('flattens to the newest branch, skipping partial responses', () => {
    const r = parseGrokExport(BRANCHED);
    expect(r.source).toBe('grok');
    expect(r.failures).toEqual([]);
    const conv = r.conversations[0];
    expect(conv?.sourceId).toBe('grok/g-1');
    expect(conv?.createdAt).toBe(Date.parse('2026-07-18T10:00:00.000Z'));
    expect(conv?.lastMessageAt).toBe(Date.parse('2026-07-18T11:00:00.000Z'));
    const texts = conv?.messages.map((m) => m.blocks.map((b) => `${b.type}:${b.text}`).join('|'));
    expect(texts).toEqual([
      'text:hello',
      'reasoning:let me think|text:regenerated answer',
      'text:follow-up',
      'text:newest answer',
    ]);
    expect(conv?.messages.map((m) => m.role)).toEqual(['user', 'persona', 'user', 'persona']);
  });

  it('joins agent_thinking_traces into one reasoning block', () => {
    const r = parseGrokExport({
      conversations: [
        {
          conversation: { id: 'g-2', title: 'Traces', create_time: T0, modify_time: T0 },
          responses: [
            resp('u1', null, 'human', 'question', T0),
            resp('a1', 'u1', 'assistant', 'answer', T0 + 1000, {
              agent_thinking_traces: [
                { agent_id: { rollout_id: 'r1' }, thinking_trace: 'step one' },
                { agent_id: { rollout_id: 'r2' }, thinking_trace: 'step two' },
              ],
            }),
          ],
        },
      ],
    });
    const reply = r.conversations[0]?.messages[1];
    expect(reply?.blocks[0]).toEqual({ type: 'reasoning', text: 'step one\n\nstep two' });
  });

  it('counts attachments and generated images as dropped', () => {
    const r = parseGrokExport({
      conversations: [
        {
          conversation: { id: 'g-3', title: 'Media', create_time: T0, modify_time: T0 },
          responses: [
            resp('u1', null, 'human', 'look', T0, { file_attachments: [{ id: 'f1' }] }),
            resp('a1', 'u1', 'assistant', 'made you an image', T0 + 1000, {
              generated_image_urls: ['https://x.example/img.png'],
            }),
          ],
        },
      ],
    });
    expect(r.conversations[0]?.messages[0]?.dropped.attachments).toBe(1);
    expect(r.conversations[0]?.messages[1]?.dropped.images).toBe(1);
  });

  it('reports a conversation without an id as a failure', () => {
    const r = parseGrokExport({
      conversations: [{ conversation: { title: 'No id' }, responses: [] }],
    });
    expect(r.failures).toEqual([{ title: 'No id', reason: 'Unreadable conversation structure' }]);
  });
});
