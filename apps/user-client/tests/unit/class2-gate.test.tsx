// SPDX-License-Identifier: AGPL-3.0-only
import {
  useAccountLinkStore,
  useConnectivityStore,
  useDiscoveryStore,
  useSessionStore,
} from '@chatsundere/ui-shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { MessageRow } from '../../src/boot/client-data-db.js';
import { MessageControls } from '../../src/components/chat/MessageControls.js';
import { syncCopy } from '../../src/sync/copy.js';
import { patchTouchesSyncedField } from '../../src/sync/strip.js';

function setLinkedOffline(): void {
  useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://s.example' });
  useConnectivityStore.setState({ state: { kind: 'server_unreachable' } });
  useSessionStore.setState({ mk: null });
}
function setLocalOnly(): void {
  useAccountLinkStore.setState({ linkStatus: 'local-only', baseUrl: null });
  useConnectivityStore.setState({ state: { kind: 'local_online' } });
}

const MSG = {
  id: 'm1',
  role: 'user',
  bookmarked: false,
  kind: 'normal',
} as unknown as MessageRow;

afterEach(() => {
  cleanup();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useDiscoveryStore.setState({ status: 'idle', config: null } as never);
});

describe('bookmark affordance — offline gating (spec §11.2)', () => {
  it('is disabled with the gentle copy for a linked account that is offline', () => {
    setLinkedOffline();
    let bookmarked = false;
    render(
      <MessageControls
        message={MSG}
        onCopy={() => undefined}
        onBookmark={() => {
          bookmarked = true;
        }}
      />,
    );
    const btn = screen.getByRole('button', { name: /Bookmark/ });
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    // A tap surfaces the gentle copy (touch-reachable) and does NOT bookmark.
    fireEvent.click(btn);
    expect(bookmarked).toBe(false);
    expect(screen.getByText(syncCopy.offlineBookmark)).toBeTruthy();
  });

  it('is enabled for a local-only user (the engine does not exist)', () => {
    setLocalOnly();
    let bookmarked = false;
    render(
      <MessageControls
        message={MSG}
        onCopy={() => undefined}
        onBookmark={() => {
          bookmarked = true;
        }}
      />,
    );
    const btn = screen.getByRole('button', { name: /Bookmark/ });
    expect(btn.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(btn);
    expect(bookmarked).toBe(true);
  });
});

describe('patchTouchesSyncedField — the settings/chats field-split (spec §5/§10)', () => {
  it('treats a device-local-only settings patch as non-synced', () => {
    expect(patchTouchesSyncedField('settings', ['adultMode'])).toBe(false);
    expect(patchTouchesSyncedField('settings', ['animationsEnabled'])).toBe(false);
  });
  it('treats an allowlisted settings field as synced', () => {
    expect(patchTouchesSyncedField('settings', ['displayName'])).toBe(true);
    expect(patchTouchesSyncedField('settings', ['adultMode', 'displayName'])).toBe(true);
  });
  it('treats a device-local-only chat patch as non-synced', () => {
    expect(patchTouchesSyncedField('chats', ['draftInput'])).toBe(false);
    expect(patchTouchesSyncedField('chats', ['openerPending', 'lastMessageAt'])).toBe(false);
  });
  it('treats a chat title/libraryIds patch as synced', () => {
    expect(patchTouchesSyncedField('chats', ['title'])).toBe(true);
    expect(patchTouchesSyncedField('chats', ['libraryIds'])).toBe(true);
  });
  it('an empty patch touches nothing', () => {
    expect(patchTouchesSyncedField('chats', [])).toBe(false);
  });
});
