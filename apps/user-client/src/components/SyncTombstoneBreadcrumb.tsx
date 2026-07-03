// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect } from 'react';
import { useCurrentChatStore } from '../state/current-chat.store.js';
import { useSyncSurfaceStore } from '../state/sync-surface.store.js';
import { syncCopy } from '../sync/copy.js';

/**
 * One calm inline breadcrumb on the chat surface (spec §7.3, Laura soft): when a
 * pulled tombstone removes the record the user is currently viewing, we say so
 * once — no per-tombstone toasts. Renders nothing unless the tombstoned chat is
 * the one on screen; clears itself when the viewed chat changes.
 */
export function SyncTombstoneBreadcrumb(): JSX.Element | null {
  const chatId = useCurrentChatStore((s) => s.chatId);
  const tombstonedChatId = useSyncSurfaceStore((s) => s.tombstonedChatId);
  const clearTombstoned = useSyncSurfaceStore((s) => s.clearTombstoned);

  // Stale breadcrumb from a previous chat must not follow the user across a
  // navigation — clear it whenever the viewed chat no longer matches.
  useEffect(() => {
    if (tombstonedChatId !== null && tombstonedChatId !== chatId) clearTombstoned();
  }, [chatId, tombstonedChatId, clearTombstoned]);

  if (tombstonedChatId === null || tombstonedChatId !== chatId) return null;

  return (
    <output className="mx-auto mt-1 block w-full max-w-prose px-4 text-[11px] text-paper-soft">
      {syncCopy.breadcrumb.deletedElsewhere}
    </output>
  );
}
