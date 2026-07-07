// SPDX-License-Identifier: AGPL-3.0-only
import { useAccountLinkStore, useConnectivityStore } from '@chatsundere/ui-shared';
import { useEffect, useState } from 'react';
import { getSyncState } from './watermark.js';

/**
 * Pre-test analysis #9 — "is the first post-link sync still pending?" A freshly
 * linked device (deviceless recovery, pairing, invitation join) lands in `/app`
 * with an empty vault while the first pull is still running; the Entrance Hall
 * uses this to suppress the "Create your first companion" setup card (active
 * misdirection that invites a duplicate persona) in favour of a calm
 * "Syncing your account…" cue.
 *
 * The signal is `lastSyncAt === null`: stamped by every completed sync cycle
 * (`noteCycleCompleted`) and reset to null by every engine reset
 * (`resetEngineStateForNewLink`) and fresh device, it flips exactly once the
 * first cycle — drain, full pull, backfill — has finished, INCLUDING on a
 * genuinely empty account (unlike a watermark heuristic, which never advances
 * when the server has nothing to serve). Gated on `linked_online` so a device
 * that knows it cannot sync right now (offline, unreachable) falls back to the
 * ordinary setup card instead of a cue that cannot resolve.
 */

/** How often the Dexie-backed sync snapshot is re-read (no useLiveQuery in this project). */
const POLL_MS = 2_000;

export function useFirstSyncPending(): boolean {
  const linkStatus = useAccountLinkStore((s) => s.linkStatus);
  const connectivityKind = useConnectivityStore((s) => s.state.kind);
  // `undefined` = not yet polled. Treated as PENDING below: for a linked-online
  // device the safe flash direction is cue→card, never card→cue (a one-tick
  // flash of "create your first companion" is exactly the misdirection).
  const [lastSyncAt, setLastSyncAt] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    if (linkStatus !== 'linked') return undefined;
    let cancelled = false;
    async function poll(): Promise<void> {
      try {
        const state = await getSyncState();
        if (!cancelled) setLastSyncAt(state.lastSyncAt);
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

  return (
    linkStatus === 'linked' &&
    connectivityKind === 'linked_online' &&
    (lastSyncAt === undefined || lastSyncAt === null)
  );
}
