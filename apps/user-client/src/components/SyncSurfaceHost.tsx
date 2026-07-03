// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect } from 'react';
import { useCurrentChatStore } from '../state/current-chat.store.js';
import { useSyncSurfaceStore } from '../state/sync-surface.store.js';
import { toastStore } from '../state/toast.store.js';
import { setOnViewedRecordTombstoned, setSettingsNoteHook } from '../sync/apply.js';
import { syncCopy } from '../sync/copy.js';

/**
 * App-wide registration point for the apply-pipeline UI hooks (spec §11.3,
 * §7.3). Renders nothing; mounted once at the layout root so the hooks are live
 * for the whole session and reset to their no-op defaults on teardown.
 *
 * - Settings note → the two-tier toast (§11.3): an ordinary pulled change vs an
 *   overwrite where this device's value took precedence.
 * - Viewed-record tombstone → the chat-surface breadcrumb (§7.3): fired for
 *   every pulled tombstone, so we filter to the chat currently on screen.
 */
export function SyncSurfaceHost(): null {
  useEffect(() => {
    setSettingsNoteHook((note) => {
      toastStore.show({
        message:
          note === 'settings-precedence' ? syncCopy.settings.precedence : syncCopy.settings.applied,
        tone: 'info',
        durationMs: 7_000,
      });
    });
    return () => setSettingsNoteHook(() => undefined);
  }, []);

  useEffect(() => {
    setOnViewedRecordTombstoned((collection, key) => {
      // The record the user "views" at the chat surface is the chat itself; a
      // tombstone for any other collection is surfaced through the status line,
      // not a breadcrumb.
      if (collection !== 'chats') return;
      if (useCurrentChatStore.getState().chatId === key) {
        useSyncSurfaceStore.getState().markChatTombstoned(key);
      }
    });
    return () => setOnViewedRecordTombstoned(() => undefined);
  }, []);

  return null;
}
