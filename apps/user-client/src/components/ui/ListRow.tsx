// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';
import { type OverflowItem, OverflowMenu } from './OverflowMenu.js';

export interface ListRowProps {
  /** ① Leading slot — avatar / icon / symbol. */
  leading?: ReactNode;
  /** ② Body — primary line. */
  title: string;
  /** ② Body — secondary line. */
  subtitle?: string;
  /** ③ Trailing slot — badge(s). */
  trailing?: ReactNode;
  /** Tapping the row performs the primary action (open). */
  onOpen?: () => void;
  /** Secondary actions; when present a ⋯ menu renders in the trailing slot. */
  overflow?: OverflowItem[];
}

/**
 * The unified list row: ① Leading · ② Body · ③ Trailing (spec §7). Tapping the
 * row opens; secondary actions live in the ⋯ overflow menu (clicks inside the
 * trailing controls do not bubble to the row's onOpen).
 */
export function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  onOpen,
  overflow,
}: ListRowProps): JSX.Element {
  return (
    <div className="cs-row">
      <button type="button" className="cs-row-main" onClick={onOpen}>
        {leading ? <span className="cs-row-leading">{leading}</span> : null}
        <span className="cs-row-body">
          <span className="cs-row-title">{title}</span>
          {subtitle ? <span className="cs-row-subtitle">{subtitle}</span> : null}
        </span>
      </button>
      {(trailing || overflow) && (
        // biome-ignore lint/a11y/useKeyWithClickEvents: a non-interactive wrapper that only stops bubbling; its children carry the semantics
        <span className="cs-row-trailing" onClick={(e) => e.stopPropagation()}>
          {trailing}
          {overflow && overflow.length > 0 ? <OverflowMenu items={overflow} /> : null}
        </span>
      )}
    </div>
  );
}
