// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect } from 'react';
import { useMcpServers, useUpsertMcpServer } from '../../data/mcp-servers.js';
import { useMcpApprovalStore } from '../../state/mcp-approval.store.js';

/**
 * Renders the first pending MCP tool-call approval as an explicit modal:
 * Approve / Deny, plus "always allow this server" (flips the server to autoRun).
 * Self-hides when nothing is pending. Rejects all pending on unmount.
 */
export function McpApprovalPrompt(): JSX.Element | null {
  const pending = useMcpApprovalStore((s) => s.pending);
  const approve = useMcpApprovalStore((s) => s.approve);
  const deny = useMcpApprovalStore((s) => s.deny);
  const clearAll = useMcpApprovalStore((s) => s.clearAll);
  const servers = useMcpServers();
  const upsert = useUpsertMcpServer();

  // If the chat page unmounts mid-approval, reject everything so no execute() hangs.
  useEffect(() => () => clearAll(), [clearAll]);

  const req = pending[0];
  if (!req) return null;

  const trustAndApprove = () => {
    const row = (servers.data ?? []).find((s) => s.id === req.serverId);
    if (row) upsert.mutate({ ...row, autoRun: true, updatedAt: Date.now() });
    approve(req.id);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
      <dialog
        open
        aria-modal="true"
        className="w-full max-w-sm rounded-lg border border-white/10 bg-ink p-4"
      >
        <div className="mb-1 font-display text-sm text-paper">
          {req.serverName} wants to run <span className="font-mono">{req.toolName}</span>
        </div>
        <pre className="mb-3 max-h-40 overflow-auto rounded bg-white/5 p-2 text-[11px] text-paper-soft">
          {JSON.stringify(req.args, null, 2)}
        </pre>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => approve(req.id)}
            className="rounded bg-white/10 px-3 py-1.5 text-sm text-paper"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => deny(req.id)}
            className="rounded px-3 py-1.5 text-sm text-paper-soft"
          >
            Deny
          </button>
          <button
            type="button"
            onClick={trustAndApprove}
            className="ml-auto rounded px-3 py-1.5 text-xs text-paper-soft"
          >
            Always allow {req.serverName}
          </button>
        </div>
      </dialog>
    </div>
  );
}
