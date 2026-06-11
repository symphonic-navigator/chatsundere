// SPDX-License-Identifier: AGPL-3.0-only
import { maskCodeRegions } from '../markdown/code-mask.js';
import { resolveTealInline, resolveTealWrap } from './teal-render-map.js';

/**
 * String-level TEAL preprocessing, run before the text reaches ReactMarkdown:
 *
 *   - Known inline tags `[laugh]` become their emoji / typographic
 *     replacement (or vanish when silent).
 *   - Known wrapping tags `<whisper>…</whisper>` become Private-Use-Area
 *     sentinel markers that survive micromark as plain text; the rehype-teal
 *     plugin turns the marked ranges into styled spans. (react-markdown
 *     drops raw HTML by default, so the tags themselves would never reach
 *     rehype — and CommonMark replaces NUL with U+FFFD, hence PUA chars.)
 *   - Unknown brackets and unknown angle tags stay literal: the closed
 *     vocabulary is the false-positive guard (spec D2), and the default
 *     pipeline already strips unknown HTML tags while keeping their text.
 *
 * Code fences and inline code are masked during the rewrite.
 */
export const TEAL_MARK_START = '';
export const TEAL_MARK_END = '';

/** Bracket content we consider a tag candidate; `(?!\()` excludes Markdown links. */
const TAG_CANDIDATE = /\[([A-Za-z][A-Za-z\- ]{0,38})\](?!\()/g;
const WRAP_CANDIDATE = /<(\/?)([a-z-]+)>/g;

export function preprocessTeal(src: string): string {
  const { masked, restore } = maskCodeRegions(src);
  let out = masked.replace(TAG_CANDIDATE, (m, content: string) => {
    const action = resolveTealInline(content);
    if (action === null) return m;
    if (action.kind === 'emoji' || action.kind === 'text') return action.value;
    return '';
  });
  out = out.replace(WRAP_CANDIDATE, (m, slash: string, name: string) => {
    const action = resolveTealWrap(name);
    if (action === null) return m;
    if (action.kind === 'wrap') return `${TEAL_MARK_START}${slash}${name}${TEAL_MARK_END}`;
    return '';
  });
  return restore(out);
}
