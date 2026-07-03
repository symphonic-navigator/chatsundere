// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { MessageRow } from '../../src/boot/client-data-db.js';
import {
  captureTemplate,
  endsOnPersona,
  isApplyable,
  isValidBody,
  normaliseBody,
  roleAt,
} from '../../src/lib/seed-template.js';

let seq = 0;
function mkMsg(
  id: string,
  role: MessageRow['role'],
  text: string,
  extra: Partial<MessageRow> = {},
): MessageRow {
  return {
    id,
    chatId: 'c1',
    role,
    contentBlocks: [{ type: 'text', text }],
    createdAt: ++seq,
    updatedAt: ++seq,
    bookmarked: false,
    streamingState: 'complete',
    ...extra,
  };
}

describe('seed-template body invariants', () => {
  it('derives role by position', () => {
    expect(roleAt(0)).toBe('user');
    expect(roleAt(1)).toBe('persona');
    expect(roleAt(2)).toBe('user');
  });

  it('re-roles after a middle deletion', () => {
    const out = normaliseBody([{ text: 'a' }, { text: 'c' }]); // b was deleted
    expect(out.map((t) => t.role)).toEqual(['user', 'persona']);
  });

  it('isValidBody rejects empty-text turns', () => {
    expect(
      isValidBody([
        { role: 'user', text: 'hi' },
        { role: 'persona', text: '   ' },
      ]),
    ).toBe(false);
  });

  it('isValidBody rejects a wrong-role alternation', () => {
    expect(
      isValidBody([
        { role: 'persona', text: 'hi' },
        { role: 'user', text: 'yo' },
      ]),
    ).toBe(false);
  });

  it('isValidBody accepts a clean user-first alternation', () => {
    expect(
      isValidBody([
        { role: 'user', text: 'hi' },
        { role: 'persona', text: 'yo' },
      ]),
    ).toBe(true);
  });

  it('endsOnPersona reflects the last turn', () => {
    expect(endsOnPersona([{ role: 'user', text: 'a' }])).toBe(false);
    expect(
      endsOnPersona([
        { role: 'user', text: 'a' },
        { role: 'persona', text: 'b' },
      ]),
    ).toBe(true);
    expect(endsOnPersona([])).toBe(false);
  });

  it('isApplyable: greeting-only is applyable, fully empty is not', () => {
    expect(isApplyable({ greeting: 'hi', body: [] })).toBe(true);
    expect(isApplyable({ greeting: null, body: [] })).toBe(false);
    expect(isApplyable({ greeting: '   ', body: [] })).toBe(false);
  });

  it('isApplyable: a valid body with no greeting is applyable', () => {
    expect(isApplyable({ greeting: null, body: [{ role: 'user', text: 'hi' }] })).toBe(true);
  });

  it('isApplyable: an invalid body with no greeting is not', () => {
    expect(isApplyable({ greeting: null, body: [{ role: 'user', text: '  ' }] })).toBe(false);
  });
});

describe('captureTemplate', () => {
  it('maps an opener to greeting and the rest to an alternating body', () => {
    const msgs = [
      mkMsg('m1', 'persona', 'Hello darling', { kind: 'opener' }),
      mkMsg('m2', 'user', 'hi'),
      mkMsg('m3', 'persona', 'how are you'),
    ];
    const r = captureTemplate({ messages: msgs, uptoMessageId: 'm3', sourceNsfw: false });
    expect(r.greeting).toBe('Hello darling');
    expect(r.body).toEqual([
      { role: 'user', text: 'hi' },
      { role: 'persona', text: 'how are you' },
    ]);
    expect(r.nsfw).toBe(false);
  });

  it('slices the prefix inclusive of uptoMessageId', () => {
    const msgs = [
      mkMsg('m1', 'user', 'one'),
      mkMsg('m2', 'persona', 'two'),
      mkMsg('m3', 'user', 'three — excluded'),
    ];
    const r = captureTemplate({ messages: msgs, uptoMessageId: 'm2', sourceNsfw: false });
    expect(r.greeting).toBeNull();
    expect(r.body.map((t) => t.text)).toEqual(['one', 'two']);
  });

  it('carries NSFW monotonically (sourceNsfw true wins)', () => {
    const msgs = [mkMsg('m1', 'user', 'hi')];
    expect(captureTemplate({ messages: msgs, uptoMessageId: 'm1', sourceNsfw: true }).nsfw).toBe(
      true,
    );
  });

  it('drops system rows and re-roles the survivors by position', () => {
    const msgs = [
      mkMsg('s1', 'system', 'system note'),
      mkMsg('m1', 'user', 'hi'),
      mkMsg('m2', 'persona', 'hey'),
    ];
    const r = captureTemplate({ messages: msgs, uptoMessageId: 'm2', sourceNsfw: false });
    expect(r.body).toEqual([
      { role: 'user', text: 'hi' },
      { role: 'persona', text: 'hey' },
    ]);
  });

  it('treats a leading seed greeting like an opener', () => {
    const msgs = [
      mkMsg('g', 'persona', 'Oh, you again', { kind: 'seed', seedRole: 'greeting' }),
      mkMsg('u', 'user', 'me again', { kind: 'seed', seedRole: 'body' }),
      mkMsg('p', 'persona', 'good', { kind: 'seed', seedRole: 'body' }),
    ];
    const r = captureTemplate({ messages: msgs, uptoMessageId: 'p', sourceNsfw: false });
    expect(r.greeting).toBe('Oh, you again');
    expect(r.body.map((t) => t.text)).toEqual(['me again', 'good']);
  });
});
