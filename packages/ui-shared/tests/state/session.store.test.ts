import type { MasterKeySession } from '@chatsundere/crypto';
// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '../../src/state/session.store.js';

/**
 * Minimal mock for MasterKeySession.
 * `as unknown as MasterKeySession` is the only allowed cast here — it shapes a
 * minimal stub that does not carry the closure from createMasterKeySession,
 * letting us spy on `close` without importing the full crypto initialisation.
 */
function makeMockSession(): MasterKeySession {
  return {
    id: 'test-id',
    userId: 'u1',
    username: 'alice',
    mode: 'local',
    online: false,
    deriveDek: vi.fn(),
    encrypt: vi.fn(),
    decrypt: vi.fn(),
    produceRecoveryProof: vi.fn(),
    registerLocalBiometric: vi.fn(),
    close: vi.fn(),
  } as unknown as MasterKeySession;
}

beforeEach(() => {
  useSessionStore.setState({ session: null });
});

describe('useSessionStore — initial state', () => {
  it('starts with session === null', () => {
    expect(useSessionStore.getState().session).toBeNull();
  });
});

describe('setSession', () => {
  it('stores the session', () => {
    const session = makeMockSession();
    useSessionStore.getState().setSession(session);
    expect(useSessionStore.getState().session).toBe(session);
  });
});

describe('updateAccessToken', () => {
  it('replaces accessToken while preserving userId, username, and the session reference shape', () => {
    const session = makeMockSession();
    useSessionStore.getState().setSession(session);

    useSessionStore.getState().updateAccessToken('new-token');

    const updated = useSessionStore.getState().session;
    expect(updated).not.toBeNull();
    expect(updated?.accessToken).toBe('new-token');
    expect(updated?.userId).toBe('u1');
    expect(updated?.username).toBe('alice');
  });

  it('is a no-op when there is no active session', () => {
    // Should not throw.
    expect(() => useSessionStore.getState().updateAccessToken('tok')).not.toThrow();
    expect(useSessionStore.getState().session).toBeNull();
  });
});

describe('closeAndForget', () => {
  it('calls session.close() and sets session to null', () => {
    const session = makeMockSession();
    useSessionStore.getState().setSession(session);

    useSessionStore.getState().closeAndForget();

    expect(session.close).toHaveBeenCalledOnce();
    expect(useSessionStore.getState().session).toBeNull();
  });

  it('is a no-op when there is no active session', () => {
    expect(() => useSessionStore.getState().closeAndForget()).not.toThrow();
  });
});
