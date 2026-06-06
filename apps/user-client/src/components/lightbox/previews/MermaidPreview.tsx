// SPDX-License-Identifier: AGPL-3.0-only
import { MermaidBlock } from '../../chat/markdown/MermaidBlock.js';

/** Renders a whole file as one Mermaid diagram, reusing the chat MermaidBlock. */
export function MermaidPreview({ content }: { content: string }): JSX.Element {
  return (
    <div className="lightbox-mermaid">
      <MermaidBlock code={content} />
    </div>
  );
}
