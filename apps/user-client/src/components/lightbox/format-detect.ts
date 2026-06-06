// SPDX-License-Identifier: AGPL-3.0-only

/** The renderer a text attachment is shown with in the lightbox. */
export type PreviewFormat = 'markdown' | 'code' | 'html' | 'svg' | 'mermaid' | 'plain';

function ext(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** Extension → shiki language id. Mirrors the langs loaded in highlighter.ts. */
const LANG_BY_EXT: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  css: 'css',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  sql: 'sql',
  xml: 'xml',
  html: 'html',
  log: 'text',
};

const CODE_EXTS = new Set(Object.keys(LANG_BY_EXT));

/** Decide which preview renderer a text attachment uses, from its filename + MIME.
 *  Extension wins; MIME is the tiebreaker for the structural formats. */
export function detectFormat(fileName: string, mime: string): PreviewFormat {
  const e = ext(fileName);
  if (e === 'md' || e === 'markdown' || mime === 'text/markdown') return 'markdown';
  if (e === 'svg' || mime === 'image/svg+xml') return 'svg';
  if (e === 'html' || e === 'htm' || mime === 'text/html') return 'html';
  if (e === 'mmd' || e === 'mermaid') return 'mermaid';
  if (CODE_EXTS.has(e)) return 'code';
  return 'plain';
}

/** Extension → shiki language id, defaulting to 'text'. */
export function extensionToLang(fileName: string): string {
  return LANG_BY_EXT[ext(fileName)] ?? 'text';
}

const DEFAULT_EXT: Record<PreviewFormat, string> = {
  markdown: 'md',
  code: 'txt',
  html: 'html',
  svg: 'svg',
  mermaid: 'mmd',
  plain: 'txt',
};

/** A download filename: keep the existing extension, else append a format default. */
export function formatToExtension(fileName: string, format: PreviewFormat): string {
  return ext(fileName) ? fileName : `${fileName}.${DEFAULT_EXT[format]}`;
}
