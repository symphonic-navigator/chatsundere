// SPDX-License-Identifier: AGPL-3.0-only
import { type ReactNode, useCallback, useRef, useState } from 'react';
import { ReadingOverlay } from '../../components/ui/ReadingOverlay.js';
import { HELP_DOCS, type HelpKey } from './index.js';

/** One-line `?` help wiring for a page: returns the onHelp handler for the
 *  PageBar and the overlay element to render. The overlay zooms out of the
 *  `?` button that triggered it. */
export function useHelp(key: HelpKey): {
  onHelp: (el: HTMLElement) => void;
  helpOverlay: ReactNode;
} {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const doc = HELP_DOCS[key];
  const onHelp = useCallback((el: HTMLElement) => {
    triggerRef.current = el;
    setOpen(true);
  }, []);
  return {
    onHelp,
    helpOverlay: (
      <ReadingOverlay
        open={open}
        title={doc.title}
        markdown={doc.markdown}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
      />
    ),
  };
}
