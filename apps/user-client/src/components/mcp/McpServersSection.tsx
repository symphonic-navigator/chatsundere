// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from 'react';
import type { McpServerRow } from '../../boot/client-data-db.js';
import { useMcpServers, useUpsertMcpServer } from '../../data/mcp-servers.js';
import { useSettings } from '../../data/settings.js';
import { McpServerSheet } from './McpServerSheet.js';

/** Row status string, mirroring the provider-row status convention. */
function statusOf(row: McpServerRow, hasProxy: boolean): string {
  if (!row.enabled) return '✗ Disabled';
  if (row.routing === null) {
    // Proxy-only intent with no proxy configured: name both ways forward, not a dead end.
    if (!row.allowDirect && !hasProxy) return '✗ Needs proxy or Local network';
    return '✗ Not tested';
  }
  if (row.routing === 'proxy' && !hasProxy) return '✗ Needs proxy';
  if (row.lastError) return `✗ ${row.lastError}`;
  return row.routing === 'proxy' ? '● Connected (via proxy)' : '● Connected (direct)';
}

/** MCP Servers list: egress note, configured servers with per-row toggle, add button. */
export function McpServersSection(): JSX.Element {
  const servers = useMcpServers();
  const settings = useSettings();
  const upsert = useUpsertMcpServer();

  // `null` = closed; `false` = open for a new server; an object = open for that row.
  const [sheet, setSheet] = useState<McpServerRow | false | null>(null);

  const rows = servers.data ?? [];
  const hasProxy = settings.data?.corsProxy != null;

  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-md border border-aurora-500/30 bg-aurora-500/[0.04] p-3 text-[11px] text-paper-soft">
        MCP tools run on external servers. Each call sends its arguments — which may include parts
        of your conversation — to that server. Tools wait for your approval unless you mark a server
        as trusted.
      </p>

      {rows.length === 0 ? (
        <p className="rounded-md border border-white/5 bg-white/[0.02] p-4 text-sm text-paper-soft">
          No MCP servers yet — add one to give your Circle external tools.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex items-center gap-3 rounded-md border border-white/5 bg-white/[0.02] p-3"
            >
              <button
                type="button"
                onClick={() => setSheet(row)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <div className="grid h-10 w-10 place-items-center rounded-md bg-white/5 font-display text-sm text-paper">
                  ⧉
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-display text-sm text-paper">{row.name}</div>
                  <div className="text-xs text-paper-soft">{statusOf(row, hasProxy)}</div>
                </div>
                <span className="text-paper-soft">▸</span>
              </button>
              <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-paper-soft">
                <input
                  type="checkbox"
                  checked={row.onByDefault}
                  onChange={() =>
                    upsert.mutate({ ...row, onByDefault: !row.onByDefault, updatedAt: Date.now() })
                  }
                  aria-label={`Enable ${row.name} by default`}
                />
                On
              </label>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        aria-label="Add MCP server"
        onClick={() => setSheet(false)}
        className="rounded-md border border-dashed border-white/15 px-3 py-2 text-xs uppercase tracking-wider text-paper-soft hover:border-paper hover:text-paper"
      >
        + Add MCP server
      </button>

      {sheet !== null ? (
        <McpServerSheet
          existing={sheet === false ? undefined : sheet}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </div>
  );
}
