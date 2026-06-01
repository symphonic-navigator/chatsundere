// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';

const COLLAPSE_LINE_THRESHOLD = 15;

/** Wraps a code block; if it exceeds the line threshold it starts collapsed
 *  behind a fade with an "N lines — expand" control. */
export function CollapsibleCode({
  codeStr,
  children,
}: {
  codeStr: string;
  children: React.ReactNode;
}): JSX.Element {
  const lineCount = codeStr.split('\n').length;
  const [expanded, setExpanded] = useState(lineCount <= COLLAPSE_LINE_THRESHOLD);
  const isCollapsible = lineCount > COLLAPSE_LINE_THRESHOLD;

  if (!isCollapsible) return <>{children}</>;

  if (!expanded) {
    return (
      <div className="relative max-h-[240px] overflow-hidden">
        {children}
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#110a25] to-transparent" />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(true);
          }}
          className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-white/10 px-3 py-1 font-mono text-[11px] text-white/55 transition-colors hover:bg-white/15 hover:text-white/75"
        >
          {lineCount} lines — expand
        </button>
      </div>
    );
  }

  return (
    <>
      {children}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setExpanded(false);
        }}
        className="mt-1 w-full rounded-b-lg border border-white/5 bg-white/[0.03] py-1 font-mono text-[11px] text-white/40 transition-colors hover:text-white/65"
      >
        Collapse
      </button>
    </>
  );
}
