// SPDX-License-Identifier: AGPL-3.0-only
import { TEAL_BRACKET_RX, isTealWrapping } from '@chatsundere/llm-unified';
import { resolveTealInline } from './teal-render-map.js';

const FENCE_RX = /^\s*(```|~~~)/;
const CODE_SPAN_RX = /(`+)[^`]*?\1/g;
const WRAP_TAG_RX = /<\/?([a-z-]+)>/g;

/** Replaces TEAL tags in one prose segment. */
function translateProse(segment: string): string {
  return segment
    .replace(TEAL_BRACKET_RX, (m, content: string) => {
      const action = resolveTealInline(content);
      if (action === null) return m;
      if (action.kind === 'emoji' || action.kind === 'text') return action.value;
      return '';
    })
    .replace(WRAP_TAG_RX, (m, name: string) => (isTealWrapping(name) ? '' : m));
}

/** Translates one non-fence line, leaving inline-code spans untouched. */
function translateLine(line: string): string {
  const parts: { text: string; code: boolean }[] = [];
  let last = 0;
  for (const match of line.matchAll(CODE_SPAN_RX)) {
    const start = match.index ?? 0;
    parts.push({ text: line.slice(last, start), code: false });
    parts.push({ text: match[0], code: true });
    last = start + match[0].length;
  }
  parts.push({ text: line.slice(last), code: false });

  let changed = false;
  const out = parts.map((p) => {
    if (p.code) return p.text;
    const t = translateProse(p.text);
    if (t !== p.text) changed = true;
    return t;
  });
  if (!changed) return line;
  // Tidy the gaps left by removed or spaced tags, prose only.
  return out
    .map((t, i) => (parts[i]?.code ? t : t.replace(/ {2,}/g, ' ')))
    .join('')
    .replace(/^ +| +$/g, '');
}

/**
 * Text as the chat displays it, for the clipboard: emojis for sounds and
 * moods, the words of wrapping tags without the tags, silent tags removed.
 * Code (fenced and inline) and unknown brackets are left literally.
 */
export function displayPlainText(markdown: string): string {
  let fence: string | null = null;
  return markdown
    .split('\n')
    .map((line) => {
      const f = FENCE_RX.exec(line)?.[1];
      if (fence === null && f) {
        fence = f;
        return line;
      }
      if (fence !== null) {
        if (f === fence) fence = null;
        return line;
      }
      return translateLine(line);
    })
    .join('\n');
}
