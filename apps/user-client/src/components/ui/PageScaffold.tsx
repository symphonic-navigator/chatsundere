// SPDX-License-Identifier: AGPL-3.0-only
import { type ReactNode, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConfirmDialog } from './ConfirmDialog.js';
import { type Crumb, PageBar } from './PageBar.js';

export interface PageScaffoldProps {
  crumbs: Crumb[];
  back: string;
  onHelp?: (el: HTMLElement) => void;
  /** When true, leaving via the PageBar back control or an ancestor crumb first
   *  prompts a discard-changes confirm. Omit (or false) for the plain
   *  pass-through used by every always-save page. */
  dirty?: boolean;
  /** A fixed sub-header (tabs / search / filters / count) rendered inside the
   *  sticky chrome block, directly beneath the PageBar. When given, the chrome
   *  block (PageBar + this header) stays put and only `children` scrolls — the
   *  "only the list scrolls" contract for list surfaces. Omit for the plain
   *  page where the whole body scrolls under the PageBar. */
  stickyHeader?: ReactNode;
  /** The scrolling page content; the PageBar (and any `stickyHeader`) stay put. */
  children: ReactNode;
}

/**
 * Standard page layout (spec §2.4): a sticky PageBar plus a scrolling content
 * region. When `dirty` is set, the bar's back/crumb navigation is intercepted by
 * a discard-changes confirm so unsaved input is never lost silently. When
 * `stickyHeader` is given, the PageBar and that header stick together as one
 * chrome block and only the body below scrolls (list surfaces).
 */
export function PageScaffold({
  crumbs,
  back,
  onHelp,
  dirty,
  stickyHeader,
  children,
}: PageScaffoldProps): JSX.Element {
  const navigate = useNavigate();
  const [pending, setPending] = useState<string | null>(null);
  const onNavigate = dirty ? (to: string) => setPending(to) : undefined;
  const bar = <PageBar crumbs={crumbs} back={back} onHelp={onHelp} onNavigate={onNavigate} />;

  return (
    <div className="cs-page">
      {stickyHeader !== undefined ? (
        <div className="cs-page-chrome">
          {bar}
          <div className="cs-page-stickyhead">{stickyHeader}</div>
        </div>
      ) : (
        bar
      )}
      <div className="cs-page-body">{children}</div>
      <ConfirmDialog
        open={pending !== null}
        title="Discard unsaved changes?"
        body="Your changes haven't been saved yet."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const to = pending;
          setPending(null);
          if (to !== null) navigate(to);
        }}
      />
    </div>
  );
}
