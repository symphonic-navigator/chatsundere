// SPDX-License-Identifier: LGPL-3.0-only
import type { ServerConfig } from '@chatsundere/shared-types';
import { create } from 'zustand';
import { useAccountLinkStore } from './account-link.store.js';
import { useConnectivityStore } from './connectivity.store.js';
import { parseServerConfig } from './server-config.js';

export type DiscoveryStatus = 'unknown' | 'probing' | 'ok' | 'unreachable' | 'invalid';

interface DiscoveryState {
  status: DiscoveryStatus;
  /** Last successful config; deliberately kept during a re-probe (spec §5). */
  config: ServerConfig | null;
  baseUrl: string | null;
  fetchedAt: number | null;
}

/** Memory-only by design (spec decision 4) — no Dexie, no IDB. */
export const useDiscoveryStore = create<DiscoveryState>(() => ({
  status: 'unknown',
  config: null,
  baseUrl: null,
  fetchedAt: null,
}));

export type ProbeResult =
  | { kind: 'ok'; config: ServerConfig }
  | { kind: 'unreachable' }
  | { kind: 'invalid' };

// Mirrors apps/user-client/src/lib/fetch.ts joinUrl — path-prefix deployments
// (e.g. https://example.com/chatsundere) must keep the prefix, which
// `new URL(path, base)` would drop. ui-shared cannot import from an app.
function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const rel = path.startsWith('/') ? path : `/${path}`;
  return `${base}${rel}`;
}

const inFlight = new Map<string, Promise<ProbeResult>>();

/**
 * Probe a server's public discovery endpoint. Single-flight per base URL.
 * Mutates the discovery store (and connectivity) only when probing the
 * LINKED base URL; candidate probes (onboarding) just return the result.
 */
export function probeServer(baseUrl: string): Promise<ProbeResult> {
  const existing = inFlight.get(baseUrl);
  if (existing) return existing;
  const run = doProbe(baseUrl).finally(() => inFlight.delete(baseUrl));
  inFlight.set(baseUrl, run);
  return run;
}

async function doProbe(baseUrl: string): Promise<ProbeResult> {
  const link = useAccountLinkStore.getState();
  const isLinkedUrl = link.linkStatus === 'linked' && link.baseUrl === baseUrl;
  if (isLinkedUrl) useDiscoveryStore.setState({ status: 'probing', baseUrl });

  let response: Response;
  try {
    response = await fetch(joinUrl(baseUrl, '/api/v1/config'), {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
  } catch {
    if (isLinkedUrl) {
      useDiscoveryStore.setState({ status: 'unreachable' });
      useConnectivityStore.getState().onServerUnreachable();
    }
    return { kind: 'unreachable' };
  }

  const config = await readConfig(response);
  if (config === null) {
    // Reachable but not answering like a Chatsundere backend: the network is
    // fine, so connectivity is deliberately left alone (spec §5).
    if (isLinkedUrl) useDiscoveryStore.setState({ status: 'invalid' });
    return { kind: 'invalid' };
  }

  if (isLinkedUrl) {
    useDiscoveryStore.setState({ status: 'ok', config, baseUrl, fetchedAt: Date.now() });
    useConnectivityStore.getState().onServerOk();
  }
  return { kind: 'ok', config };
}

async function readConfig(response: Response): Promise<ServerConfig | null> {
  if (!response.ok) return null;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  return parseServerConfig(body);
}

/**
 * Fire-and-forget probe of the linked server, used at boot and as the
 * connectivity regain callback (spec §7). No-op when local-only or offline.
 */
export function maybeProbeLinkedServer(): void {
  const { linkStatus, baseUrl } = useAccountLinkStore.getState();
  if (linkStatus !== 'linked' || baseUrl === null) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  void probeServer(baseUrl);
}
