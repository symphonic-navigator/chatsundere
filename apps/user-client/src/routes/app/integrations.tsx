// SPDX-License-Identifier: AGPL-3.0-only
import { useAccountLinkStore } from '@chatsundere/ui-shared';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge.js';
import { PageScaffold } from '../../components/ui/PageScaffold.js';
import { useHelp } from '../../content/help/use-help.js';
import { useMcpOAuthGrants } from '../../data/mcp-oauth-grants.js';
import { usePendingSignIns } from '../../data/mcp-oauth-pending.js';
import { useMcpServers } from '../../data/mcp-servers.js';
import { QK } from '../../data/queryKeys.js';
import { queryClient } from '../../lib/queryClient.js';
import { useServerGate } from '../../lib/server-gate.js';
import { waitingScreenPath } from '../../mcp/oauth/sign-in-session.js';
import { finishOrphanedSignIns, sweepExpiredSignIns } from '../../mcp/oauth/sign-in.js';
import { statusOf } from '../../mcp/server-status.js';

const rowClass =
  'flex items-center gap-3 rounded-md border border-white/5 bg-white/[0.02] p-3 text-left hover:bg-white/[0.04]';
const iconClass =
  'grid h-10 w-10 place-items-center rounded-md bg-white/5 font-display text-sm text-paper';

/**
 * My Integrations — external service & tool integrations. MCP servers are the
 * first inhabitant; rows are pure navigation into the per-server detail page.
 */
export function Integrations(): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('integrations');
  const navigate = useNavigate();
  const servers = useMcpServers();
  const grants = useMcpOAuthGrants();
  const pending = usePendingSignIns();
  const hasProxy = useServerGate('proxy').enabled;
  const linked = useAccountLinkStore((s) => s.linkStatus === 'linked');

  // A device that died or went offline right after a sign-in saves the server row here,
  // so its grant never orphans; expired sign-ins are cleared at the same time.
  useEffect(() => {
    void finishOrphanedSignIns().catch(() => undefined);
    void sweepExpiredSignIns()
      .then(() => queryClient.invalidateQueries({ queryKey: QK.mcpOAuthPending }))
      .catch(() => undefined);
  }, []);

  const rows = servers.data ?? [];
  const grantById = new Map((grants.data ?? []).map((g) => [g.id, g]));
  const pendingRows = pending.data ?? [];
  const newSignIns = pendingRows.filter(
    (p) => p.isNewServer && !rows.some((r) => r.id === p.serverId),
  );

  return (
    <PageScaffold crumbs={[{ label: 'My Integrations' }]} back="/app" onHelp={onHelp}>
      {helpOverlay}
      <div className="flex flex-col gap-3 px-4 pb-8 pt-2">
        <p className="rounded-md border border-aurora-500/30 bg-aurora-500/[0.04] p-3 text-[11px] text-paper-soft">
          MCP tools run on external servers. Each call sends its arguments — which may include parts
          of your conversation — to that server. Tools wait for your approval unless you mark a
          server as trusted.
        </p>

        {rows.length === 0 && newSignIns.length === 0 ? (
          <p className="rounded-md border border-white/5 bg-white/[0.02] p-4 text-sm text-paper-soft">
            No MCP servers yet — add one to give your Circle external tools.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => navigate(`/app/integrations/${row.id}`)}
                className={rowClass}
              >
                <div className={iconClass}>⧉</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-display text-sm text-paper">{row.name}</div>
                  <div className="text-xs text-paper-soft">
                    {statusOf(row, {
                      hasProxy,
                      linked,
                      grant: grantById.get(row.id),
                      signingIn: pendingRows.some((p) => p.serverId === row.id),
                    })}
                  </div>
                </div>
                <Badge tone={row.onByDefault ? 'success' : 'neutral'}>
                  {row.onByDefault ? 'Default: On' : 'Default: Off'}
                </Badge>
                <span className="text-paper-soft">▸</span>
              </button>
            ))}
            {newSignIns.map((p) => (
              <button
                key={p.state}
                type="button"
                onClick={() => navigate(waitingScreenPath(p.state))}
                className={rowClass}
              >
                <div className={iconClass}>⧉</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-display text-sm text-paper">
                    {p.name || 'New server'}
                  </div>
                  <div className="text-xs text-paper-soft">○ Sign-in in progress</div>
                </div>
                <span className="text-paper-soft">▸</span>
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          aria-label="Add MCP server"
          onClick={() => navigate('/app/integrations/new')}
          className="rounded-md border border-dashed border-white/15 px-3 py-2 text-xs uppercase tracking-wider text-paper-soft hover:border-paper hover:text-paper"
        >
          + Add MCP server
        </button>
      </div>
    </PageScaffold>
  );
}
