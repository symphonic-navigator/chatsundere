// SPDX-License-Identifier: AGPL-3.0-only
import type { ServerConfig } from '@chatsundere/shared-types';
import {
  type Connectivity,
  type DiscoveryStatus,
  type LinkStatus,
  useAccountLinkStore,
  useConnectivityStore,
  useDiscoveryStore,
} from '@chatsundere/ui-shared';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderRow } from '../../src/boot/client-data-db.js';
import { useUsableTemplateIds } from '../../src/lib/usable-providers.js';

vi.mock('@chatsundere/llm-unified', () => ({
  getProvider: (id: string) =>
    id === 'wafer' ? { corsHint: 'requires-proxy' } : { corsHint: 'direct' },
}));

const waferRow = { id: 'r-wafer', templateId: 'wafer', enabled: true, createdAt: 1 } as ProviderRow;

vi.mock('../../src/data/providers.js', () => ({
  useProviders: () => ({ data: [waferRow] }),
}));

const proxyConfig: ServerConfig = { proxyUrl: 'https://proxy.example', features: ['proxy'] };

function setStores(opts: {
  linkStatus: LinkStatus;
  connectivity: Connectivity['kind'];
  discoveryStatus: DiscoveryStatus;
  config: ServerConfig | null;
}): void {
  useAccountLinkStore.setState({ linkStatus: opts.linkStatus });
  useConnectivityStore.setState({ state: { kind: opts.connectivity } });
  useDiscoveryStore.setState({ status: opts.discoveryStatus, config: opts.config });
}

afterEach(() => {
  useAccountLinkStore.setState({
    linkStatus: 'unknown',
    baseUrl: null,
    issuerLabel: null,
    role: null,
  });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useDiscoveryStore.setState({ status: 'unknown', config: null });
});

describe('useUsableTemplateIds — proxy gate matrix', () => {
  it('lists a proxy-required provider when linked, reachable, and the server offers the relay', () => {
    setStores({
      linkStatus: 'linked',
      connectivity: 'linked_online',
      discoveryStatus: 'ok',
      config: proxyConfig,
    });
    const { result } = renderHook(() => useUsableTemplateIds());
    expect(result.current).toEqual(['wafer']);
  });

  it('hides a proxy-required provider when the account is local-only', () => {
    setStores({
      linkStatus: 'local-only',
      connectivity: 'local_online',
      discoveryStatus: 'unknown',
      config: null,
    });
    const { result } = renderHook(() => useUsableTemplateIds());
    expect(result.current).toEqual([]);
  });

  it('hides a proxy-required provider when the linked server is unreachable', () => {
    setStores({
      linkStatus: 'linked',
      connectivity: 'server_unreachable',
      discoveryStatus: 'ok',
      config: proxyConfig,
    });
    const { result } = renderHook(() => useUsableTemplateIds());
    expect(result.current).toEqual([]);
  });

  it('hides a proxy-required provider when the server lacks the proxy feature', () => {
    setStores({
      linkStatus: 'linked',
      connectivity: 'linked_online',
      discoveryStatus: 'ok',
      config: { features: ['sync'] },
    });
    const { result } = renderHook(() => useUsableTemplateIds());
    expect(result.current).toEqual([]);
  });
});
