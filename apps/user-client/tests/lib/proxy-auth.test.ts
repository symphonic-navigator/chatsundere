// SPDX-License-Identifier: AGPL-3.0-only
import {
  useAccountLinkStore,
  useConnectivityStore,
  useDiscoveryStore,
  useSessionStore,
} from '@chatsundere/ui-shared';
import { afterEach, describe, expect, it } from 'vitest';
import { isProxyAvailable, proxyAuthSource } from '../../src/lib/proxy-auth.js';

/** Put the stores in the fully-available (linked + online + proxy) baseline. */
function seedAvailable(): void {
  useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
  useDiscoveryStore.setState({
    status: 'ok',
    config: { proxyUrl: 'https://proxy.example', features: ['proxy'] },
  });
  useConnectivityStore.setState({ state: { kind: 'linked_online' } });
  useSessionStore.setState({ session: { accessToken: 'tok' } as never });
}

afterEach(() => {
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useDiscoveryStore.setState({ status: 'unknown', config: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ session: null });
});

describe('proxyAuthSource.getUrl', () => {
  it('yields the discovery proxyUrl only when linked with the proxy feature', () => {
    seedAvailable();
    expect(proxyAuthSource.getUrl()).toBe('https://proxy.example');

    useAccountLinkStore.setState({ linkStatus: 'local-only', baseUrl: null });
    expect(proxyAuthSource.getUrl()).toBeNull();

    useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
    useDiscoveryStore.setState({
      status: 'ok',
      config: { proxyUrl: 'https://proxy.example', features: [] },
    });
    expect(proxyAuthSource.getUrl()).toBeNull();

    useDiscoveryStore.setState({ status: 'unknown', config: null });
    expect(proxyAuthSource.getUrl()).toBeNull();
  });
});

describe('proxyAuthSource.getToken', () => {
  it('reads the live access token from the session store', () => {
    seedAvailable();
    expect(proxyAuthSource.getToken()).toBe('tok');

    useSessionStore.setState({ session: null });
    expect(proxyAuthSource.getToken()).toBeNull();
  });
});

describe('isProxyAvailable', () => {
  it('mirrors deriveServerGate enabled-ness for the proxy feature', () => {
    seedAvailable();
    expect(isProxyAvailable()).toBe(true);

    useAccountLinkStore.setState({ linkStatus: 'local-only', baseUrl: null });
    expect(isProxyAvailable()).toBe(false);

    useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
    useConnectivityStore.setState({ state: { kind: 'server_unreachable' } });
    expect(isProxyAvailable()).toBe(false);
  });
});
