// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand';

/** A pending MCP tool-call awaiting the user's approval. */
export interface McpApprovalRequest {
  id: string;
  serverId: string;
  serverName: string;
  toolName: string;
  args: Record<string, unknown>;
}

interface McpApprovalState {
  pending: McpApprovalRequest[];
  /** Enqueue a request; resolves true (approved) or false (denied). */
  request(req: Omit<McpApprovalRequest, 'id'>): Promise<boolean>;
  approve(id: string): void;
  deny(id: string): void;
  /** Reject all pending requests (resolve false) and clear the queue — for UI unmount. */
  clearAll(): void;
}

const resolvers = new Map<string, (ok: boolean) => void>();
let seq = 0;

/** Queue of MCP tool-call approvals awaiting the user's decision. */
export const useMcpApprovalStore = create<McpApprovalState>((set) => ({
  pending: [],
  request(req) {
    const id = `mcp-approval-${++seq}`;
    return new Promise<boolean>((resolve) => {
      resolvers.set(id, resolve);
      set((s) => ({ pending: [...s.pending, { ...req, id }] }));
    });
  },
  approve(id) {
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
}));
