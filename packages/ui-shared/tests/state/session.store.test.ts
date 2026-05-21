// SPDX-License-Identifier: LGPL-3.0-only

import type { MasterKey } from '@chatsundere/crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '../../src/state/session.store.js';
import type { AppSession } from '../../src/state/session.store.js';

// Minimal AppSession stub. Real MasterKeySession comes from packages/crypto;
// for store-shape testing we only need the same property surface.
// Note: `mk` is no longer a field on AppSession after the Task 7 refactor —
// it lives on the store as its own slice.
function makeStubSession(opts?: { mk?: Uint8Array; close?: () => void }): AppSession {
  return {
    userId: 'u1',
    username: 'tester',
    mode: 'linked',
    accessToken: 'access-token-stub',
    close: opts?.close ?? vi.fn(),
    // Any extra MasterKeySession fields the store may touch get stubbed
    // here as no-ops. Extend if the store's API surface grows.
  } as unknown as AppSession;
}

describe('useSessionStore', () => {
  beforeEach(() => {
    useSessionStore.setState({ session: null, mk: null });
  });

  it('preserves mk after a partial-update sequence that mimics disconnect+relink', () => {
    const session = makeStubSession();
    // Initial open: pass mk explicitly via the second arg.
    useSessionStore.getState().setSession(session, new Uint8Array(32) as unknown as MasterKey);

    // Simulate a sequence of partial updates that the disconnect+relink
    // flow exercises in production:
    // 1. updateAccessToken (typical refresh during the flow)
    useSessionStore.getState().updateAccessToken('new-token');

    // 2. setSession with a partial spread that does NOT carry mk as a second
    // arg. This is the exact shape used by linking/confirm.tsx after a
    // successful link: setSession({ ...currentSession, mode: 'linked' }).
    const current = useSessionStore.getState().session;
    if (!current) throw new Error('session unexpectedly null');
    useSessionStore.getState().setSession({ ...current, mode: 'linked' });

    // Contract: mk survives the sequence.
    const mkAfter = useSessionStore.getState().mk;
    expect(mkAfter).not.toBeNull();
    expect(mkAfter?.length).toBe(32);
  });

  it('preserves mk when re-linking after a disconnect-without-logout', () => {
    // This is the exact bug reported in
    // obsidian/insights/2026-05-20-mk-lost-after-disconnect.md.
    const session = makeStubSession();
    useSessionStore.getState().setSession(session, new Uint8Array(32) as unknown as MasterKey);

    // Disconnect: handleDisconnect does NOT call setSession or closeAndForget.
    // So nothing happens to the store from the disconnect itself. We simulate
    // any intermediate store activity that might happen during the routing.
    useSessionStore.getState().updateAccessToken('refreshed-during-routing');

    // Re-link confirm screen: doLink reads mk from the store for linkToServer.
    // Under the old shape, the pre-flight check at confirm.tsx:103 was the bug
    // surface. After Task 7, mk lives in its own slice and cannot be dropped
    // by partial-spread updates.
    const mkPreflight = useSessionStore.getState().mk;
    expect(mkPreflight).not.toBeNull(); // The bug was THIS being null.
  });

  it('closeAndForget nulls both session and mk AND zeros the MK buffer via session.close()', () => {
    const close = vi.fn();
    const mk = new Uint8Array(32) as unknown as MasterKey;
    useSessionStore.getState().setSession(makeStubSession({ close }), mk);

    // Sanity: both slices are populated
    expect(useSessionStore.getState().session).not.toBeNull();
    expect(useSessionStore.getState().mk).not.toBeNull();

    useSessionStore.getState().closeAndForget();

    expect(useSessionStore.getState().session).toBeNull();
    expect(useSessionStore.getState().mk).toBeNull();
    // Security-critical: the MK byte buffer must be zeroed via session.close().
    // Without this assertion, a future refactor of closeAndForget that drops
    // the close() call would silently regress the zeroing guarantee.
    expect(close).toHaveBeenCalledOnce();
  });

  it('replaces mk when a new mk is passed (not preserve-on-omit)', () => {
    const mk1 = new Uint8Array(32).fill(0x11) as unknown as MasterKey;
    const mk2 = new Uint8Array(32).fill(0x22) as unknown as MasterKey;
    useSessionStore.getState().setSession(makeStubSession(), mk1);
    expect(useSessionStore.getState().mk).toBe(mk1);

    // Login-after-login: a fresh setSession with a new mk REPLACES the prior one.
    // This is the explicit-pass branch of the asymmetric contract.
    useSessionStore.getState().setSession(makeStubSession(), mk2);
    expect(useSessionStore.getState().mk).toBe(mk2);
    expect(useSessionStore.getState().mk).not.toBe(mk1);
  });
});
