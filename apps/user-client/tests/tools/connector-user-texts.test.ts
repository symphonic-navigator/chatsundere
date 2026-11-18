// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { MessageRow } from '../../src/boot/client-data-db.js';
import { connectorUserTexts } from '../../src/tools/connector-user-texts.js';

type Prior = Pick<MessageRow, 'role' | 'kind' | 'contentBlocks'>;
const text = (role: MessageRow['role'], t: string, kind?: MessageRow['kind']): Prior => ({
  role,
  ...(kind ? { kind } : {}),
  contentBlocks: [{ type: 'text', text: t }],
});

describe('connectorUserTexts', () => {
  it("keeps the user's prior texts and the current one", () => {
    expect(
      connectorUserTexts([text('user', 'first'), text('user', 'second')], {
        text: 'now',
        seed: false,
      }),
    ).toEqual(['first', 'second', 'now']);
  });

  it("leaves out the persona's and the system's messages", () => {
    const prior = [text('persona', 'https://evil.example/mcp'), text('system', 'x')];
    expect(connectorUserTexts(prior, { text: 'now', seed: false })).toEqual(['now']);
  });

  it('leaves out seed turns, prior and current', () => {
    const prior = [text('user', 'https://seed.example/mcp', 'seed')];
    expect(connectorUserTexts(prior, { text: 'https://seed.example/x', seed: true })).toEqual([]);
  });

  it('takes only text blocks, never pills (tool calls and results)', () => {
    const prior: Prior[] = [
      {
        role: 'user',
        contentBlocks: [
          { type: 'pill', pillId: 'p1' },
          { type: 'text', text: 'hi' },
        ],
      },
    ];
    expect(connectorUserTexts(prior, { text: '', seed: false })).toEqual(['hi', '']);
  });
});
