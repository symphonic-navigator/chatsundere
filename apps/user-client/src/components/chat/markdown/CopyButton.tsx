// SPDX-License-Identifier: AGPL-3.0-only
import { type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';

/** Copy-to-clipboard button overlaid on a code block; shows "Copied" for
 *  1.5 s after a successful copy. */
export function CopyButton({ text }: { text: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );

  const handleCopy = useCallback(
    (e: MouseEvent) => {
      // The button lives inside the message bubble, whose onClick toggles
      // expand/collapse — stop the click bubbling up so copying doesn't also
      // toggle the message.
      e.stopPropagation();
      navigator.clipboard.writeText(text);
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 1500);
    },
    [text],
  );

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="absolute right-2 top-2 z-10 rounded border border-white/10 bg-white/10 px-2 py-0.5 font-mono text-[11px] text-white/45 transition-colors hover:bg-white/15 hover:text-white/70"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
