// SPDX-License-Identifier: AGPL-3.0-only
import { Fragment } from 'react';
import { useNavigate } from 'react-router-dom';

export interface Crumb {
  label: string;
  /** Route to navigate to. Omit on the last (current) crumb. */
  to?: string;
}

export interface PageBarProps {
  /** Full breadcrumb trail; the last entry is the current page (omit its `to`). */
  crumbs: Crumb[];
  /** Route the leading ‹ back control navigates to (nearest parent / Home). */
  back: string;
  /** When given, renders the `?` help affordance; opens the page's help reader.
   *  The button element itself is passed so the overlay can zoom out of it. */
  onHelp?: (el: HTMLElement) => void;
}

/**
 * The shared page chrome row (spec §2). Sits sticky beneath the brand bar and
 * never scrolls away. Shows where you are (the bold current crumb), where Back
 * returns you (a real ≥44px back control → `back`, plus tappable ancestor
 * crumbs), and an optional `?` into contextual help. There is no Save control —
 * the tree saves as you go (Plan 2). Back-navigation inherits the origin-zoom
 * collapse for free via the central NavTransitionOutlet.
 */
export function PageBar({ crumbs, back, onHelp }: PageBarProps): JSX.Element {
  const navigate = useNavigate();
  return (
    <div data-page-bar="" className="cs-pagebar">
      <button
        type="button"
        aria-label="Back"
        className="cs-pagebar-back"
        onClick={() => navigate(back)}
      >
        ‹
      </button>
      <nav aria-label="Breadcrumb" className="cs-pagebar-crumbs">
        {crumbs.map((c, i) => {
          const isCurrent = i === crumbs.length - 1;
          return (
            <Fragment key={c.label}>
              {i > 0 ? (
                <span className="cs-pagebar-sep" aria-hidden="true">
                  /
                </span>
              ) : null}
              {isCurrent || !c.to ? (
                <span className="cs-pagebar-current" aria-current="page">
                  {c.label}
                </span>
              ) : (
                <button
                  type="button"
                  className="cs-pagebar-crumb"
                  onClick={() => navigate(c.to as string)}
                >
                  {c.label}
                </button>
              )}
            </Fragment>
          );
        })}
      </nav>
      {onHelp ? (
        <button
          type="button"
          aria-label="Help"
          className="cs-pagebar-help"
          onClick={(e) => onHelp(e.currentTarget)}
        >
          ?
        </button>
      ) : (
        <span className="cs-pagebar-help-spacer" aria-hidden="true" />
      )}
    </div>
  );
}
