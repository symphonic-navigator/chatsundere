// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { SeedTemplateRow } from '../../src/boot/client-data-db.js';
import { materialiseSeed } from '../../src/lib/seed-materialise.js';

const template = (over: Partial<SeedTemplateRow> = {}): SeedTemplateRow => ({
  id: 't1',
  name: 'Primer',
  description: '',
  nsfw: false,
  greeting: 'Oh, you again — good.',
  body: [
    { role: 'user', text: 'hey' },
    { role: 'persona', text: 'hey yourself' },
  ],
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe('materialiseSeed', () => {
  it('yields greeting + body rows, all kind:seed, same chat, ascending createdAt', () => {
    const rows = materialiseSeed(template(), 'chat-1');
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.kind === 'seed')).toBe(true);
    expect(rows.every((r) => r.chatId === 'chat-1')).toBe(true);
    expect(rows[0]).toMatchObject({ role: 'persona', seedRole: 'greeting' });
    expect(rows[1]).toMatchObject({ role: 'user', seedRole: 'body' });
    expect(rows[2]).toMatchObject({ role: 'persona', seedRole: 'body' });
    const times = rows.map((r) => r.createdAt);
    expect(times[0] ?? 0).toBeLessThan(times[1] ?? 0);
    expect(times[1] ?? 0).toBeLessThan(times[2] ?? 0);
    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
  });

  it('omits the greeting row when there is no greeting', () => {
    const rows = materialiseSeed(template({ greeting: null }), 'chat-1');
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.seedRole === 'body')).toBe(true);
  });
});
