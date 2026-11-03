// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect } from 'react';
import { useMcpServers, useUpsertMcpServer } from '../../data/mcp-servers.js';
import { useMcpApprovalStore } from '../../state/mcp-approval.store.js';
import { Button } from '../ui/index.js';

/**
 * Renders the first pending MCP question as an explicit modal. A tool call shows the
 * server's host and arguments with Approve / Deny, plus "always allow this server"
 * (flips the server to autoRun); a first use under autoRun asks "Use this server here?".
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
    if (row) {
      // The upsert writes the whole cached row; carry the consent this approval gives,
      // or it could land after the tool call records it and undo it.
      const consent = req.firstUse ? { firstUseConsentFor: row.url } : {};
      upsert.mutate({ ...row, ...consent, autoRun: true, updatedAt: Date.now() });
    }
    approve(req.id, { always: true });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
      <dialog
        open
        aria-modal="true"
        className="w-full max-w-sm rounded-lg border border-white/10 bg-ink p-4"
      >
        {req.kind === 'first-use' ? (
          <>
            <div className="mb-1 font-display text-sm text-paper">Use this server here?</div>
            <p className="mb-3 text-xs text-paper-soft">
              {req.serverName} wants to run a tool. This device hasn't contacted{' '}
              <span className="font-mono">{req.host}</span> yet. Only continue if you trust it.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button tone="primary" onClick={() => approve(req.id)}>
                Use here
              </Button>
              <Button onClick={() => deny(req.id)}>Not now</Button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-1 font-display text-sm text-paper">
              {req.serverName} wants to run <span className="font-mono">{req.toolName}</span>
            </div>
            <div className="mb-2 text-xs text-paper-soft">
              on <span className="font-mono">{req.host}</span>
            </div>
            {req.firstUse && (
              <p className="mb-2 text-xs text-paper-soft">
                This device hasn't contacted this server yet.
              </p>
            )}
            <pre className="mb-3 max-h-40 overflow-auto rounded bg-white/5 p-2 text-[11px] text-paper-soft">
              {JSON.stringify(req.args, null, 2)}
            </pre>
            <div className="flex flex-wrap gap-2">
              <Button tone="primary" onClick={() => approve(req.id)}>
                Approve
              </Button>
              <Button onClick={() => deny(req.id)}>Deny</Button>
              <Button className="ml-auto text-xs" onClick={trustAndApprove}>
                Always allow {req.serverName}
              </Button>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}
