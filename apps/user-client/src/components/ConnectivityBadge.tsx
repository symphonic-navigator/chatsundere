// SPDX-License-Identifier: AGPL-3.0-only
import {
  type Connectivity,
  InlineMarker,
  type LinkStatus,
  useAccountLinkStore,
  useConnectivityStore,
} from '@chatsundere/ui-shared';
import { useEffect, useRef, useState } from 'react';
import { syncCopy } from '../sync/copy.js';

type Tone = NonNullable<Parameters<typeof InlineMarker>[0]['tone']>;

const label = {
  local_offline: { text: 'Local', tone: 'default' },
  local_online: { text: 'Local', tone: 'default' },
  linked_online: { text: 'Linked', tone: 'success' },
  server_unreachable: { text: 'Server unreachable', tone: 'warning' },
  server_auth_failed: { text: 'Server auth failed', tone: 'danger' },
} satisfies Record<Connectivity['kind'], { text: string; tone: Tone }>;

// Shorter text for the in-chat minimal cue, where the reading surface is tight.
// Only the two bad-weather states ever render there; the tap framing carries the
// full explanation.
const minimalLabel: Partial<Record<Connectivity['kind'], string>> = {
  // "Not synced" rather than "Offline": in a local-first app only shared-edit
  // sync is paused — the chat itself works fully. The tap framing carries the rest.
  server_unreachable: 'Not synced',
  server_auth_failed: 'Auth failed',
};

/**
 * The expanded/tapped framing — "the badge explains the weather" (spec §11.2).
 * While a linked user is offline it carries the system-level explanation that
 * shared edits are paused but nothing is lost; other states get a calm
 * one-liner. Local-only users get no engine framing.
 */
export function connectivityFraming(kind: Connectivity['kind'], linkStatus: LinkStatus): string {
  if (linkStatus !== 'linked') return syncCopy.connectivity.local;
  switch (kind) {
    case 'linked_online':
      return syncCopy.connectivity.linkedOnline;
    case 'server_auth_failed':
      return syncCopy.connectivity.authFailed;
    default:
      // server_unreachable (and any local_* a linked device transiently shows):
      // the app rests into reading mode — shared edits paused, wakes on return.
      return syncCopy.connectivity.offlinePaused;
  }
}

/**
 * Displays the current connectivity state as an InlineMarker pill.
 * Plays a one-shot scale pulse when the state kind changes to draw the eye
 * without becoming an ongoing distraction. Tapping expands a calm framing panel
 * (§11.2) — for a linked user offline this is the paused-shared-edits explanation.
 */
export function ConnectivityBadge({ minimal = false }: { minimal?: boolean } = {}) {
  const state = useConnectivityStore((s) => s.state);
  const linkStatus = useAccountLinkStore((s) => s.linkStatus);
  const meta = label[state.kind];

  // Track previous kind to detect transitions.
  const prevKind = useRef<Connectivity['kind']>(state.kind);
  const [pulsing, setPulsing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (prevKind.current !== state.kind) {
      prevKind.current = state.kind;
      setPulsing(true);
    }
  }, [state.kind]);

  function handleAnimationEnd() {
    setPulsing(false);
  }

  // In-chat minimal mode stays silent while the weather is fine — only the
  // warning/danger states earn space on the reading surface, so an offline or
  // auth-failed linked user still gets an ambient cue (spec §11.2 / SOFT-1).
  if (minimal && meta.tone !== 'warning' && meta.tone !== 'danger') return null;
  const text = (minimal && minimalLabel[state.kind]) || meta.text;

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={`Connectivity: ${text}`}
        onClick={() => setExpanded((v) => !v)}
        style={pulsing ? { animation: 'badge-pulse 350ms ease-out both' } : undefined}
        onAnimationEnd={handleAnimationEnd}
      >
        <InlineMarker tone={meta.tone}>{text}</InlineMarker>
      </button>
      {expanded ? (
        <output className="absolute right-0 top-full z-30 mt-1 block w-64 rounded-md border border-white/10 bg-ink-soft/95 p-3 text-[11px] leading-relaxed text-paper-soft shadow-lg backdrop-blur-sm">
          {connectivityFraming(state.kind, linkStatus)}
        </output>
      ) : null}
    </span>
  );
}
