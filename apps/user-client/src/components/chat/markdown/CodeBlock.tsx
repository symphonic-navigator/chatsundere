// SPDX-License-Identifier: AGPL-3.0-only
import type { Highlighter } from 'shiki';
import { CollapsibleCode } from './CollapsibleCode.js';
import { CopyButton } from './CopyButton.js';

/** A fenced code block with a known language. Highlights via shiki when the
 *  highlighter has loaded; otherwise renders plain (and re-renders to
 *  highlighted output once shiki resolves). Wrapped in copy + collapse chrome. */
export function CodeBlock({
  codeStr,
  lang,
  highlighter,
}: {
  codeStr: string;
  lang: string;
  highlighter: Highlighter | null;
}): JSX.Element {
  if (highlighter) {
    let html: string;
    try {
      html = highlighter.codeToHtml(codeStr, { lang, theme: 'github-dark-dimmed' });
    } catch {
      const escaped = codeStr
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
      html = `<pre><code>${escaped}</code></pre>`;
    }
    return (
      <CollapsibleCode codeStr={codeStr}>
        <div className="relative">
          <CopyButton text={codeStr} />
          {/* Surface, radius, padding and glow are owned by `.msg-text pre` in
              index.css (which also overrides shiki's inline background). */}
          <div
            // biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output is library-generated, not user HTML
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </CollapsibleCode>
    );
  }

  return (
    <CollapsibleCode codeStr={codeStr}>
      <div className="relative">
        <CopyButton text={codeStr} />
        <pre>
          <code>{codeStr}</code>
        </pre>
      </div>
    </CollapsibleCode>
  );
}
