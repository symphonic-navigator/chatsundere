// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand';

/**
 * A pending MCP question awaiting the user's decision: a tool call to approve, or,
 * for a server under autoRun, whether this device may contact it at all.
 */
export interface McpApprovalRequest {
  id: string;
  kind: 'call' | 'first-use';
  serverId: string;
  serverName: string;
  /** The server's host, shown so the user sees where the call goes (spec §8, M1). */
  host: string;
  /** Empty for a first-use question, which is not about one tool. */
  toolName: string;
  args: Record<string, unknown>;
  /** True when this device has not contacted the server yet. */
  firstUse: boolean;
}

interface McpApprovalState {
  pending: McpApprovalRequest[];
  /** Enqueue a tool-call request; resolves true (approved) or false (denied). */
  request(req: Omit<McpApprovalRequest, 'id' | 'kind'>): Promise<boolean>;
  /** Enqueue a first-use question; resolves true (use here) or false (not now). */
  requestFirstUse(req: { serverId: string; serverName: string; host: string }): Promise<boolean>;
  approve(id: string, opts?: { always?: boolean }): void;
  deny(id: string): void;
  /** Reject all pending requests (resolve false) and clear the queue — for UI unmount. */
  clearAll(): void;
}

const resolvers = new Map<string, (ok: boolean) => void>();
let seq = 0;

/** Queue of MCP tool-call approvals awaiting the user's decision. */
export const useMcpApprovalStore = create<McpApprovalState>((set) => {
  const enqueue = (req: Omit<McpApprovalRequest, 'id'>): Promise<boolean> => {
    const id = `mcp-approval-${++seq}`;
    return new Promise<boolean>((resolve) => {
      resolvers.set(id, resolve);
      set((s) => ({ pending: [...s.pending, { ...req, id }] }));
    });
  };
  return {
    pending: [],
    request(req) {
      return enqueue({ ...req, kind: 'call' });
    },
    requestFirstUse(req) {
      return enqueue({ ...req, kind: 'first-use', toolName: '', args: {}, firstUse: true });
    },
    // `always` is acted on by the prompt (it flips autoRun on the row); the answer is the same.
    approve(id, _opts) {
      resolvers.get(id)?.(true);
      resolvers.delete(id);
      set((s) => ({ pending: s.pending.filter((r) => r.id !== id) }));
    },
    deny(id) {
      resolvers.get(id)?.(false);
      resolvers.delete(id);
      set((s) => ({ pending: s.pending.filter((r) => r.id !== id) }));
    },
    clearAll() {
      for (const resolve of resolvers.values()) resolve(false);
      resolvers.clear();
      set({ pending: [] });
    },
  };
});
