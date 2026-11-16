// SPDX-License-Identifier: AGPL-3.0-only
import { TEAL_BRACKET_RX, isTealWrapping } from '@chatsundere/llm-unified';
import { resolveTealInline } from './teal-render-map.js';

const FENCE_RX = /^\s*(```|~~~)/;
const CODE_SPAN_RX = /(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g;
const LIST_ITEM_RX = /^\s*(?:[-*+]|\d+[.)])\s/;
const INDENTED_CODE_RX = /^(?: {4}|\t)/;
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
  const lead = /^\s*/.exec(line)?.[0] ?? '';
  const hardBreak = / {2,}$/.test(line) ? '  ' : '';
  const body = line.slice(lead.length);
  const parts: { text: string; code: boolean }[] = [];
  let last = 0;
  for (const match of body.matchAll(CODE_SPAN_RX)) {
    const start = match.index ?? 0;
    parts.push({ text: body.slice(last, start), code: false });
    parts.push({ text: match[0], code: true });
    last = start + match[0].length;
  }
  parts.push({ text: body.slice(last), code: false });

  let changed = false;
  const out = parts.map((p) => {
    if (p.code) return p.text;
    const t = translateProse(p.text);
    if (t !== p.text) changed = true;
    return t;
  });
  if (!changed) return line;
  // Tidy the gaps left by removed or spaced tags, prose only.
  const tidy = out
    .map((t, i) => (parts[i]?.code ? t : t.replace(/ {2,}/g, ' ')))
    .join('')
    .replace(/^ +| +$/g, '');
  return lead + tidy + hardBreak;
}

/**
 * Text as the chat displays it, for the clipboard: emojis for sounds and
 * moods, the words of wrapping tags without the tags, silent tags removed.
 * Code (fenced and inline) and unknown brackets are left literally.
 */
export function displayPlainText(markdown: string): string {
  let fence: string | null = null;
  let inList = false;
  let inIndentedCode = false;
  let prevBlank = true;
  return markdown
    .split('\n')
    .map((line) => {
      const blank = line.trim() === '';
      const wasBlank = prevBlank;
      prevBlank = blank;
      if (fence === null && inIndentedCode && !blank && !INDENTED_CODE_RX.test(line)) {
        inIndentedCode = false;
      }
      const f = FENCE_RX.exec(line)?.[1];
      if (fence === null && f && !inIndentedCode) {
        fence = f;
        return line;
      }
      if (fence !== null) {
        if (f === fence) fence = null;
        return line;
      }
      if (inIndentedCode) return line;
      if (!blank) {
        if (LIST_ITEM_RX.test(line)) inList = true;
        else if (!/^\s/.test(line)) inList = false;
      }
      if (wasBlank && !blank && !inList && INDENTED_CODE_RX.test(line)) {
        inIndentedCode = true;
        return line;
      }
      return translateLine(line);
    })
    .join('\n');
}
