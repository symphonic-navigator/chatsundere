// SPDX-License-Identifier: AGPL-3.0-only
import type { KnownServerFeature, ServerConfig } from '@chatsundere/shared-types';
import {
  type Connectivity,
  type DiscoveryStatus,
  type LinkStatus,
  useAccountLinkStore,
  useConnectivityStore,
  useDiscoveryStore,
} from '@chatsundere/ui-shared';
import { env } from '../env.js';
import { copy } from './copy.js';

/**
 * Machine-readable disabled reasons, deliberately isomorphic to the distinct
 * user next-steps (spec §8, Laura-passed): consumers must be able to branch
 * on `reason` alone — invitation pointer for local-only, operator hint for
 * server-error — without re-reading the underlying stores.
 */
export type GateReason =
  | 'local-only'
  | 'offline'
  | 'auth-action'
  | 'server-error'
  | 'feature-missing'
  | 'unknown';

export interface ServerGate {
  enabled: boolean;
  reason: GateReason | null; // null iff enabled
  tooltip: string | null; // ready-to-render copy, null iff enabled
}

export interface GateInputs {
  linkStatus: LinkStatus;
  connectivity: Connectivity['kind'];
  discoveryStatus: DiscoveryStatus;
  config: ServerConfig | null;
  feature: KnownServerFeature;
  hasInviteUrl: boolean;
}

function disabled(reason: GateReason, tooltip: string): ServerGate {
  return { enabled: false, reason, tooltip };
}

/** Pure derivation per the spec §8 table — first match wins. */
export function deriveServerGate(i: GateInputs): ServerGate {
  if (i.linkStatus === 'unknown') return disabled('unknown', copy.serverGate.checking);
  if (i.linkStatus === 'local-only') {
    return disabled(
      'local-only',
      i.hasInviteUrl ? copy.serverGate.localOnlyWithInvite : copy.serverGate.localOnly,
    );
  }
  if (i.connectivity === 'server_auth_failed') {
    return disabled('auth-action', copy.serverGate.authAction);
  }
  if (i.connectivity === 'server_unreachable' || i.connectivity === 'local_offline') {
    return disabled('offline', copy.serverGate.offline);
  }
  if (i.discoveryStatus === 'invalid') {
    return disabled('server-error', copy.serverGate.serverOdd);
  }
  // 'unknown'/'probing' before any success this session; a re-probe keeps
  // gating on the previous config (spec §5: config kept during re-probe).
  if (i.config === null) return disabled('unknown', copy.serverGate.checking);
  if (!i.config.features.includes(i.feature)) {
    return disabled('feature-missing', copy.serverGate.featureMissing);
  }
  return { enabled: true, reason: null, tooltip: null };
}

/**
 * The disabled-over-hidden gate for server-coupled features. Affordance
 * mandate (spec §8): consumers MUST surface `tooltip` through a
 * touch-reachable affordance; `title` is desktop augmentation only.
 */
export function useServerGate(feature: KnownServerFeature): ServerGate {
  const linkStatus = useAccountLinkStore((s) => s.linkStatus);
  const connectivity = useConnectivityStore((s) => s.state.kind);
  const discoveryStatus = useDiscoveryStore((s) => s.status);
  const config = useDiscoveryStore((s) => s.config);
  return deriveServerGate({
    linkStatus,
    connectivity,
    discoveryStatus,
    config,
    feature,
    hasInviteUrl: env.VITE_INVITE_REQUEST_URL !== undefined,
  });
}
