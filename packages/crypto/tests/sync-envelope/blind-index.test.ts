// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { computeBlindId } from '../../src/sync-envelope/blind-index.js';
import { asMasterKey } from '../../src/types.js';

const mkA = asMasterKey(new Uint8Array(32).fill(7));
const mkB = asMasterKey(new Uint8Array(32).fill(9));

describe('computeBlindId', () => {
  it('is 16 bytes and deterministic for the same mk/collection/key', async () => {
    const a = await computeBlindId(mkA, 'chats', 'uuid-1');
    const b = await computeBlindId(mkA, 'chats', 'uuid-1');
    expect(a).toHaveLength(16);
    expect([...a]).toEqual([...b]);
  });
  it('diverges across MKs, collections, and keys', async () => {
    const base = await computeBlindId(mkA, 'chats', 'uuid-1');
    for (const other of [
      await computeBlindId(mkB, 'chats', 'uuid-1'),
      await computeBlindId(mkA, 'messages', 'uuid-1'),
      await computeBlindId(mkA, 'chats', 'uuid-2'),
    ])
      expect([...other]).not.toEqual([...base]);
  });
  it('separator prevents boundary shifts', async () => {
    const a = await computeBlindId(mkA, 'chat', 's123');
    const b = await computeBlindId(mkA, 'chats', '123');
    expect([...a]).not.toEqual([...b]);
  });
});
