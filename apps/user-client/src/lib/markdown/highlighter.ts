// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { type Highlighter, createHighlighter } from 'shiki';

let highlighterPromise: Promise<Highlighter> | null = null;
let cachedHighlighter: Highlighter | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (cachedHighlighter) return Promise.resolve(cachedHighlighter);
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['github-dark-dimmed'],
      langs: [
        'javascript',
        'typescript',
        'python',
        'bash',
        'json',
        'html',
        'css',
        'markdown',
        'yaml',
        'toml',
        'sql',
        'rust',
        'go',
        'java',
        'csharp',
        'xml',
        'dockerfile',
        'shell',
      ],
    }).then((h) => {
      cachedHighlighter = h;
      return h;
    });
  }
  return highlighterPromise;
}

/** Subscribe to the lazily-created shiki singleton. Returns `null` until the
 *  highlighter has finished loading, then the shared instance. */
export function useHighlighter(): Highlighter | null {
  const [highlighter, setHighlighter] = useState<Highlighter | null>(cachedHighlighter);

  useEffect(() => {
    // State was already seeded with cachedHighlighter by the useState initialiser;
    // if it is set there is nothing to do.
    if (cachedHighlighter) return;
    let cancelled = false;
    getHighlighter().then((h) => {
      if (!cancelled) setHighlighter(h);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return highlighter;
}
