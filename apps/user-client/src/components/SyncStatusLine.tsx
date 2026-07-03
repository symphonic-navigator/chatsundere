// SPDX-License-Identifier: AGPL-3.0-only
import { useAccountLinkStore, useConnectivityStore } from '@chatsundere/ui-shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SyncAttention, SyncStateRow } from '../boot/client-data-db.js';
import { getClientDataDb } from '../boot/client-data-db.js';
import { relativeTimeLabel } from '../lib/relative-time.js';
import { useEagerQueueActive } from '../sync/blob-fetch.js';
import { syncCopy } from '../sync/copy.js';
import { retryRecovery } from '../sync/recovery.js';
import { getSyncState, isRecovering, subscribeRecovering } from '../sync/watermark.js';

/**
 * The account/server-linking page's sync status line (spec §11.1). Renders the
 * enriched status vocabulary from the `SyncStateRow` AND the outbox count — never
 * from the outbox count alone. States, in descending precedence: Recovery →
 * Attention → Pulling → Offline → Backfill → Waiting → Fetching → Synced.
 * "Synced" is defined to EXCLUDE an in-progress pull. Linked accounts only; a
 * local-only user has no sync engine and this line renders nothing.
 */

/** How often the Dexie-backed sync snapshot is re-read (no useLiveQuery in this project). */
const POLL_MS = 2_000;

type StatusTone = 'neutral' | 'active' | 'attention';

interface StatusView {
  kind:
    | 'synced'
    | 'waiting'
    | 'offline'
    | 'pulling'
    | 'recovery'
    | 'attention'
    | 'fetching'
    | 'backfill';
  tone: StatusTone;
  text: string;
  detail?: string;
  action?: { label: string; onClick: () => void };
  /** §5.2 — the attention wants a router-backed relink affordance (mapped in the component). */
  wantsReconnect?: boolean;
}

/** Map an attention (error) state to its catalogue copy and any retry affordance (§11.3). */
function attentionView(a: SyncAttention): {
  text: string;
  action?: StatusView['action'];
  wantsReconnect?: boolean;
} {
  switch (a.kind) {
    case 'quota_exceeded':
      return {
        text: syncCopy.attention.quotaExceeded({
          usedBytes: a.usedBytes,
          quotaBytes: a.quotaBytes,
        }),
      };
    case 'record_too_large':
      return { text: syncCopy.attention.recordTooLarge };
    case 'delete_rate_limited':
      return { text: syncCopy.attention.deleteRateLimited };
    case 'tombstone_threshold':
      return { text: syncCopy.attention.tombstoneThreshold(a.count) };
    case 'tombstone_paused':
      return { text: syncCopy.attention.tombstonePaused(a.count) };
    case 'recovery_paused':
      return {
        text: syncCopy.attention.recoveryPaused,
        action: { label: syncCopy.actions.retry, onClick: () => void retryRecovery() },
      };
    case 'blob_reupload_threshold':
      return { text: syncCopy.attention.blobReuploadThreshold(a) };
    case 'tamper':
      return { text: syncCopy.attention.tamper };
    case 'auth_degraded':
      // §5.2 — the reconnect affordance is router-backed, so the pure derive
      // path only signals intent; the component maps it to a navigate action.
      return { text: syncCopy.attention.authDegraded, wantsReconnect: true };
  }
}

