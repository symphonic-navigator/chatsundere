// SPDX-License-Identifier: AGPL-3.0-only
import { useAccountLinkStore } from '@chatsundere/ui-shared';
import { useSyncExternalStore } from 'react';
import { getSyncState } from './watermark.js';

/**
 * A single shared observable of "the server is out of storage" (WS-D §7.3
 * `quota_exceeded`), so the per-item sync markers (§10) can light up without
 * every marker polling Dexie independently. One coarse poll drives them all —
 * mirroring {@link SyncStatusLine}'s cadence but shared.
 *
 * DISPLAY-ONLY (Larissa I-3): this flag never gates a write. It only decides
 * whether an unsynced-blob item wears the calm "storage full" marker; uploads
 * are still attempted and the server's per-request verdict governs.
 */

/** How often the quota attention flag is re-read while any marker is mounted. */
const POLL_MS = 2_000;

let blocked = false;
let intervalId: ReturnType<typeof setInterval> | null = null;
const subscribers = new Set<() => void>();

/** Whether the linked server last reported its storage full (§7.3). */
export function isQuotaBlocked(): boolean {
  return blocked;
}

function notify(): void {
  for (const cb of subscribers) cb();
}

function setBlocked(next: boolean): void {
  if (blocked === next) return;
  blocked = next;
  notify();
}

async function poll(): Promise<void> {
  // Local-only users have no sync engine; never touch (or lazily create) the
  // sync-state row for them — the flag simply stays false.
  if (useAccountLinkStore.getState().linkStatus !== 'linked') {
    setBlocked(false);
    return;
  }
  try {
    const state = await getSyncState();
    setBlocked(state.attention?.kind === 'quota_exceeded');
  } catch {
    // The DB can be transiently closed (logout, teardown) between polls; the
    // next tick recovers, and a stale flag is harmless (display-only).
  }
}

/** Subscribe to quota-blocked transitions; starts the shared poll on first use. */
export function subscribeQuotaBlocked(cb: () => void): () => void {
  subscribers.add(cb);
  if (intervalId === null) {
    void poll();
    intervalId = setInterval(() => void poll(), POLL_MS);
  }
  return () => {
    subscribers.delete(cb);
    if (subscribers.size === 0 && intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}

/** React binding: `true` while the linked server reports its storage full. */
export function useQuotaBlocked(): boolean {
  return useSyncExternalStore(subscribeQuotaBlocked, isQuotaBlocked, isQuotaBlocked);
}

/** Test seam: drive the flag directly, bypassing the poll. */
export function _setQuotaBlockedForTests(value: boolean): void {
  setBlocked(value);
}

/** Test seam: reset the flag + tear down the shared poll between tests. */
export function _resetQuotaSignalForTests(): void {
  blocked = false;
  subscribers.clear();
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
