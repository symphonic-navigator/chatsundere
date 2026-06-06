// SPDX-License-Identifier: AGPL-3.0-only

const MAX = 50;

function truncate(s: string): string {
  return s.length <= MAX ? s : `${s.slice(0, MAX).trimEnd()}…`;
}

/** Default title for a saved message: visible text, whitespace collapsed,
 *  trimmed, truncated. Falls back to a constant when there is no text. */
export function messageSnippetTitle(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > 0 ? truncate(collapsed) : 'Saved message';
}

/** Default title for a saved code block: the first non-empty line, truncated.
 *  Falls back to "<lang> snippet" when the code has no meaningful line. */
export function codeSnippetTitle(code: string, lang: string): string {
  const firstLine = code
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return firstLine ? truncate(firstLine) : `${lang} snippet`;
}
