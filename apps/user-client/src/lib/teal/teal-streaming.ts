// SPDX-License-Identifier: AGPL-3.0-only
import { resolveTealInline, resolveTealWrap } from './teal-render-map.js';

/**
 * TEAL transform for the LIVE streaming path. MessageBlock renders streaming
 * drafts as raw per-chunk spans (no Markdown), so without this transform tags
 * would flash raw mid-stream. A sequential state machine walks the chunks:
 *
 *   - complete known inline tags are replaced (emoji/typography/silent);
 *   - known wrapping tags toggle active classes carried onto later spans;
 *   - a possibly-incomplete tag at a chunk boundary is carried into the next
 *     chunk; at the very stream tip it is suppressed (no raw flash) — the
 *     finalised Markdown pass settles the text either way;
 *   - fenced code (``` at line start) and inline code spans pass through
 *     untransformed, mirroring the finalised pipeline's code immunity;
 *   - unknown tags stay literal (closed vocabulary).
 *
 * Determinism guarantee: output for chunk N depends only on chunks 0..N, so
 * already-rendered spans never change when new chunks append (stable
 * React keys, no re-fade).
 */
export interface TealStreamSpan {
  text: string;
  classNames: string[];
}

/** Max content length accepted inside a TEAL bracket tag (mirrors preprocess-teal's TAG_CANDIDATE). */
const MAX_TAG_CONTENT = 38;
/** Longest fragment we still treat as a possibly-incomplete tag at a boundary: '[' (1) + content, no ']' yet. */
const MAX_CANDIDATE = MAX_TAG_CONTENT + 1;
// The (?!\() lookahead mirrors preprocess-teal's Markdown-link guard. It only
// helps when `](` arrives within one chunk — a tag completed at the stream tip
// cannot see a later `(` — but that covers the common single-token link case.
const INLINE_RX = new RegExp(`^\\[([A-Za-z][A-Za-z\\- ]{0,${MAX_TAG_CONTENT}})\\](?!\\()`);
const WRAP_RX = /^<(\/?)([a-z-]+)>/;
const INLINE_PARTIAL_RX = /^\[[A-Za-z\- ]*$/;
const WRAP_PARTIAL_RX = /^<\/?[a-z-]*$/;

export function transformTealStream(chunks: string[]): TealStreamSpan[][] {
  const result: TealStreamSpan[][] = [];
  const active: string[] = [];
  let carry = ''; // unfinished tag candidate from the previous chunk
  let inFence = false; // inside a ``` fenced block
  let inCode = false; // inside an `inline code` span
  let atLineStart = true;

  for (let c = 0; c < chunks.length; c++) {
    const isLast = c === chunks.length - 1;
    const text = carry + (chunks[c] ?? '');
    carry = '';
    const spans: TealStreamSpan[] = [];
    let plain = '';
    let plainClasses = '';

    // A new span starts only when the effective class set CHANGES — code
    // regions and unstyled text therefore stay one span, and wrap toggles
    // split exactly where the styling changes.
    const effective = (): string => (inFence || inCode ? '' : [...new Set(active)].join(' '));
    const append = (s: string): void => {
      if (s.length === 0) return;
      const cls = effective();
      if (cls !== plainClasses && plain.length > 0) {
        spans.push({ text: plain, classNames: plainClasses === '' ? [] : plainClasses.split(' ') });
        plain = '';
      }
      plainClasses = cls;
      plain += s;
    };

    let i = 0;
    while (i < text.length) {
      const ch = text[i] ?? '';

      // --- code-region tracking (mirrors the finalised pipeline's immunity)
      // TODO(teal): after a cross-boundary tag carry, atLineStart can be stale for a
      // fence that opens at the exact first byte of the next chunk — accepted for the
      // transient streaming view; the finalised Markdown pass renders correctly.
      if (ch === '`' && atLineStart && text.startsWith('```', i)) {
        inFence = !inFence;
        append('```');
        i += 3;
        atLineStart = false;
        continue;
      }
      if (ch === '`' && !inFence) {
        inCode = !inCode;
        append('`');
        i += 1;
        atLineStart = false;
        continue;
      }
      if (inFence || inCode) {
        append(ch);
        atLineStart = ch === '\n';
        i += 1;
        continue;
      }

      // --- tag candidates
      if (ch === '[' || ch === '<') {
        const rest = text.slice(i);
        const m = (ch === '[' ? INLINE_RX : WRAP_RX).exec(rest);
        if (m !== null) {
          if (ch === '[') {
            const action = resolveTealInline(m[1] ?? '');
            if (action === null) append(m[0] ?? '');
            else if (action.kind === 'emoji' || action.kind === 'text') append(action.value);
            // silent: nothing
          } else {
            const action = resolveTealWrap(m[2] ?? '');
            if (action === null) append(m[0] ?? '');
            else if (action.kind === 'wrap') {
              if (m[1] === '/') {
                const idx = active.lastIndexOf(action.className);
                if (idx >= 0) active.splice(idx, 1);
              } else {
                active.push(action.className);
              }
            }
            // silent: tags vanish, text continues unstyled
          }
          i += (m[0] ?? '').length;
          atLineStart = false;
          continue;
        }
        // No complete tag — possibly incomplete at the end of this text?
        const partialRx = ch === '[' ? INLINE_PARTIAL_RX : WRAP_PARTIAL_RX;
        if (rest.length <= MAX_CANDIDATE && partialRx.test(rest)) {
          if (!isLast) carry = rest; // complete it with the next chunk
          // last chunk: stream tip — suppress the half-typed tag (no raw flash)
          break;
        }
        // Provably not a tag: emit literally.
        append(ch);
        atLineStart = false;
        i += 1;
        continue;
      }

      append(ch);
      atLineStart = ch === '\n';
      i += 1;
    }

    if (plain.length > 0) {
      spans.push({ text: plain, classNames: plainClasses === '' ? [] : plainClasses.split(' ') });
    }
    result.push(spans);
  }
  return result;
}
