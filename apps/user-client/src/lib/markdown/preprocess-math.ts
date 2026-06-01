// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Preprocess markdown to normalise math delimiters that remark-math does not
 * handle natively:
 *   \( ... \)  →  $ ... $    (inline)
 *   \[ ... \]  →  $$ ... $$  (display)
 *
 * Runs before the string reaches ReactMarkdown so remark-math can parse them.
 *
 * Three concerns drive the implementation:
 *
 *   1. Multiline display math. micromark-extension-math only recognises
 *      `$$...$$` as a display fence when both `$$` markers stand at a line
 *      boundary; otherwise it falls back to inline-math parsing, which forbids
 *      newlines inside the content. So when the inner content of `\[...\]`
 *      contains a newline (matrices, aligned, cases, multi-line expressions)
 *      we emit a proper block fence with surrounding blank lines:
 *           \n\n$$\n<content>\n$$\n\n
 *      Single-line content keeps the compact `$$<content>$$` form so it still
 *      flows correctly inside list items, blockquotes, etc.
 *
 *   2. Code spans / code fences. The regex must not rewrite math syntax that
 *      a user typed inside a code span — that would silently corrupt their
 *      text. We mask code regions with a sentinel placeholder before the
 *      math substitutions run, then restore them afterwards.
 *
 *   3. `\\[Npt]` line-break-with-spacing inside aligned environments. The
 *      `\[` regex must not match the `[` of `\\[5pt]`. A negative-look-behind
 *      on `\` prevents the false match.
 */
export function preprocessMath(src: string): string {
  // Step 1 — mask code spans and fenced code blocks with a sentinel that the
  // math regexes will never match. NUL is safe because it is not allowed in
  // valid Markdown / HTML text.
  const masks: string[] = [];
  const mask = (m: string): string => {
    const i = masks.length;
    masks.push(m);
    return `\0CODE${i}\0`;
  };
  let out = src
    // Fenced code blocks with ``` or ~~~ (anchored to a line boundary).
    .replace(
      /(^|\n)(```[\s\S]*?\n```|~~~[\s\S]*?\n~~~)/g,
      (_m, lead: string, fence: string) => `${lead}${mask(fence)}`,
    )
    // Inline code with one or more backticks — `\1` ensures matched fence
    // length on both sides.
    .replace(/(`+)([\s\S]*?)\1/g, (m) => mask(m));

  // Step 2 — \[ ... \] → display math. Negative-look-behind on `\` prevents
  // \\[Npt] (LaTeX line-break with optional spacing) from matching.
  out = out.replace(/(?<!\\)\\\[([\s\S]*?)\\\]/g, (_m, inner: string) => {
    const trimmed = inner.trim();
    if (trimmed.includes('\n')) {
      return `\n\n$$\n${trimmed}\n$$\n\n`;
    }
    return `$$${trimmed}$$`;
  });

  // Step 3 — \( ... \) → inline math. Inner must be trimmed: remark-math v6
  // rejects inline math that starts or ends with whitespace (anti-currency
  // heuristic), so `$ x $` would not be recognised.
  out = out.replace(/(?<!\\)\\\(([\s\S]+?)\\\)/g, (_m, inner: string) => `$${inner.trim()}$`);

  // Step 4 — restore the masked code regions.
  out = out.replace(/\0CODE(\d+)\0/g, (_m, idx: string) => masks[Number(idx)] ?? '');

  return out;
}

/**
 * Strip outer math delimiters that LLMs often include inside a ```latex fence:
 *   $$ ... $$   →   ...
 *   \[ ... \]   →   ...
 *   \( ... \)   →   ...
 *   $ ... $     →   ...
 * KaTeX expects the raw expression without delimiters.
 */
export function stripMathDelimiters(src: string): string {
  const trimmed = src.trim();
  const pairs: Array<[string, string]> = [
    ['$$', '$$'],
    ['\\[', '\\]'],
    ['\\(', '\\)'],
    ['$', '$'],
  ];
  for (const [open, close] of pairs) {
    if (
      trimmed.startsWith(open) &&
      trimmed.endsWith(close) &&
      trimmed.length >= open.length + close.length
    ) {
      return trimmed.slice(open.length, trimmed.length - close.length).trim();
    }
  }
  return trimmed;
}
