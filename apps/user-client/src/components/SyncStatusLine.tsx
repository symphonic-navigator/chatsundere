// SPDX-License-Identifier: AGPL-3.0-only
import { useAccountLinkStore, useConnectivityStore } from '@chatsundere/ui-shared';
import { useEffect, useState } from 'react';
import type { SyncAttention, SyncStateRow } from '../boot/client-data-db.js';
import { getClientDataDb } from '../boot/client-data-db.js';
import { relativeTimeLabel } from '../lib/relative-time.js';
import { syncCopy } from '../sync/copy.js';
import { retryRecovery } from '../sync/recovery.js';
import { getSyncState, isRecovering, subscribeRecovering } from '../sync/watermark.js';

/**
 * The account/server-linking page's sync status line (spec §11.1). Renders the
 * enriched status vocabulary from the `SyncStateRow` AND the outbox count — never
 * from the outbox count alone. Six states, in descending precedence: Recovery →
 * Attention → Pulling → Offline → Waiting → Synced. "Synced" is defined to
 * EXCLUDE an in-progress pull. Linked accounts only; a local-only user has no
 * sync engine and this line renders nothing.
 */

/** How often the Dexie-backed sync snapshot is re-read (no useLiveQuery in this project). */
const POLL_MS = 2_000;

type StatusTone = 'neutral' | 'active' | 'attention';

interface StatusView {
  kind: 'synced' | 'waiting' | 'offline' | 'pulling' | 'recovery' | 'attention';
  tone: StatusTone;
  text: string;
  detail?: string;
  action?: { label: string; onClick: () => void };
}

/** Map an attention (error) state to its catalogue copy and any retry affordance (§11.3). */
function attentionView(a: SyncAttention): { text: string; action?: StatusView['action'] } {
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
    case 'tamper':
      return { text: syncCopy.attention.tamper };
  }
}

/** Pure precedence resolution — unit-clear and shared with the render path. */
export function deriveSyncStatus(input: {
  state: SyncStateRow;
  outboxCount: number;
  online: boolean;
  recovering: boolean;
  now?: number;
}): StatusView {
  const { state, outboxCount, online, recovering } = input;
  const now = input.now ?? Date.now();

  // 1. Recovery — the engine is re-checking; Class-2 edits are gated (§8).
  if (recovering) return { kind: 'recovery', tone: 'active', text: syncCopy.status.recovery };

  // 2. Attention — a deliberate engine error state (§11.1/§11.3).
  if (state.attention) {
    const view = attentionView(state.attention);
    return { kind: 'attention', tone: 'attention', text: view.text, action: view.action };
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

  // 4. Offline — linked but the server is unreachable; queued changes wait.
  if (!online) return { kind: 'offline', tone: 'neutral', text: syncCopy.status.offline };

  // 5. Waiting — online with pending outbox entries.
  if (outboxCount > 0)
    return { kind: 'waiting', tone: 'active', text: syncCopy.status.waiting(outboxCount) };

  // 6. Synced — nothing pending, no pull, no attention.
  const rel = state.lastSyncAt !== null ? ` · ${relativeTimeLabel(state.lastSyncAt, now)}` : '';
  return { kind: 'synced', tone: 'neutral', text: `${syncCopy.status.synced}${rel}` };
}

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: 'text-paper-soft',
  active: 'text-aurora-200',
  attention: 'text-warning',
};

export function SyncStatusLine(): JSX.Element | null {
  const linkStatus = useAccountLinkStore((s) => s.linkStatus);
  const connectivityKind = useConnectivityStore((s) => s.state.kind);
  const [snapshot, setSnapshot] = useState<{ state: SyncStateRow; outboxCount: number } | null>(
    null,
  );
  const [recovering, setRecovering] = useState<boolean>(() => isRecovering());

  // The recovery flag is an in-memory signal (§8) — subscribe rather than poll.
  useEffect(() => subscribeRecovering(setRecovering), []);

  // Poll the Dexie-backed sync state + outbox count. No useLiveQuery in this
  // project, so a coarse interval keeps the line honest without a live query.
  useEffect(() => {
    if (linkStatus !== 'linked') return undefined;
    let cancelled = false;
    async function poll(): Promise<void> {
      const db = getClientDataDb();
      const [state, outboxCount] = await Promise.all([getSyncState(), db.syncOutbox.count()]);
      if (!cancelled) setSnapshot({ state, outboxCount });
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
  });

  return (
    <div className="flex items-center gap-2 text-[11px]" aria-live="polite">
      <span className={TONE_CLASS[view.tone]} data-sync-status={view.kind}>
        {view.text}
        {view.detail ? <span className="text-paper-soft"> · {view.detail}</span> : null}
      </span>
      {view.action ? (
        <button
          type="button"
          onClick={view.action.onClick}
          className="rounded-md border border-white/10 bg-white/[0.02] px-2 py-0.5 text-paper-soft transition-colors hover:border-paper-soft/50 hover:text-paper"
        >
          {view.action.label}
        </button>
      ) : null}
    </div>
  );
}
