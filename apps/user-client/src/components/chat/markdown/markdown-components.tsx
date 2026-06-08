// SPDX-License-Identifier: AGPL-3.0-only
import type { ComponentPropsWithoutRef } from 'react';
import type { Components } from 'react-markdown';
import type { Highlighter } from 'shiki';
import { CodeBlock } from './CodeBlock.js';
import { ImageMarker } from './ImageMarker.js';
import { LatexBlock } from './LatexBlock.js';
import { MermaidBlock } from './MermaidBlock.js';

/** Build the react-markdown component overrides:
 *  - `code` dispatches fenced blocks by language to the mermaid / latex / shiki
 *    renderers, and leaves inline code (and language-less fences) as a plain
 *    `<code>`.
 *  - `a` opens every link in a new tab with `rel="noopener noreferrer"` (no
 *    tab-nabbing, no referrer) and stops the click bubbling up to the message
 *    bubble's expand/collapse toggle. react-markdown's default urlTransform
 *    already strips dangerous protocols (e.g. `javascript:`).
 *  - `img` never auto-fetches: a model-emitted `![alt](url)` would otherwise
 *    beacon the user's IP to a third party on render (a tracking/exfiltration
 *    vector). ImageMarker renders a tap-to-load pill instead — see its docs. */
export function createMarkdownComponents(highlighter: Highlighter | null): Components {
  return {
    code(props: ComponentPropsWithoutRef<'code'>) {
      const { children, className, ...rest } = props;
      const langMatch = className ? /language-(\w+)/.exec(className) : null;
      const lang = langMatch?.[1];
      const codeStr = String(children).replace(/\n$/, '');

      if (!lang) {
        return (
          <code className={className} {...rest}>
            {children}
          </code>
        );
      }
      if (lang === 'mermaid') return <MermaidBlock code={codeStr} />;
      if (lang === 'latex' || lang === 'tex') return <LatexBlock code={codeStr} />;
      return <CodeBlock codeStr={codeStr} lang={lang} highlighter={highlighter} />;
    },
    a({ href, title, children }: ComponentPropsWithoutRef<'a'>) {
      return (
        <a
          href={href}
          title={title}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </a>
      );
    },
    img(props: ComponentPropsWithoutRef<'img'>) {
      return <ImageMarker {...props} />;
    },
    table(props: ComponentPropsWithoutRef<'table'>) {
      // A GFM table wider than the 380px chat column would otherwise stretch
      // the whole stream and force a page-level horizontal scrollbar. Wrap it
      // in a scroll container (same pattern as code blocks / KaTeX) so it
      // scrolls inside its own bubble instead.
      return (
        <div className="msg-table-wrap">
          <table {...props} />
        </div>
      );
    },
  };
}
