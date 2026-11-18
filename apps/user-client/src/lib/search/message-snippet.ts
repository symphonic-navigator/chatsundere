// SPDX-License-Identifier: AGPL-3.0-only
import type { ContentBlock } from '../../boot/client-data-db.js';
import { flattenAnswerText } from '../content-blocks.js';
import { displayPlainText } from '../teal/display-plain-text.js';
import { fold, foldWithMap } from './fold.js';

/** A cut of a message's displayed text with the query words' ranges in it. */
export type Snippet = { text: string; marks: [number, number][] };

/** Target snippet length in UTF-16 units, before word-boundary widening. */
const WINDOW = 120;
/** How far a cut may move to reach a word boundary before it falls back to a grapheme cut. */
const BOUNDARY_SLACK = 16;
/** Grapheme segmentation keeps surrogate pairs and ZWJ emoji whole when cutting. */
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const SPACE_RX = /\s/;
const LINE_BREAK_RX = /[\r\n\t]/g;

const FENCE_RX = /^\s*(```|~~~)/;
const RULE_RX = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const HEADING_RX = /^(\s{0,3})#{1,6}(?:\s+|$)/;
const HEADING_TAIL_RX = /\s+#+\s*$/;
const QUOTE_RX = /^(\s{0,3})(?:>\s?)+/;
const LIST_RX = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;
const CODE_SPAN_RX = /(`+)(.+?)\1(?!`)/g;

/** Removes inline Markdown markers from prose (no code spans in `s`). */
function stripInlineProse(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')
    .replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?![\w*])/g, '$1$2')
    .replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?!\w)/g, '$1$2');
}

/** Strips inline markers from one line, keeping the content of code spans literal. */
function stripInline(line: string): string {
  let out = '';
  let last = 0;
  for (const m of line.matchAll(CODE_SPAN_RX)) {
    const at = m.index ?? 0;
    out += stripInlineProse(line.slice(last, at)) + (m[2] ?? '');
    last = at + m[0].length;
  }
  return out + stripInlineProse(line.slice(last));
}

/** Markdown rendered away to the words the chat shows; fenced code kept, its fences dropped. */
function stripMarkdown(s: string): string {
  let fence: string | null = null;
  return s
    .split('\n')
    .map((line) => {
      const f = FENCE_RX.exec(line)?.[1];
      if (fence === null && f) {
        fence = f;
        return '';
      }
      if (fence !== null) {
        if (f === fence) fence = null;
        return f === undefined ? line : '';
      }
      if (RULE_RX.test(line)) return '';
      const body = line
        .replace(QUOTE_RX, '$1')
        .replace(HEADING_RX, '$1')
        .replace(HEADING_TAIL_RX, '')
        .replace(LIST_RX, '$1');
      return stripInline(body);
    })
    .join('\n');
}

/**
 * The text a message shows in the chat, for searching: TEAL rendered away
 * (`displayPlainText`), then Markdown syntax stripped. Reasoning and pills
 * never contribute.
 */
export function displayedText(blocks: ContentBlock[]): string {
  return stripMarkdown(displayPlainText(flattenAnswerText(blocks)));
}

/**
 * Cheap reject on the raw `text` blocks: true when every folded word occurs
 * in them. Reasoning and pills are ignored.
 */
export function rawCandidate(blocks: ContentBlock[], words: string[]): boolean {
  if (words.length === 0) return false;
  const folded = fold(flattenAnswerText(blocks));
  return words.every((w) => folded.includes(w));
}

interface Hit {
  start: number;
  end: number;
  word: number;
}

/** Grapheme boundaries of `text` as a lookup, index `text.length` included. */
function graphemeBoundaries(text: string): Uint8Array {
  const out = new Uint8Array(text.length + 1);
  for (const g of GRAPHEMES.segment(text)) out[g.index] = 1;
  out[text.length] = 1;
  return out;
}

function snapDown(b: Uint8Array, i: number): number {
  let k = i;
  while (k > 0 && b[k] !== 1) k--;
  return k;
}

function snapUp(b: Uint8Array, i: number): number {
  let k = i;
  while (k < b.length - 1 && b[k] !== 1) k++;
  return k;
}

function isSpace(ch: string | undefined): boolean {
  return ch !== undefined && SPACE_RX.test(ch);
}

/** Moves a cut start to a word start: left within the slack, else right but never past `limit`. */
function widenStart(text: string, start: number, limit: number): number {
  if (start === 0 || isSpace(text[start - 1]) || isSpace(text[start])) return start;
  const floor = Math.max(0, start - BOUNDARY_SLACK);
  for (let k = start - 1; k >= floor; k--) if (isSpace(text[k])) return k + 1;
  if (floor === 0) return 0;
  for (let k = start; k < limit; k++) if (isSpace(text[k])) return k + 1;
  return start;
}

/** Moves a cut end to a word end: right within the slack, else left but never before `limit`. */
function widenEnd(text: string, end: number, limit: number): number {
  const len = text.length;
  if (end === len || isSpace(text[end]) || isSpace(text[end - 1])) return end;
  const ceil = Math.min(len, end + BOUNDARY_SLACK);
  for (let k = end; k < ceil; k++) if (isSpace(text[k])) return k;
  if (ceil === len) return len;
  for (let k = end - 1; k >= limit; k--) if (isSpace(text[k])) return k;
  return end;
}

/**
 * Match every query word against a message's displayed text and cut a
 * snippet of about 120 characters around the region holding the most
 * distinct words (earliest on a tie). Null when a word is missing. Marks
 * are relative to the returned text, which carries `…` where it was cut.
 */
export function matchMessage(displayText: string, words: string[]): Snippet | null {
  const ws = words.filter((w) => w !== '');
  if (ws.length === 0) return null;
  const text = displayText.replace(LINE_BREAK_RX, ' ');
  const { folded, map } = foldWithMap(text);

  // An exclusive folded end maps to the start of the next code point, which
  // keeps combining marks dropped by folding inside the range; when one code
  // point folded to several units, it maps past that code point instead.
  const origEnd = (e: number): number => {
    const next = map[e] ?? text.length;
    const prev = map[e - 1];
    if (prev === undefined) return next;
    const prevEnd = prev + ((text.codePointAt(prev) ?? 0) > 0xffff ? 2 : 1);
    return Math.max(next, prevEnd);
  };

  const hits: Hit[] = [];
  for (let w = 0; w < ws.length; w++) {
    const word = ws[w] ?? '';
    let from = 0;
    let found = false;
    for (;;) {
      const at = folded.indexOf(word, from);
      if (at < 0) break;
      found = true;
      hits.push({ start: map[at] ?? 0, end: origEnd(at + word.length), word: w });
      from = at + 1;
    }
    if (!found) return null;
  }
  hits.sort((a, b) => a.start - b.start || a.end - b.end);

  const counts = new Array<number>(ws.length).fill(0);
  let distinct = 0;
  let best = { l: 0, r: 1, distinct: 0 };
  let r = 0;
  for (let l = 0; l < hits.length; l++) {
    const left = hits[l];
    if (!left) break;
    const add = (h: Hit): void => {
      if ((counts[h.word] ?? 0) === 0) distinct++;
      counts[h.word] = (counts[h.word] ?? 0) + 1;
    };
    if (r <= l) {
      add(left);
      r = l + 1;
    }
    for (let next = hits[r]; next && next.end - left.start <= WINDOW; next = hits[r]) {
      add(next);
      r++;
    }
    if (distinct > best.distinct) best = { l, r, distinct };
    counts[left.word] = (counts[left.word] ?? 1) - 1;
    if (counts[left.word] === 0) distinct--;
  }

  const chosen = hits.slice(best.l, best.r);
  const spanStart = chosen[0]?.start ?? 0;
  const spanEnd = chosen.reduce((m, h) => Math.max(m, h.end), spanStart);
  const len = text.length;
  const budget = Math.max(0, WINDOW - (spanEnd - spanStart));
  let start = Math.max(0, spanStart - Math.floor(budget / 2));
  let end = Math.min(len, spanEnd + budget - (spanStart - start));
  start = Math.max(0, Math.min(start, end - Math.max(WINDOW, spanEnd - spanStart)));

  start = widenStart(text, start, spanStart);
  end = widenEnd(text, end, spanEnd);
  const bounds = graphemeBoundaries(text);
  start = snapDown(bounds, start);
  end = snapUp(bounds, end);
  while (start < end && isSpace(text[start])) start++;
  while (end > start && isSpace(text[end - 1])) end--;

  const prefix = start > 0 ? '…' : '';
  const suffix = end < len ? '…' : '';
  const offset = prefix.length - start;

  const ranges: [number, number][] = hits
    .filter((h) => h.end > start && h.start < end)
    .map((h) => [snapDown(bounds, Math.max(h.start, start)), snapUp(bounds, Math.min(h.end, end))]);
  const marks: [number, number][] = [];
  for (const [s, e] of ranges) {
    const last = marks[marks.length - 1];
    if (last && s + offset <= last[1]) last[1] = Math.max(last[1], e + offset);
    else marks.push([s + offset, e + offset]);
  }

  return { text: prefix + text.slice(start, end) + suffix, marks };
}
