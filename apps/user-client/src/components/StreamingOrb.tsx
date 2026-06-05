// SPDX-License-Identifier: AGPL-3.0-only
import { useStreamManagerStore } from '../state/stream-manager.store.js';

interface Props {
  personaId: string;
  colour: string;
}

/**
 * Tiny pulsing dot, shown only when this persona has any live stream.
 * Consumed by PersonaCard and HistoryRow to surface background activity
 * without dominating the listing layout.
 */
export function StreamingOrb({ personaId, colour }: Props): JSX.Element | null {
  const streaming = useStreamManagerStore((s) =>
    [...s.streams.values()].some((h) => h.personaId === personaId),
  );
  if (!streaming) return null;
  return (
    <span
      data-streaming-orb
      aria-hidden
      className="streaming-orb"
      style={{ background: colour, boxShadow: `0 0 6px 0 ${colour}` }}
    />
  );
}
