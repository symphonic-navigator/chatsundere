// SPDX-License-Identifier: AGPL-3.0-only
import type { MouseEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAppNav } from '../../lib/use-app-nav.js';

export interface BackLinkProps {
  /** Where Back goes when no in-app page is behind (a cold start). */
  to: string | { pathname: string; search?: string };
  className?: string;
  'aria-label'?: string;
  children: ReactNode;
}

/**
 * A wizard's own Back link. It steps back like the system Back when a page is
 * behind and only falls back to `to` when nothing is, so the wizard's arrow and
 * the phone's Back agree (spec "Back means one thing"). It carries `.cs-hit`.
 */
export function BackLink({ to, children, className, ...rest }: BackLinkProps): JSX.Element {
  const nav = useAppNav();
  const fallback = typeof to === 'string' ? to : `${to.pathname}${to.search ?? ''}`;
  return (
    <Link
      to={fallback}
      {...rest}
      // Every wizard Back paints no box (a bare arrow or a text link), so the
      // hit area grows invisibly to 44 × 44 here, once, for all of them.
      className={className ? `cs-hit ${className}` : 'cs-hit'}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
        nav.back(fallback);
      }}
    >
      {children}
    </Link>
  );
}
