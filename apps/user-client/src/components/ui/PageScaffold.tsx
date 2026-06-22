// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';
import { type Crumb, PageBar } from './PageBar.js';

export interface PageScaffoldProps {
  crumbs: Crumb[];
  back: string;
  onHelp?: (el: HTMLElement) => void;
  /** The scrolling page content; the PageBar above it stays put. */
  children: ReactNode;
}

/**
 * Standard page layout for the My Account tree (spec §2.4): the sticky PageBar
 * plus a content region. Only the content scrolls — the bar is sticky chrome.
 */
export function PageScaffold({ crumbs, back, onHelp, children }: PageScaffoldProps): JSX.Element {
  return (
    <div className="cs-page">
      <PageBar crumbs={crumbs} back={back} onHelp={onHelp} />
      <div className="cs-page-body">{children}</div>
    </div>
  );
}
