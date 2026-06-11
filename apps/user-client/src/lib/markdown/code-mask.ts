// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Mask fenced code blocks and inline code spans with NUL-delimited sentinels
 * so string-level preprocessors never rewrite user code, then restore them.
 * Callers MUST call restore(...) before passing the text to any Markdown parser:
 * CommonMark replaces U+0000 with U+FFFD, which would make un-restored
 * sentinels permanent.
 *
 * Fenced blocks are detected with a line-based scan (CommonMark §4.5): a
 * closing fence must consist of ONLY the opening marker optionally followed by
 * whitespace, so a line like "```yaml" inside an open fence is content, not a
 * closer.
 */
export function maskCodeRegions(src: string): { masked: string; restore: (s: string) => string } {
  const masks: string[] = [];
  const mask = (m: string): string => {
    const i = masks.length;
    masks.push(m);
    return `\0CODE${i}\0`;
  };

  // --- Step 1: mask fenced blocks with a line-based scan ---
  // We build the result by accumulating non-fence text as-is and replacing
  // fenced spans with their sentinel. `cursor` tracks the next unwritten position.
  let result = '';
  let inFence = false;
  let fenceMarker = '';
  let fenceStart = 0; // source offset where the current fence opening line begins
  let lineStart = 0;

  for (let i = 0; i <= src.length; i++) {
    const atEnd = i === src.length;
    if (!atEnd && src[i] !== '\n') continue;
    // `i` is the position of the newline ending this line, or src.length.
    const trimmed = src.slice(lineStart, i).trim();
    const fenceOpen = /^(```|~~~)/.exec(trimmed);

    if (inFence) {
      if (
        fenceOpen &&
        trimmed.startsWith(fenceMarker) &&
        trimmed.slice(fenceMarker.length).trim() === ''
      ) {
        // Closing fence line ends at `i` (exclusive). The fence content spans
        // from `fenceStart` through end-of-closing-fence-line (not including
        // the newline after the closing fence, which belongs to the next line).
        result += mask(src.slice(fenceStart, i));
        inFence = false;
        // The newline at position `i` (if it exists) belongs to the following
        // non-fence content and will be picked up when lineStart = i + 1 falls
        // into the else-if / else path below — but we need to ensure the flush
        // at end-of-loop uses the correct cursor. Set fenceStart = i so that
        // the final `result += src.slice(fenceStart)` does NOT re-emit any
        // already-masked content. We'll handle the newline character specially.
        // Emit the newline character now if it exists.
        if (!atEnd) result += '\n';
        fenceStart = i + 1; // next non-fence region starts after the newline
      }
      // Inside a fence: not emitted here — buffered until close.
    } else if (fenceOpen) {
      // Emit non-fence text accumulated before this fence's opening line.
      result += src.slice(fenceStart, lineStart);
      inFence = true;
      fenceMarker = fenceOpen[1] ?? '```';
      fenceStart = lineStart;
    }

    lineStart = i + 1;
  }
  // Flush remaining non-fence content (or mask unclosed fence).
  if (inFence) {
    result += mask(src.slice(fenceStart, src.length));
  } else {
    result += src.slice(fenceStart, src.length);
  }

  // --- Step 2: mask inline code backtick runs (unchanged logic) ---
  const masked = result.replace(/(`+)([\s\S]*?)\1/g, (m) => mask(m));

  const restore = (s: string): string =>
    s.replace(/\0CODE(\d+)\0/g, (_m, idx: string) => masks[Number(idx)] ?? '');
  return { masked, restore };
}
