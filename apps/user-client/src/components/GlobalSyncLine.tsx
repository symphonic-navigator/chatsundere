// SPDX-License-Identifier: AGPL-3.0-only
import { useAccountLinkStore, useConnectivityStore } from '@chatsundere/ui-shared';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { SyncStateRow } from '../boot/client-data-db.js';
import { getClientDataDb } from '../boot/client-data-db.js';
import { syncCopy } from '../sync/copy.js';
import { getSyncState, isRecovering, subscribeRecovering } from '../sync/watermark.js';
import { deriveSyncStatus } from './SyncStatusLine.js';

/**
 * The always-on, app-wide sync line (spec §3.7 — Chris's conscious revision of
 * the WS-C SOFT-3 deferral). Where {@link SyncStatusLine} carries the full
 * status vocabulary on the account page, this surface is deliberately minimal:
 * it appears on every `/app` route and shows ONLY the two states a user must
 * not miss while working elsewhere in the app —
 *
 *   1. **Backfill progress** — the one-off upload of pre-link data, so a user
 *      who linked mid-session can watch it drain without opening the account
 *      page; and
 *   2. **Attention** — a deliberate engine error state (a paused sync, a quota
 *      wall), so a failure is surfaced immediately rather than lying hidden.
 *
 * Every other status (synced, waiting, offline, pulling, fetching, recovery)
 * renders nothing here — those belong to the account page. It also renders
 * nothing for a local-only (non-linked) user, who has no sync engine, and
 * nothing outside the `/app` routes.
 *
 * The line is collapsible to a small dot (local component state, not
 * persisted), so a user who has acknowledged an ongoing backfill can tuck it
 * away without losing the reassurance that it is still running.
 *
 * It reuses {@link deriveSyncStatus} and the same 2-second Dexie poll as
 * {@link SyncStatusLine} — there is no `useLiveQuery` in this project — so the
 * two surfaces can never disagree about the underlying state.
 */

/** How often the Dexie-backed sync snapshot is re-read (no useLiveQuery in this project). */
const POLL_MS = 2_000;

export function GlobalSyncLine(): JSX.Element | null {
  const linkStatus = useAccountLinkStore((s) => s.linkStatus);
  const connectivityKind = useConnectivityStore((s) => s.state.kind);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [state, setState] = useState<SyncStateRow | null>(null);
  const [outboxCount, setOutboxCount] = useState<number>(0);
  const [recovering, setRecovering] = useState<boolean>(() => isRecovering());
  const [collapsed, setCollapsed] = useState<boolean>(false);

  // The recovery flag is an in-memory signal (§8) — subscribe rather than poll.
  useEffect(() => subscribeRecovering(setRecovering), []);

  // Poll the Dexie-backed sync state + outbox count, mirroring SyncStatusLine.
  useEffect(() => {
    if (linkStatus !== 'linked') return undefined;
    let cancelled = false;
    async function poll(): Promise<void> {
      try {
        const db = getClientDataDb();
        const [s, count] = await Promise.all([getSyncState(), db.syncOutbox.count()]);
        if (!cancelled) {
          setState(s);
          setOutboxCount(count);
        }
      } catch {
        // The DB can be transiently closed (logout, teardown) between polls;
        // that is benign — the next poll (or a re-mount) recovers.
      }
    }
    void poll();
    const id = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [linkStatus]);

  // The engine does not exist for a local-only user (§5), and this surface is
  // scoped to the app itself — nothing renders elsewhere or before the first poll.
  if (linkStatus !== 'linked' || !state || !pathname.startsWith('/app')) return null;

  const view = deriveSyncStatus({
    state,
    outboxCount,
    online: connectivityKind === 'linked_online',
    recovering,
  });

  // §3.7 — this surface carries ONLY backfill and attention; everything else
  // belongs to the account page's fuller SyncStatusLine.
  if (view.kind !== 'backfill' && view.kind !== 'attention') return null;

  // §5.2 — map the router-free reconnect intent onto a navigate-backed action.
  const action =
    view.action ??
    (view.wantsReconnect
      ? {
          label: syncCopy.actions.reconnect,
          onClick: () => navigate('/onboarding/invitation'),
        }
      : undefined);

  if (collapsed) {
    return (
      <button
        type="button"
        aria-label="Show sync status"
        onClick={() => setCollapsed(false)}
        className="fixed bottom-16 right-3 z-40 h-2.5 w-2.5 rounded-full bg-aurora-500/80"
      />
    );
  }

  return (
    <div
      className="fixed bottom-16 inset-x-3 z-40 mx-auto flex max-w-sm items-center gap-2 rounded-[var(--radius-card)] bg-ink-soft/95 px-3 py-2 text-[11px] ring-1 ring-inset ring-aurora-700/20"
      aria-live="polite"
      data-global-sync-status={view.kind}
    >
      <span className={view.tone === 'attention' ? 'text-warning' : 'text-aurora-200'}>
        {view.text}
      </span>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="rounded-md border border-white/10 px-2 py-0.5 text-paper-soft transition-colors hover:border-paper-soft/50 hover:text-paper"
        >
          {action.label}
        </button>
      ) : null}
      <button
        type="button"
        aria-label="Collapse sync status"
        onClick={() => setCollapsed(true)}
        className="ml-auto text-paper-soft hover:text-paper"
      >
        ·
      </button>
    </div>
  );
}
