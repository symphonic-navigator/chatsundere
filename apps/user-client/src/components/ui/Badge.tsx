// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'new';

export interface BadgeProps {
  /** Tone — use only when it MEANS something (status). Defaults to 'neutral'. */
  tone?: BadgeTone;
  /** Optional notification count rendered as a small bubble. */
  count?: number;
  /** Render with the single tile-badge token (kept neutral; spec §6, §10). */
  onTile?: boolean;
  children?: ReactNode;
}

/**
 * Read-only status / count / "NEW" marker. A Badge TELLS; it never acts
 * (no onClick). For interactive chips use Pill instead (spec §6).
 */
export function Badge({ tone = 'neutral', count, onTile, children }: BadgeProps): JSX.Element {
  return (
    <span className="cs-badge" data-tone={tone} data-on-tile={onTile ? 'true' : undefined}>
      {children}
      {typeof count === 'number' ? <span className="cs-badge-count">{count}</span> : null}
    </span>
  );
}
