// SPDX-License-Identifier: AGPL-3.0-only
import { fsError } from './errors.js';

export const MAX_PATH_LENGTH = 1024;
export const MAX_SEGMENT_LENGTH = 255;

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown']);

// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the purpose
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Canonicalises an absolute project path (NFC, no `.`/`..`/empty segments) or throws. */
export function normalisePath(input: string): string {
  const nfc = input.normalize('NFC');
  if (!nfc.startsWith('/')) throw fsError('InvalidPath', { path: input, reason: 'not-absolute' });
  const stack: string[] = [];
  for (const seg of nfc.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (stack.length === 0) throw fsError('EscapesRoot', { path: input });
      stack.pop();
      continue;
    }
    stack.push(seg);
  }
  const result = `/${stack.join('/')}`;
  if (CONTROL.test(result)) {
    throw fsError('InvalidPath', { path: input, reason: 'control-character' });
  }
  if (result.length > MAX_PATH_LENGTH || stack.some((s) => s.length > MAX_SEGMENT_LENGTH)) {
    throw fsError('InvalidPath', { path: input, reason: 'too-long' });
  }
  return result;
}

function extensionOf(p: string): string | null {
  const name = basename(p);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1) : null;
}

/** Normalises a path that must name a Markdown file (not the root, `.md`/`.markdown`). */
export function normaliseFilePath(input: string): string {
  const p = normalisePath(input);
  if (p === '/') throw fsError('InvalidPath', { path: input, reason: 'root' });
  const ext = extensionOf(p);
  if (ext === null || !MARKDOWN_EXTENSIONS.has(ext.toLowerCase())) {
    throw fsError('InvalidPath', { path: input, reason: 'extension' });
  }
  return p;
}

/** Normalises a file path, appending `.md` when the final segment has no extension. */
export function withMarkdownExtension(input: string): string {
  const p = normalisePath(input);
  if (p === '/') throw fsError('InvalidPath', { path: input, reason: 'root' });
  const ext = extensionOf(p);
  if (ext === null) return normaliseFilePath(`${p}.md`);
  return normaliseFilePath(p);
}

/** Parent directory of a normalised path; the root is its own parent. */
export function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

/** Final segment of a normalised path; empty for the root. */
export function basename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

/** True when any segment of a normalised path starts with a dot. */
export function isHiddenPath(p: string): boolean {
  return p.split('/').some((s) => s.startsWith('.'));
}

/** True when `p` is a strict descendant of `dir` (never matches sibling name prefixes). */
export function isUnder(p: string, dir: string): boolean {
  const prefix = dir === '/' ? '/' : `${dir}/`;
  return p.length > prefix.length && p.startsWith(prefix);
}

/** Inclusive key range covering every descendant of `dir`, for index range queries. */
export function prefixRange(dir: string): [string, string] {
  const lo = dir === '/' ? '/' : `${dir}/`;
  return [lo, `${lo}￿`];
}
