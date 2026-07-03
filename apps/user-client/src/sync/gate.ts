// SPDX-License-Identifier: AGPL-3.0-only
import {
  useAccountLinkStore,
  useConnectivityStore,
  useDiscoveryStore,
  useSessionStore,
} from '@chatsundere/ui-shared';
import { deriveServerGate, useServerGate } from '../lib/server-gate.js';
import { isRecovering } from './watermark.js';

/**
 * Sync availability gating (spec §5). The engine only exists for linked
 * accounts: a local-only user edits freely with no gates and no outbox.
 */

/** Hook form of the sync feature gate (disabled-over-hidden with tooltip). */
export function useSyncGate() {
  return useServerGate('sync');
}

/**
 * The disabled-over-hidden verdict for a Class-2 mutating affordance (spec
 * §11.2, Laura hard-1). `disabled` is true only for a LINKED account whose
 * server is currently unreachable/locked/mid-recovery — a local-only user edits
 * freely (the engine does not exist for them), so the gate returns
 * `{ disabled: false, tooltip: null }`. `tooltip` is the WS-0 offline gate copy,
 * to be surfaced through a touch-reachable affordance (a visible sibling, or an
 * `OverflowMenu` item's `disabledReason`), never a `title` alone.
 */
export function useClass2Gate(): { disabled: boolean; tooltip: string | null } {
  const gate = useSyncGate();
  const linkStatus = useAccountLinkStore((s) => s.linkStatus);
  // Gating scope is LINKED accounts only (spec §5): for a local-only user the
  // engine does not exist, and an 'unknown'/unresolved status must not grey
  // controls before the account is even known to be linked.
  if (linkStatus !== 'linked') return { disabled: false, tooltip: null };
  // Linked: mirror the sync feature gate — its tooltip already frames offline,
  // auth-action, and feature-missing states in WS-0's vocabulary.
  return { disabled: !gate.enabled, tooltip: gate.enabled ? null : gate.tooltip };
}

/** Non-hook mirror of `useSyncGate().enabled` for engine code (cf. isProxyAvailable). */
export function isSyncAvailable(): boolean {
  return deriveServerGate({
    linkStatus: useAccountLinkStore.getState().linkStatus,
    connectivity: useConnectivityStore.getState().state.kind,
    discoveryStatus: useDiscoveryStore.getState().status,
    config: useDiscoveryStore.getState().config,
    feature: 'sync',
    // Enabled-ness never depends on the invite URL; it only picks tooltip copy.
    hasInviteUrl: false,
  }).enabled;
}

/**
 * Whether a Class-2 (mutating, online-required) write is currently allowed
 * (spec §5). A local-only user is always allowed — the engine does not exist
 * for them. A linked user needs a reachable server (`linked_online`), an
 * unlocked session (MK present), and no epoch-recovery cycle in progress
 * (editing into a churning merge is a race, §8).
 */
export function isClass2Allowed(): boolean {
  const linkStatus = useAccountLinkStore.getState().linkStatus;
  if (linkStatus === 'local-only') return true;
  if (linkStatus !== 'linked') return false;

  const online = useConnectivityStore.getState().state.kind === 'linked_online';
  const unlocked = useSessionStore.getState().mk !== null;
  return online && unlocked && !isRecovering();
}
