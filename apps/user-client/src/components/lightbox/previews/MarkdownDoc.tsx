// SPDX-License-Identifier: AGPL-3.0-only
import { MarkdownContent } from '../../chat/markdown/MarkdownContent.js';

/** Document-grade markdown view for the lightbox. Reuses the chat MarkdownContent
 *  pipeline (GFM, KaTeX, mermaid, shiki, copy/collapse on code blocks) inside the
 *  generous Aurora `.lightbox-doc` container (see index.css). */
export function MarkdownDoc({ content }: { content: string }): JSX.Element {
  return (
    <div className="lightbox-doc">
      <MarkdownContent text={content} />
    </div>
  );
}