/** Pure precedence resolution — unit-clear and shared with the render path. */
export function deriveSyncStatus(input: {
  state: SyncStateRow;
  outboxCount: number;
  online: boolean;
  recovering: boolean;
  /** WS-D §6: the eager thumb/avatar queue is still draining. */
  fetchingImages?: boolean;
  now?: number;
}): StatusView {
  const { state, outboxCount, online, recovering } = input;
  const now = input.now ?? Date.now();

  // 1. Recovery — the engine is re-checking; Class-2 edits are gated (§8).
  if (recovering) return { kind: 'recovery', tone: 'active', text: syncCopy.status.recovery };

  // 2. Attention — a deliberate engine error state (§11.1/§11.3).
  if (state.attention) {
    const view = attentionView(state.attention);
    return {
      kind: 'attention',
      tone: 'attention',
      text: view.text,
      action: view.action,
      wantsReconnect: view.wantsReconnect,
    };
  }

  // 3. Pulling — an active multi-page pull, or the first-ever sync
  //    (`watermarkRev === 0`). "Synced" is defined to EXCLUDE this.
  const pulling = state.pulling !== null || (state.watermarkRev === 0 && online);
  if (pulling) {
    return {
      kind: 'pulling',
      tone: 'active',
      text: syncCopy.status.pulling,
      detail: state.pulling ? syncCopy.status.pullingProgress(state.pulling.pages) : undefined,
    };
  }

  // 4. Offline — linked but the server is unreachable; queued changes wait. A
  //    paused backfill reassures the user it resumes where it left off (U-6).
  if (!online) {
    const text =
      state.backfillPending === true ? syncCopy.status.offlineBackfill : syncCopy.status.offline;
    return { kind: 'offline', tone: 'neutral', text };
  }

  // 5. Backfill — a one-off upload of pre-link data (§3.7). Ranks above waiting,
  //    below attention, so a quota error is never masked by upload progress (U-5).
  if (state.backfillPending === true) {
    return {
      kind: 'backfill',
      tone: 'active',
      text: syncCopy.status.backfill(state.backfillDone ?? 0, state.backfillTotal ?? 0),
    };
  }

  // 6. Waiting — online with pending outbox entries.
  if (outboxCount > 0)
    return { kind: 'waiting', tone: 'active', text: syncCopy.status.waiting(outboxCount) };

  // 7. Fetching images — records are settled, but the eager thumb/avatar queue
  //    (§6) is still draining. "Synced" is gated until it empties, so the line
  //    never claims completion while pictures are still arriving.
  if (input.fetchingImages)
    return { kind: 'fetching', tone: 'active', text: syncCopy.blob.fetching };

  // 8. Synced — nothing pending, no pull, no attention, no images in flight.
  const rel = state.lastSyncAt !== null ? ` · ${relativeTimeLabel(state.lastSyncAt, now)}` : '';
  return { kind: 'synced', tone: 'neutral', text: `${syncCopy.status.synced}${rel}` };
}

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: 'text-paper-soft',
  active: 'text-aurora-200',
  attention: 'text-warning',
};

export function SyncStatusLine(): JSX.Element | null {
  const navigate = useNavigate();
  const linkStatus = useAccountLinkStore((s) => s.linkStatus);
  const connectivityKind = useConnectivityStore((s) => s.state.kind);
  const [snapshot, setSnapshot] = useState<{ state: SyncStateRow; outboxCount: number } | null>(
    null,
  );
  const [recovering, setRecovering] = useState<boolean>(() => isRecovering());
  const fetchingImages = useEagerQueueActive();

  // The recovery flag is an in-memory signal (§8) — subscribe rather than poll.
  useEffect(() => subscribeRecovering(setRecovering), []);

  // Poll the Dexie-backed sync state + outbox count. No useLiveQuery in this
  // project, so a coarse interval keeps the line honest without a live query.
  useEffect(() => {
    if (linkStatus !== 'linked') return undefined;
    let cancelled = false;
    async function poll(): Promise<void> {
      try {
        const db = getClientDataDb();
        const [state, outboxCount] = await Promise.all([getSyncState(), db.syncOutbox.count()]);
        if (!cancelled) setSnapshot({ state, outboxCount });
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

  // The engine does not exist for a local-only user (§5) — no status line.
  if (linkStatus !== 'linked' || !snapshot) return null;

  const online = connectivityKind === 'linked_online';
  const view = deriveSyncStatus({
    state: snapshot.state,
    outboxCount: snapshot.outboxCount,
    online,
    recovering,
    fetchingImages,
  });

  // §5.2 — map the router-free reconnect intent onto a navigate-backed action.
  const action =
    view.action ??
    (view.wantsReconnect
      ? {
          label: syncCopy.actions.reconnect,
          onClick: () => navigate('/onboarding/invitation'),
        }
      : undefined);

  return (
    <div className="flex items-center gap-2 text-[11px]" aria-live="polite">
      <span className={TONE_CLASS[view.tone]} data-sync-status={view.kind}>
        {view.text}
        {view.detail ? <span className="text-paper-soft"> · {view.detail}</span> : null}
      </span>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="rounded-md border border-white/10 bg-white/[0.02] px-2 py-0.5 text-paper-soft transition-colors hover:border-paper-soft/50 hover:text-paper"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
