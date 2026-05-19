// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react';
import { type Connectivity, useConnectivityStore } from '../state/connectivity.store.js';
import { InlineMarker } from './InlineMarker.js';

type Tone = NonNullable<Parameters<typeof InlineMarker>[0]['tone']>;

const label = {
  local_offline: { text: 'Local', tone: 'default' },
  local_online: { text: 'Local', tone: 'default' },
  linked_online: { text: 'Linked', tone: 'success' },
  server_unreachable: { text: 'Server unreachable', tone: 'warning' },
  server_auth_failed: { text: 'Server auth failed', tone: 'danger' },
} satisfies Record<Connectivity['kind'], { text: string; tone: Tone }>;

/**
 * Displays the current connectivity state as an InlineMarker pill.
 * Plays a one-shot scale pulse when the state kind changes to draw the eye
 * without becoming an ongoing distraction.
 */
export function ConnectivityBadge() {
  const state = useConnectivityStore((s) => s.state);
  const meta = label[state.kind];

  // Track previous kind to detect transitions.
  const prevKind = useRef<Connectivity['kind']>(state.kind);
  const [pulsing, setPulsing] = useState(false);

  useEffect(() => {
    if (prevKind.current !== state.kind) {
      prevKind.current = state.kind;
      setPulsing(true);
    }
  }, [state.kind]);

  function handleAnimationEnd() {
    setPulsing(false);
  }

  return (
    <span
      style={pulsing ? { animation: 'badge-pulse 350ms ease-out both' } : undefined}
      onAnimationEnd={handleAnimationEnd}
    >
      <InlineMarker tone={meta.tone}>{meta.text}</InlineMarker>
    </span>
  );
}
