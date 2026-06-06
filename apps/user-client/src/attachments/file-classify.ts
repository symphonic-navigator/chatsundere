// SPDX-License-Identifier: AGPL-3.0-only

/** Raw-input caps, validated at the boundary (the stored/sent image is far smaller — see image-normalise.ts). */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_BYTES = 1 * 1024 * 1024;

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const TEXT_MIME_PREFIX = 'text/';
const EXTRA_TEXT_MIMES = new Set(['application/json', 'application/javascript', 'application/xml']);
const TEXT_EXTENSIONS = new Set([
  'md',
  'txt',
  'json',
  'csv',
  'ts',
  'tsx',
  'js',
  'jsx',
  'py',
  'rs',
  'go',
  'java',
  'c',
  'h',
  'cpp',
  'cs',
  'rb',
  'php',
  'sh',
  'yaml',
  'yml',
  'toml',
  'ini',
  'html',
  'css',
  'xml',
  'sql',
  'log',
  'svg',
  'mmd',
  'mermaid',
]);

export type Classification = { ok: true; kind: 'image' | 'text' } | { ok: false; reason: string };

function extension(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** Decide whether a picked/pasted/dropped file is an acceptable attachment, and its kind. */
export function classifyFile(file: File): Classification {
  if (IMAGE_MIMES.has(file.type)) {
    if (file.size > MAX_IMAGE_BYTES)
      return { ok: false, reason: `${file.name} is too large (images up to 10 MB).` };
    return { ok: true, kind: 'image' };
  }
  const isText =
    file.type.startsWith(TEXT_MIME_PREFIX) ||
    EXTRA_TEXT_MIMES.has(file.type) ||
    (file.type === '' && TEXT_EXTENSIONS.has(extension(file.name))) ||
    TEXT_EXTENSIONS.has(extension(file.name));
  if (isText) {
    if (file.size > MAX_TEXT_BYTES)
      return { ok: false, reason: `${file.name} is too large (text files up to 1 MB).` };
    return { ok: true, kind: 'text' };
  }
  return {
    ok: false,
    reason: `${file.name} is not supported yet — only images and text files for now.`,
  };
}
