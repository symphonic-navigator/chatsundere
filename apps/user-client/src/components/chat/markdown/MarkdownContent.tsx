// SPDX-License-Identifier: AGPL-3.0-only
import 'katex/dist/katex.min.css';
import { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { PluggableList } from 'unified';
import { useHighlighter } from '../../../lib/markdown/highlighter.js';
import { preprocessMath } from '../../../lib/markdown/preprocess-math.js';
import { preprocessTeal } from '../../../lib/teal/preprocess-teal.js';
import { rehypeTeal } from '../../../lib/teal/rehype-teal.js';
import { createMarkdownComponents } from './markdown-components.js';

const remarkPlugins: PluggableList = [remarkGfm, remarkMath];
// rehypeTeal runs after rehype-katex so maths output is never re-walked for TEAL markers.
const rehypePlugins: PluggableList = [[rehypeKatex, { throwOnError: false }], rehypeTeal];

function MarkdownContentBase({ text }: { text: string }): JSX.Element {
  const highlighter = useHighlighter();
  const components = useMemo(() => createMarkdownComponents(highlighter), [highlighter]);
  // preprocessTeal before preprocessMath — both mask code fences; either order is otherwise safe.
  const processed = useMemo(() => preprocessMath(preprocessTeal(text)), [text]);
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {processed}
    </ReactMarkdown>
  );
}

/**
 * Memoised so that, during streaming, only the active bubble's MarkdownContent
 * re-parses on each token — historical messages (same `text`) skip the whole
 * remark / rehype / shiki pipeline. Default shallow comparison on the single
 * string prop is exactly the value comparison we want.
 */
export const MarkdownContent = memo(MarkdownContentBase);
