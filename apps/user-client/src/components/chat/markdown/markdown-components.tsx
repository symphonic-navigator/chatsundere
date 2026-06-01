// SPDX-License-Identifier: AGPL-3.0-only
import type { ComponentPropsWithoutRef } from 'react';
import type { Components } from 'react-markdown';
import type { Highlighter } from 'shiki';
import { CodeBlock } from './CodeBlock.js';
import { LatexBlock } from './LatexBlock.js';
import { MermaidBlock } from './MermaidBlock.js';

/** Build the react-markdown component overrides:
 *  - `code` dispatches fenced blocks by language to the mermaid / latex / shiki
 *    renderers, and leaves inline code (and language-less fences) as a plain
 *    `<code>`.
 *  - `a` opens every link in a new tab with `rel="noopener noreferrer"` (no
 *    tab-nabbing, no referrer) and stops the click bubbling up to the message
 *    bubble's expand/collapse toggle. react-markdown's default urlTransform
 *    already strips dangerous protocols (e.g. `javascript:`). */
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
  };
}
