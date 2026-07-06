// SPDX-License-Identifier: AGPL-3.0-only
import {
  useAccountLinkStore,
  useConnectivityStore,
  useDiscoveryStore,
  useSessionStore,
} from '@chatsundere/ui-shared';
import { afterEach, describe, expect, it } from 'vitest';
import { isClass2Allowed, isSyncAvailable } from '../../src/sync/gate.js';
import { setRecovering } from '../../src/sync/watermark.js';

/** Fully-available linked+online+unlocked+sync baseline. */
function seedAvailable(): void {
  useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
  useDiscoveryStore.setState({
    status: 'ok',
    config: { features: ['sync'] },
  });
  useConnectivityStore.setState({ state: { kind: 'linked_online' } });
  useSessionStore.setState({ session: { accessToken: 'tok' } as never, mk: {} as never });
}

afterEach(() => {
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useDiscoveryStore.setState({ status: 'unknown', config: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ session: null, mk: null });
  setRecovering(false);
});

describe('isSyncAvailable', () => {
  it('mirrors deriveServerGate enabled-ness for the sync feature', () => {
    seedAvailable();
    expect(isSyncAvailable()).toBe(true);

    useAccountLinkStore.setState({ linkStatus: 'local-only', baseUrl: null });
    expect(isSyncAvailable()).toBe(false);

    useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
    useConnectivityStore.setState({ state: { kind: 'server_unreachable' } });
    expect(isSyncAvailable()).toBe(false);
  });
});

describe('isClass2Allowed (§5)', () => {
  it('local-only is always allowed (the engine does not exist)', () => {
    useAccountLinkStore.setState({ linkStatus: 'local-only', baseUrl: null });
    useConnectivityStore.setState({ state: { kind: 'local_offline' } });
    useSessionStore.setState({ session: null, mk: null });
    expect(isClass2Allowed()).toBe(true);
  });

  it('linked + online + unlocked + not-recovering is allowed', () => {
    seedAvailable();
    expect(isClass2Allowed()).toBe(true);
  });

  it('linked + offline is refused', () => {
    seedAvailable();
    useConnectivityStore.setState({ state: { kind: 'server_unreachable' } });
    expect(isClass2Allowed()).toBe(false);
  });

  it('linked + locked session (no MK) is refused', () => {
    seedAvailable();
    useSessionStore.setState({ session: { accessToken: 'tok' } as never, mk: null });
    expect(isClass2Allowed()).toBe(false);
  });

  it('linked + recovery in progress is refused', () => {
    seedAvailable();
    setRecovering(true);
    expect(isClass2Allowed()).toBe(false);
  });

  it('link status still resolving (unknown) is refused', () => {
    useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
    expect(isClass2Allowed()).toBe(false);
  });
});
