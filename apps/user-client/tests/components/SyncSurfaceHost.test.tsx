// SPDX-License-Identifier: AGPL-3.0-only
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Capture the hooks the host registers with the apply pipeline without loading
// the heavy apply module (it pulls in crypto + the whole worker graph).
let capturedSettingsNote: ((n: 'settings-applied' | 'settings-precedence') => void) | undefined;
let capturedTombstone: ((collection: string, key: string) => void) | undefined;

vi.mock('../../src/sync/apply.js', () => ({
  setSettingsNoteHook: (fn: (n: 'settings-applied' | 'settings-precedence') => void) => {
    capturedSettingsNote = fn;
  },
  setOnViewedRecordTombstoned: (fn: (collection: string, key: string) => void) => {
    capturedTombstone = fn;
  },
}));

import { SyncSurfaceHost } from '../../src/components/SyncSurfaceHost.js';
import { useCurrentChatStore } from '../../src/state/current-chat.store.js';
import { useSyncSurfaceStore } from '../../src/state/sync-surface.store.js';
import { useToastStore } from '../../src/state/toast.store.js';

describe('SyncSurfaceHost wiring', () => {
  beforeEach(() => {
    capturedSettingsNote = undefined;
    capturedTombstone = undefined;
    useToastStore.getState().clear();
    useCurrentChatStore.getState().reset();
    useSyncSurfaceStore.getState().clearTombstoned();
  });
  afterEach(() => {
    useToastStore.getState().clear();
    useCurrentChatStore.getState().reset();
    useSyncSurfaceStore.getState().clearTombstoned();
  });

  it('registers the settings-note hook and raises the ordinary "applied" toast', () => {
    render(<SyncSurfaceHost />);
    expect(capturedSettingsNote).toBeTypeOf('function');
    capturedSettingsNote?.('settings-applied');
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.message).toBe("Your account's settings were applied.");
  });

  it('raises the two-tier "took precedence" toast on the precedence note', () => {
    render(<SyncSurfaceHost />);
    capturedSettingsNote?.('settings-precedence');
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.message).toBe("Your other device's settings took precedence here.");
  });

  it('marks the breadcrumb only when the tombstoned chat is the one on screen', () => {
    render(<SyncSurfaceHost />);
    useCurrentChatStore.getState().setChatId('chat-1');

    // A tombstone for the viewed chat marks the breadcrumb.
    capturedTombstone?.('chats', 'chat-1');
    expect(useSyncSurfaceStore.getState().tombstonedChatId).toBe('chat-1');

    useSyncSurfaceStore.getState().clearTombstoned();

    // A tombstone for a different chat, or a non-chat collection, does not.
    capturedTombstone?.('chats', 'chat-2');
    expect(useSyncSurfaceStore.getState().tombstonedChatId).toBeNull();
    capturedTombstone?.('messages', 'chat-1');
    expect(useSyncSurfaceStore.getState().tombstonedChatId).toBeNull();
  });
});
