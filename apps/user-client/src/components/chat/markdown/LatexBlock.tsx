// SPDX-License-Identifier: AGPL-3.0-only
import katex from 'katex';
import { stripMathDelimiters } from '../../../lib/markdown/preprocess-math.js';

/** Renders a ```latex / ```tex fence as KaTeX display maths. LLMs often wrap
 *  the body in delimiters inside the fence, so we strip them first. */
export function LatexBlock({ code }: { code: string }): JSX.Element {
  const expression = stripMathDelimiters(code);
  // katex.renderToString with throwOnError: false produces its own error HTML
  // (red source display) rather than throwing — no try/catch needed.
  const html = katex.renderToString(expression, { displayMode: true, throwOnError: false });

  // nosec: katex.renderToString produces sanitised library output, not user-controlled HTML
  return (
    // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX output is library-generated, not user HTML
    <div className="my-2 overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
