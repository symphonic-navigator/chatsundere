import { useAccountLinkStore } from '@chatsundere/ui-shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import {
  type MessageRow,
  type PillRow,
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../src/boot/client-data-db';
import { dismissConnectorPill } from '../../src/data/connector-pill';
import { QK } from '../../src/data/queryKeys';
import { queryClient } from '../../src/lib/queryClient';

const PAYLOAD = {
  name: 'add_mcp_connector',
  argumentsJson: '{"url":"https://mcp.kumbu.example/mcp"}',
  toolCallId: 'call-1',
  result: 'Proposed, not added.',
  connector: { url: 'https://mcp.kumbu.example/mcp' },
};

function pill(over: Partial<PillRow> = {}): PillRow {
  return {
    id: 'p1',
    messageId: 'm1',
    kind: 'tool-call',
    positionHint: 'inline',
    status: 'completed',
    payload: { ...PAYLOAD },
    createdAt: 7,
    ...over,
  };
}

function message(): MessageRow {
  return {
    id: 'm1',
    chatId: 'c1',
    role: 'persona',
    contentBlocks: [],
    createdAt: 1,
    updatedAt: 1,
    bookmarked: false,
    streamingState: 'complete',
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  useAccountLinkStore.getState().setLocalOnly();
  await _resetClientDataDbForTests();
});

describe('dismissConnectorPill', () => {
  it('writes only connectorDismissedAt and keeps everything else', async () => {
    const db = await openClientDataDb();
    await db.messages.add(message());
    await db.pills.add(pill());
    vi.spyOn(Date, 'now').mockReturnValue(424242);
    expect(await dismissConnectorPill('p1')).toBe(true);
    const stored = await db.pills.get('p1');
    expect(stored).toEqual({ ...pill(), payload: { ...PAYLOAD, connectorDismissedAt: 424242 } });
  });

  it('is a no-op for a deleted pill and does not resurrect it', async () => {
    const db = await openClientDataDb();
    expect(await dismissConnectorPill('gone')).toBe(false);
    expect(await db.pills.get('gone')).toBeUndefined();
  });

  it('enqueues a sync upsert only when linked', async () => {
    const db = await openClientDataDb();
    await db.pills.add(pill());
    useAccountLinkStore
      .getState()
      .setLinked({ base_url: 'https://s.example', issuer_label: 's.example', role: 'user' });
    await dismissConnectorPill('p1');
    expect(await db.syncOutbox.toArray()).toEqual([
      expect.objectContaining({ collection: 'pills', key: 'p1', op: 'upsert' }),
    ]);
  });

  it('enqueues nothing when unlinked', async () => {
    const db = await openClientDataDb();
    await db.pills.add(pill());
    await dismissConnectorPill('p1');
    expect(await db.syncOutbox.count()).toBe(0);
  });

  it('invalidates the chat the pill belongs to', async () => {
    const db = await openClientDataDb();
    await db.messages.add(message());
    await db.pills.add(pill());
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    await dismissConnectorPill('p1');
    expect(spy).toHaveBeenCalledWith({ queryKey: QK.chat('c1') });
  });
});
