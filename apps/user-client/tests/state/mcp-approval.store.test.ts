// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import { useMcpApprovalStore } from '../../src/state/mcp-approval.store.js';

beforeEach(() => useMcpApprovalStore.setState({ pending: [] }));

describe('mcp-approval store', () => {
  it('enqueues a request and resolves true on approve', async () => {
    const p = useMcpApprovalStore
      .getState()
      .request({ serverId: 's', serverName: 'S', toolName: 'do', args: { a: 1 } });
    const req = useMcpApprovalStore.getState().pending[0];
    expect(req?.toolName).toBe('do');
    if (req) useMcpApprovalStore.getState().approve(req.id);
    await expect(p).resolves.toBe(true);
    expect(useMcpApprovalStore.getState().pending).toHaveLength(0);
  });

  it('resolves false on deny', async () => {
    const p = useMcpApprovalStore
      .getState()
      .request({ serverId: 's', serverName: 'S', toolName: 'do', args: {} });
    const req = useMcpApprovalStore.getState().pending[0];
    if (req) useMcpApprovalStore.getState().deny(req.id);
    await expect(p).resolves.toBe(false);
  });

  it('clearAll resolves every pending request false and empties the queue', async () => {
    const p1 = useMcpApprovalStore
      .getState()
      .request({ serverId: 's', serverName: 'S', toolName: 'a', args: {} });
    const p2 = useMcpApprovalStore
      .getState()
      .request({ serverId: 's', serverName: 'S', toolName: 'b', args: {} });
    useMcpApprovalStore.getState().clearAll();
    await expect(p1).resolves.toBe(false);
    await expect(p2).resolves.toBe(false);
    expect(useMcpApprovalStore.getState().pending).toHaveLength(0);
  });
});
