// SPDX-License-Identifier: LGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAccountLinkStore } from '../../src/state/account-link.store.js';
import { useConnectivityStore } from '../../src/state/connectivity.store.js';
import {
  maybeProbeLinkedServer,
  probeServer,
  useDiscoveryStore,
} from '../../src/state/discovery.store.js';

const LINKED_URL = 'https://chatsundere.example.org';
const VALID_BODY = { proxyUrl: 'https://proxy.example.org', features: ['proxy'] };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function setLinked(): void {
  useAccountLinkStore.setState({
    linkStatus: 'linked',
    baseUrl: LINKED_URL,
    issuerLabel: null,
    role: 'user',
  });
}

describe('discovery.store', () => {
  beforeEach(() => {
    useDiscoveryStore.setState({ status: 'unknown', config: null, baseUrl: null, fetchedAt: null });
    useAccountLinkStore.setState({
      linkStatus: 'unknown',
      baseUrl: null,
      issuerLabel: null,
      role: null,
    });
    useConnectivityStore.setState({ state: { kind: 'local_online' } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('probeServer returns ok with the parsed config and hits /api/v1/config once', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(VALID_BODY));
    vi.stubGlobal('fetch', fetchMock);
    const result = await probeServer('https://example.org/chatsundere');
    expect(result).toEqual({ kind: 'ok', config: VALID_BODY });
    // Sub-path hosting: the prefix must be preserved.
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.org/chatsundere/api/v1/config',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('classifies network failure as unreachable and schema garbage as invalid', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    expect(await probeServer('https://a.example.org')).toEqual({ kind: 'unreachable' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ nope: true })));
    expect(await probeServer('https://b.example.org')).toEqual({ kind: 'invalid' });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html></html>', { status: 404 })),
    );
    expect(await probeServer('https://c.example.org')).toEqual({ kind: 'invalid' });
  });

  it('coalesces concurrent probes of the same base URL into one request', async () => {
    let release: (r: Response) => void = () => {};
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(gate);
    vi.stubGlobal('fetch', fetchMock);
    const [a, b] = [probeServer(LINKED_URL), probeServer(LINKED_URL)];
    release(jsonResponse(VALID_BODY));
    expect(await a).toEqual({ kind: 'ok', config: VALID_BODY });
    expect(await b).toEqual({ kind: 'ok', config: VALID_BODY });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('mutates the store and connectivity only for the linked base URL', async () => {
    setLinked();
    // A fresh Response per call: this test probes twice (candidate then
    // linked) and a Response body may only be read once.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(VALID_BODY))),
    );

    // Candidate probe (onboarding): store untouched.
    await probeServer('https://candidate.example.org');
    expect(useDiscoveryStore.getState().status).toBe('unknown');

    // Linked probe: store populated, connectivity → linked_online.
    await probeServer(LINKED_URL);
    const s = useDiscoveryStore.getState();
    expect(s.status).toBe('ok');
    expect(s.config).toEqual(VALID_BODY);
    expect(s.baseUrl).toBe(LINKED_URL);
    expect(useConnectivityStore.getState().state.kind).toBe('linked_online');
  });

  it('linked probe failure sets unreachable on both stores; invalid leaves connectivity alone', async () => {
    setLinked();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('down')));
    await probeServer(LINKED_URL);
    expect(useDiscoveryStore.getState().status).toBe('unreachable');
    expect(useConnectivityStore.getState().state.kind).toBe('server_unreachable');

    useConnectivityStore.setState({ state: { kind: 'linked_online' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ bad: 1 })));
    await probeServer(LINKED_URL);
    expect(useDiscoveryStore.getState().status).toBe('invalid');
    expect(useConnectivityStore.getState().state.kind).toBe('linked_online');
  });

  it('a re-probe keeps the previous config while probing', async () => {
    setLinked();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(VALID_BODY)));
    await probeServer(LINKED_URL);

    let release: (r: Response) => void = () => {};
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(gate));
    const second = probeServer(LINKED_URL);
    expect(useDiscoveryStore.getState().status).toBe('probing');
    expect(useDiscoveryStore.getState().config).toEqual(VALID_BODY);
    release(jsonResponse(VALID_BODY));
    await second;
    expect(useDiscoveryStore.getState().status).toBe('ok');
  });

  it('maybeProbeLinkedServer is a no-op when local-only or offline', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    useAccountLinkStore.setState({
      linkStatus: 'local-only',
      baseUrl: null,
      issuerLabel: null,
      role: null,
    });
    maybeProbeLinkedServer();
    expect(fetchMock).not.toHaveBeenCalled();

    setLinked();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    maybeProbeLinkedServer();
    expect(fetchMock).not.toHaveBeenCalled();

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    fetchMock.mockResolvedValue(jsonResponse(VALID_BODY));
    maybeProbeLinkedServer();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
