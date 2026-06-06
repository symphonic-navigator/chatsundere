// SPDX-License-Identifier: AGPL-3.0-only
import { useHighlighter } from '../../../lib/markdown/highlighter.js';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Renders a whole code file with shiki syntax highlighting. Unlike CodeBlock
 *  there is no copy/collapse chrome — the lightbox provides its own controls
 *  and the full file scrolls freely inside `.lightbox-code`. */
export function CodePreview({ content, lang }: { content: string; lang: string }): JSX.Element {
  const highlighter = useHighlighter();
  let html: string;
  if (highlighter) {
    try {
      html = highlighter.codeToHtml(content, { lang, theme: 'github-dark-dimmed' });
    } catch {
      html = `<pre><code>${escapeHtml(content)}</code></pre>`;
    }
  } else {
    html = `<pre><code>${escapeHtml(content)}</code></pre>`;
  }
  return (
    <div className="lightbox-code">
      <div
        // biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output is library-generated, not user HTML
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
