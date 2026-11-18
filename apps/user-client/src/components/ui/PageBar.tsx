// SPDX-License-Identifier: AGPL-3.0-only
import { Fragment } from 'react';
import { useAppNav } from '../../lib/use-app-nav.js';

export interface Crumb {
  label: string;
  /** Route to navigate to. Omit on the last (current) crumb. */
  to?: string;
}

/** What the user asked the bar for: one step back, or up to a crumb's route. */
export type PageBarMove = { kind: 'back' } | { kind: 'to'; to: string };

export interface PageBarProps {
  /** Full breadcrumb trail; the last entry is the current page (omit its `to`). */
  crumbs: Crumb[];
  /** Fallback for the leading ‹ when no in-app page is behind (a cold start):
   *  the nearest parent, or a validated `?return=`. With a page behind, ‹ goes
   *  back to it, exactly like the system Back. */
  back: string;
  /** When given, renders the `?` help affordance; opens the page's help reader.
   *  The button element itself is passed so the overlay can zoom out of it. */
  onHelp?: (el: HTMLElement) => void;
  /** Optional navigation interceptor. When given, the back control and ancestor
   *  crumbs hand it their move instead of navigating, so a parent can guard
   *  unsaved changes and then run the same move. The `?` help is unaffected. */
  onNavigate?: (move: PageBarMove) => void;
}

/**
 * The shared page chrome row (spec §2). Sits sticky beneath the brand bar and
 * never scrolls away. Shows where you are (the bold current crumb), a real ≥44px
 * back control that goes where the user came from (`back` only when nothing is
 * behind), tappable ancestor crumbs that go up, and an optional `?` into help.
 * There is no Save control — the tree saves as you go (Plan 2). Back-navigation
 * inherits the origin-zoom collapse for free via the central NavTransitionOutlet.
 */
export function PageBar({ crumbs, back, onHelp, onNavigate }: PageBarProps): JSX.Element {
  const nav = useAppNav();
  const go = onNavigate ?? ((m: PageBarMove) => runPageBarMove(nav, m, back));
  return (
    <div data-page-bar="" className="cs-pagebar">
      <button
        type="button"
        aria-label="Back"
        className="cs-pagebar-back"
        onClick={() => go({ kind: 'back' })}
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
                  onClick={() => go({ kind: 'to', to: c.to as string })}
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

/** Perform a page-bar move: ‹ is `back(fallback)`, a crumb is `returnTo(to)`. */
export function runPageBarMove(
  nav: ReturnType<typeof useAppNav>,
  move: PageBarMove,
  fallback: string,
): void {
  if (move.kind === 'back') nav.back(fallback);
  else nav.returnTo(move.to);
}
