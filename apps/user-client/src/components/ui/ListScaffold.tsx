// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';

export interface ListScaffoldProps {
  title: ReactNode;
  /** Shown after the title (e.g. "My Circle · 13"). */
  count?: number;
  /** The always-present, fixed-position back control (spec §3.4). */
  onBack: () => void;
  /** Optional (?) help affordance. */
  onHelp?: () => void;
  /** Fixed footer (e.g. a gold "+ New" primary action) — never scrolls. */
  footer?: ReactNode;
  /** When true, render `empty` in place of `children`. */
  isEmpty?: boolean;
  /** Constructive empty-state content (spec §7). */
  empty?: ReactNode;
  /** The scrolling list region — the ONLY part that scrolls. */
  children: ReactNode;
}

/**
 * List page scaffold: a fixed header (back control left, title centre, optional
 * ? right), a single scrolling region, and a fixed footer. Only the list region
 * scrolls — header and footer stay put (spec §7). The back control is always
 * visible in a constant position (spec §3.4); no surface is a dead-end.
 */
export function ListScaffold({
  title,
  count,
  onBack,
  onHelp,
  footer,
  isEmpty,
  empty,
  children,
}: ListScaffoldProps): JSX.Element {
  return (
    <div className="cs-scaffold">
      <header className="cs-scaffold-header">
        <button type="button" aria-label="Back" className="cs-scaffold-back" onClick={onBack}>
          ←
        </button>
        <h2 className="cs-scaffold-title">
          {title}
          {typeof count === 'number' ? (
            <span className="cs-scaffold-count">
              {' · '}
              <span>{count}</span>
            </span>
          ) : null}
        </h2>
        {onHelp ? (
          <button type="button" aria-label="Help" className="cs-scaffold-help" onClick={onHelp}>
            ?
          </button>
        ) : (
          <span className="cs-scaffold-help-spacer" aria-hidden="true" />
        )}
      </header>
      <div className="cs-scaffold-scroll">{isEmpty ? empty : children}</div>
      {footer ? <footer className="cs-scaffold-footer">{footer}</footer> : null}
    </div>
  );
}
