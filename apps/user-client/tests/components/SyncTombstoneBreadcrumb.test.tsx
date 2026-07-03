// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SyncTombstoneBreadcrumb } from '../../src/components/SyncTombstoneBreadcrumb.js';
import { useCurrentChatStore } from '../../src/state/current-chat.store.js';
import { useSyncSurfaceStore } from '../../src/state/sync-surface.store.js';

describe('SyncTombstoneBreadcrumb (§7.3)', () => {
  beforeEach(() => {
    useCurrentChatStore.getState().reset();
    useSyncSurfaceStore.getState().clearTombstoned();
  });
  afterEach(() => {
    useCurrentChatStore.getState().reset();
    useSyncSurfaceStore.getState().clearTombstoned();
  });

  it('renders nothing when no viewed record has been tombstoned', () => {
    useCurrentChatStore.getState().setChatId('chat-1');
    const { container } = render(<SyncTombstoneBreadcrumb />);
    expect(container.firstChild).toBeNull();
  });

  it('shows one calm notice when the currently-viewed chat was tombstoned', () => {
    useCurrentChatStore.getState().setChatId('chat-1');
    useSyncSurfaceStore.getState().markChatTombstoned('chat-1');
    render(<SyncTombstoneBreadcrumb />);
    expect(screen.getByText('This was deleted on another device.')).toBeInTheDocument();
  });

  it('does not show for a tombstone of a different chat', () => {
    useCurrentChatStore.getState().setChatId('chat-1');
    useSyncSurfaceStore.getState().markChatTombstoned('chat-2');
    const { container } = render(<SyncTombstoneBreadcrumb />);
    expect(container.firstChild).toBeNull();
  });
});
