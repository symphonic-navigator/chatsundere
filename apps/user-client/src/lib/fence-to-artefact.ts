// SPDX-License-Identifier: AGPL-3.0-only
import type { ArtefactFormat } from '../boot/client-data-db.js';

export interface FenceArtefactMeta {
  format: ArtefactFormat;
  mime: string;
  /** File extension without the leading dot. */
  ext: string;
}

/** Fence language tokens whose conventional file extension differs from the
 *  token itself (or that we want to pin). Anything not listed and token-safe
 *  uses the token verbatim as its extension; otherwise it falls back to `txt`. */
const EXT_BY_LANG: Record<string, string> = {
  typescript: 'ts',
  javascript: 'js',
  python: 'py',
  rust: 'rs',
  ruby: 'rb',
  csharp: 'cs',
  golang: 'go',
  bash: 'sh',
  shell: 'sh',
  yaml: 'yml',
};

/** Map a fenced-code language token to an artefact's format, MIME, and file
 *  extension. `html` becomes a renderable HTML artefact (same hard-sandboxed
 *  preview as a generated artefact); `svg`/`mermaid` keep their structural
 *  formats; `markdown`/`md` becomes a first-class markdown artefact so the
 *  Treasury type filter and the lightbox renderer agree; everything else is
 *  generic `code`. */
export function fenceToArtefactMeta(lang: string): FenceArtefactMeta {
  const token = lang.trim().toLowerCase();
  if (token === 'html' || token === 'htm')
    return { format: 'html', mime: 'text/html', ext: 'html' };
  if (token === 'svg') return { format: 'svg', mime: 'image/svg+xml', ext: 'svg' };
  if (token === 'mermaid') return { format: 'mermaid', mime: 'text/plain', ext: 'mmd' };
  if (token === 'markdown' || token === 'md')
    return { format: 'markdown', mime: 'text/markdown', ext: 'md' };
  const ext = EXT_BY_LANG[token] ?? (/^[a-z0-9]+$/.test(token) ? token : 'txt');
  return { format: 'code', mime: 'text/plain', ext };
}
