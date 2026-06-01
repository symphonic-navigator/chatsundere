# Rich Message Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render assistant/user message text as full Markdown + LaTeX maths + syntax-highlighted code (chatsune parity), replacing the current verbatim-text renderer in `apps/user-client`.

**Architecture:** Markdown is rendered only over the `text` groups inside `MessageBlock`'s existing `renderBlocks()`; `pill` and `reasoning` blocks are untouched. A new memoised `MarkdownContent` component wraps `react-markdown` with `remark-gfm` + `remark-math` + `rehype-katex`, a ported `preprocessMath()` LaTeX-compatibility pre-pass, a lazy `shiki` highlighter, and lazy `mermaid`. The per-token `fade-in` animation is removed (incompatible with re-parsing) in favour of the existing whole-bubble entrance animation.

**Tech Stack:** TypeScript (strict), React 18, Vite 6, Vitest, Tailwind v4. New: `react-markdown@10`, `remark-gfm`, `remark-math`, `rehype-katex`, `katex`, `shiki@4`, `mermaid`.

---

## Conventions (apply to EVERY new file)

- First line of every source/test file: `// SPDX-License-Identifier: AGPL-3.0-only`
- Imports of local modules carry a `.js` extension (NodeNext style), e.g. `import { x } from './y.js'`.
- Components: PascalCase filenames, named exports. `lib/` modules: kebab-case filenames.
- Comments and all strings in British English.
- Tests live under `apps/user-client/tests/`, mirroring `src/`, importing source via relative `../../../src/...*.js` paths.

## Commands (run from repo root)

- Single test file: `pnpm --filter @chatsundere/user-client exec vitest run <path>`
- Single test by name: append `-t "<name fragment>"`
- Full package tests: `pnpm --filter @chatsundere/user-client test`
- Typecheck (CI gate): `pnpm --filter @chatsundere/user-client typecheck`
- Build: `pnpm --filter @chatsundere/user-client build`

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/markdown/preprocess-math.ts` | Pure `preprocessMath()` + `stripMathDelimiters()` (LaTeX compatibility) |
| `src/lib/markdown/highlighter.ts` | Lazy shiki singleton: `getHighlighter()`, `useHighlighter()` |
| `src/components/chat/markdown/CopyButton.tsx` | Per-code-block copy button |
| `src/components/chat/markdown/CollapsibleCode.tsx` | Collapse code blocks > 15 lines |
| `src/components/chat/markdown/LatexBlock.tsx` | `latex`/`tex` fence → KaTeX display |
| `src/components/chat/markdown/MermaidBlock.tsx` | `mermaid` fence → lazy mermaid diagram |
| `src/components/chat/markdown/CodeBlock.tsx` | shiki-highlighted code + copy + collapse |
| `src/components/chat/markdown/markdown-components.tsx` | `createMarkdownComponents(highlighter)` — `code` dispatch |
| `src/components/chat/markdown/MarkdownContent.tsx` | Memoised `react-markdown` wrapper (+ KaTeX CSS import) |
| `src/components/chat/MessageBlock.tsx` | **Modify** — text group renders `<MarkdownContent>`, drop `token-fade` |
| `src/index.css` | **Modify** — remove dead `.token-fade` rules |
| `tests/lib/markdown/preprocess-math.test.ts` | Focused unit tests for the pure functions |
| `tests/lib/markdown/latex-rendering.diagnostic.test.ts` | Ported 45-case diagnostic over the real pipeline |

---

## Task 1: Add dependencies

**Files:**
- Modify: `apps/user-client/package.json`

- [ ] **Step 1: Add runtime + dev dependencies**

Run (from repo root):

```bash
pnpm --filter @chatsundere/user-client add \
  react-markdown@^10.1.0 remark-gfm@^4.0.1 remark-math@^6.0.0 \
  rehype-katex@^7.0.1 katex@^0.16.45 shiki@^4.0.2 mermaid

pnpm --filter @chatsundere/user-client add -D \
  @types/katex unified@^11.0.5 remark-parse@^11.0.0 \
  remark-rehype@^11.1.2 rehype-stringify@^10.0.1
```

(The five dev deps are required only by the diagnostic test in Task 2, which drives the real unified pipeline directly. `mermaid` ships its own types; `shiki` and `react-markdown` ship types.)

- [ ] **Step 2: Verify install resolved**

Run: `pnpm --filter @chatsundere/user-client exec vitest --version`
Expected: prints a vitest version (confirms the workspace still resolves after install).

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/package.json pnpm-lock.yaml
git commit -m "Add markdown/katex/shiki/mermaid deps to user-client"
```

---

## Task 2: `preprocess-math.ts` — the LaTeX compatibility pre-pass

This is the highest-value port. Write focused unit tests first, implement verbatim from chatsune, then add the comprehensive diagnostic.

**Files:**
- Create: `apps/user-client/src/lib/markdown/preprocess-math.ts`
- Test: `apps/user-client/tests/lib/markdown/preprocess-math.test.ts`
- Test: `apps/user-client/tests/lib/markdown/latex-rendering.diagnostic.test.ts`

- [ ] **Step 1: Write the failing focused unit tests**

Create `apps/user-client/tests/lib/markdown/preprocess-math.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { preprocessMath, stripMathDelimiters } from '../../../src/lib/markdown/preprocess-math.js';

describe('preprocessMath', () => {
  it('converts inline \\( \\) to $ $ and trims inner whitespace', () => {
    expect(preprocessMath(String.raw`a \( x + 1 \) b`)).toBe('a $x + 1$ b');
  });

  it('converts single-line \\[ \\] to compact $$ $$', () => {
    expect(preprocessMath(String.raw`\[ a^2 \]`)).toBe('$$a^2$$');
  });

  it('converts multi-line \\[ \\] to a blank-line-fenced block', () => {
    const src = '\\[\na &= b \\\\\nc &= d\n\\]';
    expect(preprocessMath(src)).toBe('\n\n$$\na &= b \\\\\nc &= d\n$$\n\n');
  });

  it('does not rewrite maths-like text inside an inline code span', () => {
    const src = 'see `\\(E=mc^2\\)` here';
    expect(preprocessMath(src)).toBe('see `\\(E=mc^2\\)` here');
  });

  it('does not rewrite maths inside a fenced code block', () => {
    const src = '```\n\\[E=mc^2\\]\n```';
    expect(preprocessMath(src)).toBe(src);
  });

  it('does not treat \\\\[5pt] line-break spacing as display math', () => {
    const src = 'a &= b \\\\[5pt]\nc &= d';
    // The \[ rule must not fire on the bracket of \\[5pt].
    expect(preprocessMath(src)).toBe(src);
  });
});

describe('stripMathDelimiters', () => {
  it.each([
    ['$$x$$', 'x'],
    ['\\[x\\]', 'x'],
    ['\\(x\\)', 'x'],
    ['$x$', 'x'],
    ['  x  ', 'x'],
  ])('strips %s to %s', (input, expected) => {
    expect(stripMathDelimiters(input)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/lib/markdown/preprocess-math.test.ts`
Expected: FAIL — cannot resolve `../../../src/lib/markdown/preprocess-math.js`.

- [ ] **Step 3: Implement `preprocess-math.ts` (verbatim port)**

Create `apps/user-client/src/lib/markdown/preprocess-math.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Preprocess markdown to normalise math delimiters that remark-math does not
 * handle natively:
 *   \( ... \)  →  $ ... $    (inline)
 *   \[ ... \]  →  $$ ... $$  (display)
 *
 * Runs before the string reaches ReactMarkdown so remark-math can parse them.
 *
 * Three concerns drive the implementation:
 *
 *   1. Multiline display math. micromark-extension-math only recognises
 *      `$$...$$` as a display fence when both `$$` markers stand at a line
 *      boundary; otherwise it falls back to inline-math parsing, which forbids
 *      newlines inside the content. So when the inner content of `\[...\]`
 *      contains a newline (matrices, aligned, cases, multi-line expressions)
 *      we emit a proper block fence with surrounding blank lines:
 *           \n\n$$\n<content>\n$$\n\n
 *      Single-line content keeps the compact `$$<content>$$` form so it still
 *      flows correctly inside list items, blockquotes, etc.
 *
 *   2. Code spans / code fences. The regex must not rewrite math syntax that
 *      a user typed inside a code span — that would silently corrupt their
 *      text. We mask code regions with a sentinel placeholder before the
 *      math substitutions run, then restore them afterwards.
 *
 *   3. `\\[Npt]` line-break-with-spacing inside aligned environments. The
 *      `\[` regex must not match the `[` of `\\[5pt]`. A negative-look-behind
 *      on `\` prevents the false match.
 */
export function preprocessMath(src: string): string {
  // Step 1 — mask code spans and fenced code blocks with a sentinel that the
  // math regexes will never match. NUL is safe because it is not allowed in
  // valid Markdown / HTML text.
  const masks: string[] = [];
  const mask = (m: string): string => {
    const i = masks.length;
    masks.push(m);
    return ` CODE${i} `;
  };
  let out = src
    // Fenced code blocks with ``` or ~~~ (anchored to a line boundary).
    .replace(
      /(^|\n)(```[\s\S]*?\n```|~~~[\s\S]*?\n~~~)/g,
      (_m, lead: string, fence: string) => `${lead}${mask(fence)}`,
    )
    // Inline code with one or more backticks — `\1` ensures matched fence
    // length on both sides.
    .replace(/(`+)([\s\S]*?)\1/g, (m) => mask(m));

  // Step 2 — \[ ... \] → display math. Negative-look-behind on `\` prevents
  // \\[Npt] (LaTeX line-break with optional spacing) from matching.
  out = out.replace(/(?<!\\)\\\[([\s\S]*?)\\\]/g, (_m, inner: string) => {
    const trimmed = inner.trim();
    if (trimmed.includes('\n')) {
      return `\n\n$$\n${trimmed}\n$$\n\n`;
    }
    return `$$${trimmed}$$`;
  });

  // Step 3 — \( ... \) → inline math. Inner must be trimmed: remark-math v6
  // rejects inline math that starts or ends with whitespace (anti-currency
  // heuristic), so `$ x $` would not be recognised.
  out = out.replace(/(?<!\\)\\\(([\s\S]+?)\\\)/g, (_m, inner: string) => `$${inner.trim()}$`);

  // Step 4 — restore the masked code regions.
  out = out.replace(/ CODE(\d+) /g, (_m, idx: string) => masks[Number(idx)] ?? '');

  return out;
}

/**
 * Strip outer math delimiters that LLMs often include inside a ```latex fence:
 *   $$ ... $$   →   ...
 *   \[ ... \]   →   ...
 *   \( ... \)   →   ...
 *   $ ... $     →   ...
 * KaTeX expects the raw expression without delimiters.
 */
export function stripMathDelimiters(src: string): string {
  const trimmed = src.trim();
  const pairs: Array<[string, string]> = [
    ['$$', '$$'],
    ['\\[', '\\]'],
    ['\\(', '\\)'],
    ['$', '$'],
  ];
  for (const [open, close] of pairs) {
    if (
      trimmed.startsWith(open) &&
      trimmed.endsWith(close) &&
      trimmed.length >= open.length + close.length
    ) {
      return trimmed.slice(open.length, trimmed.length - close.length).trim();
    }
  }
  return trimmed;
}
```

Note: the `?? ''` on the mask restore differs from chatsune (which indexes directly) — required here because chatsundere enables `noUncheckedIndexedAccess`.

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/lib/markdown/preprocess-math.test.ts`
Expected: PASS — 11 tests (6 preprocessMath + 5 stripMathDelimiters).

- [ ] **Step 5: Add the ported diagnostic test**

Create `apps/user-client/tests/lib/markdown/latex-rendering.diagnostic.test.ts` by copying the full file from
`/home/chris/workspace/chatsune/frontend/src/features/chat/__tests__/latexRendering.diagnostic.test.ts`
verbatim, with exactly two changes:

1. Prepend `// SPDX-License-Identifier: AGPL-3.0-only` as the first line.
2. Change the `preprocessMath` import line from
   `import { preprocessMath } from '../markdownComponents'`
   to
   `import { preprocessMath } from '../../../src/lib/markdown/preprocess-math.js';`

Leave every test case, the `render()` helper, `MUST_PASS_IDS`, and the three "Fix" tests unchanged.

- [ ] **Step 6: Run the diagnostic to verify it passes**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/lib/markdown/latex-rendering.diagnostic.test.ts`
Expected: PASS — all 48 `it.each` rows plus the 3 fix tests. (The `MUST_PASS_IDS` rows assert real KaTeX nodes with zero errors; the rest assert no-throw.)

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/lib/markdown/preprocess-math.ts \
  apps/user-client/tests/lib/markdown/
git commit -m "Port LaTeX preprocessMath compatibility layer with diagnostics"
```

---

## Task 3: `highlighter.ts` — lazy shiki singleton

**Files:**
- Create: `apps/user-client/src/lib/markdown/highlighter.ts`

- [ ] **Step 1: Implement the highlighter module (verbatim port)**

Create `apps/user-client/src/lib/markdown/highlighter.ts`:

```ts
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
        'javascript', 'typescript', 'python', 'bash', 'json', 'html', 'css',
        'markdown', 'yaml', 'toml', 'sql', 'rust', 'go', 'java', 'csharp',
        'xml', 'dockerfile', 'shell',
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
    if (cachedHighlighter) {
      setHighlighter(cachedHighlighter);
      return;
    }
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
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @chatsundere/user-client typecheck`
Expected: PASS (no errors). Confirms shiki types resolve.

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/lib/markdown/highlighter.ts
git commit -m "Add lazy shiki highlighter singleton"
```

---

## Task 4: Code-block chrome — `CopyButton` and `CollapsibleCode`

Styling is functional only (neutral utilities) — Chris applies the opulent palette in a later pass.

**Files:**
- Create: `apps/user-client/src/components/chat/markdown/CopyButton.tsx`
- Create: `apps/user-client/src/components/chat/markdown/CollapsibleCode.tsx`

- [ ] **Step 1: Implement `CopyButton.tsx`**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useRef, useState } from 'react';

/** Copy-to-clipboard button overlaid on a code block; shows "Copied" for
 *  1.5 s after a successful copy. Functional styling only — restyled later. */
export function CopyButton({ text }: { text: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(false), 1500);
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="absolute right-2 top-2 z-10 rounded border border-black/10 bg-black/5 px-2 py-0.5 font-mono text-[11px] text-black/50 transition-colors hover:bg-black/10"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
```

- [ ] **Step 2: Implement `CollapsibleCode.tsx`**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';

const COLLAPSE_LINE_THRESHOLD = 15;

/** Wraps a code block; if it exceeds the line threshold it starts collapsed
 *  behind a fade with an "N lines — expand" control. Functional styling only. */
export function CollapsibleCode({
  codeStr,
  children,
}: {
  codeStr: string;
  children: React.ReactNode;
}): JSX.Element {
  const lineCount = codeStr.split('\n').length;
  const [expanded, setExpanded] = useState(lineCount <= COLLAPSE_LINE_THRESHOLD);
  const isCollapsible = lineCount > COLLAPSE_LINE_THRESHOLD;

  if (!isCollapsible) return <>{children}</>;

  if (!expanded) {
    return (
      <div className="relative max-h-[240px] overflow-hidden">
        {children}
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/10 to-transparent" />
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-black/10 bg-black/5 px-3 py-1 font-mono text-[11px] text-black/50 transition-colors hover:bg-black/10"
        >
          {lineCount} lines — expand
        </button>
      </div>
    );
  }

  return (
    <>
      {children}
      <button
        type="button"
        onClick={() => setExpanded(false)}
        className="mt-1 w-full rounded-b-lg border border-black/5 bg-black/[0.02] py-1 font-mono text-[11px] text-black/30 transition-colors hover:text-black/50"
      >
        Collapse
      </button>
    </>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @chatsundere/user-client typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/components/chat/markdown/CopyButton.tsx \
  apps/user-client/src/components/chat/markdown/CollapsibleCode.tsx
git commit -m "Add code-block copy button and collapsible wrapper"
```

---

## Task 5: `LatexBlock` and `MermaidBlock`

**Files:**
- Create: `apps/user-client/src/components/chat/markdown/LatexBlock.tsx`
- Create: `apps/user-client/src/components/chat/markdown/MermaidBlock.tsx`

- [ ] **Step 1: Implement `LatexBlock.tsx`**

```tsx
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
```

- [ ] **Step 2: Implement `MermaidBlock.tsx`**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';

let mermaidPromise: Promise<typeof import('mermaid')> | null = null;
function loadMermaid(): Promise<typeof import('mermaid')> {
  if (!mermaidPromise) mermaidPromise = import('mermaid');
  return mermaidPromise;
}

/** Renders a ```mermaid fence as an SVG diagram via a lazily-imported mermaid.
 *  Falls back to showing the raw source on a render error. Theme is a
 *  functional default ('dark') — restyled in Chris's styling pass. */
export function MermaidBlock({ code }: { code: string }): JSX.Element {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMermaid().then((mod) => {
      if (cancelled) return;
      const mermaid = mod.default;
      mermaid.initialize({ startOnLoad: false, theme: 'dark' });
      const id = `mermaid-inline-${Math.random().toString(36).slice(2)}`;
      mermaid
        .render(id, code)
        .then(({ svg: rendered }) => {
          if (!cancelled) {
            setSvg(rendered);
            setError(null);
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : 'Failed to render diagram');
          }
        });
    });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return (
      <div className="relative" title={error}>
        <pre className="overflow-x-auto rounded-lg bg-black/5 p-4 text-[13px] border border-amber-500/20">
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="flex items-center justify-center rounded-lg bg-black/5 p-8">
        <span className="text-[12px] text-black/30 font-mono">Rendering diagram...</span>
      </div>
    );
  }

  // Mermaid render() output is sanitised via its built-in DOMPurify integration.
  return (
    // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid output is sanitised internally via DOMPurify
    <div
      className="my-2 flex justify-center overflow-x-auto rounded-lg bg-black/5 p-4 [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @chatsundere/user-client typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/components/chat/markdown/LatexBlock.tsx \
  apps/user-client/src/components/chat/markdown/MermaidBlock.tsx
git commit -m "Add latex and mermaid fence renderers"
```

---

## Task 6: `CodeBlock` — shiki-highlighted code

**Files:**
- Create: `apps/user-client/src/components/chat/markdown/CodeBlock.tsx`

- [ ] **Step 1: Implement `CodeBlock.tsx`**

```tsx
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
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output is library-generated, not user HTML */}
          <div
            className="overflow-x-auto rounded-lg text-[13px] [&_pre]:p-4"
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
        <pre className="overflow-x-auto rounded-lg bg-black/5 p-4 text-[13px] font-mono">
          <code>{codeStr}</code>
        </pre>
      </div>
    </CollapsibleCode>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @chatsundere/user-client typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/components/chat/markdown/CodeBlock.tsx
git commit -m "Add shiki-highlighted code block component"
```

---

## Task 7: `markdown-components.tsx` — the `code` dispatch

**Files:**
- Create: `apps/user-client/src/components/chat/markdown/markdown-components.tsx`

- [ ] **Step 1: Implement `markdown-components.tsx`**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import type { ComponentPropsWithoutRef } from 'react';
import type { Components } from 'react-markdown';
import type { Highlighter } from 'shiki';
import { CodeBlock } from './CodeBlock.js';
import { LatexBlock } from './LatexBlock.js';
import { MermaidBlock } from './MermaidBlock.js';

/** Build the react-markdown component overrides. The `code` override is the
 *  only one we customise: it dispatches fenced blocks by language to the
 *  mermaid / latex / shiki renderers, and leaves inline code (and
 *  language-less fences) as a plain `<code>`. */
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
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @chatsundere/user-client typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/components/chat/markdown/markdown-components.tsx
git commit -m "Add markdown code-component dispatch"
```

---

## Task 8: `MarkdownContent.tsx` — memoised react-markdown wrapper

**Files:**
- Create: `apps/user-client/src/components/chat/markdown/MarkdownContent.tsx`

- [ ] **Step 1: Implement `MarkdownContent.tsx`**

```tsx
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
import { createMarkdownComponents } from './markdown-components.js';

const remarkPlugins: PluggableList = [remarkGfm, remarkMath];
const rehypePlugins: PluggableList = [[rehypeKatex, { throwOnError: false }]];

function MarkdownContentBase({ text }: { text: string }): JSX.Element {
  const highlighter = useHighlighter();
  const components = useMemo(() => createMarkdownComponents(highlighter), [highlighter]);
  const processed = useMemo(() => preprocessMath(text), [text]);
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
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
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @chatsundere/user-client typecheck`
Expected: PASS. (Confirms `PluggableList`, `Components`, and the plugin tuple type-check.)

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/components/chat/markdown/MarkdownContent.tsx
git commit -m "Add memoised MarkdownContent react-markdown wrapper"
```

---

## Task 9: Integrate into `MessageBlock` and remove `token-fade`

**Files:**
- Modify: `apps/user-client/src/components/chat/MessageBlock.tsx`
- Modify: `apps/user-client/src/index.css`

- [ ] **Step 1: Replace the text-group rendering in `renderBlocks()`**

In `apps/user-client/src/components/chat/MessageBlock.tsx`, replace the `if (group.type === 'text')` branch (currently lines 137–152, the nested `<span>` mapping) with a single `MarkdownContent` over the concatenated text of the group:

```tsx
    if (group.type === 'text') {
      const text = group.blocks
        .map((b) => (b as { type: 'text'; text: string }).text)
        .join('');
      // biome-ignore lint/suspicious/noArrayIndexKey: group ordering is stable across token appends (append-only)
      return <MarkdownContent key={`g-${idx}`} text={text} />;
    }
```

- [ ] **Step 2: Remove the now-dead `token-fade` plumbing**

In the same file:
- Delete the `const textClass = isStreamingDraft ? 'token-fade' : undefined;` line and its preceding comment block (currently lines 127–131).
- Add the import near the other component imports (after the `ReasoningPill` import):
  ```tsx
  import { MarkdownContent } from './markdown/MarkdownContent.js';
  ```
- Update the `isStreamingDraft` JSDoc on `MessageBlockProps` (currently lines 26–29) to:
  ```tsx
    /** True while this message is the active streaming draft. Used to mark the
     *  last reasoning group as live; text now renders via MarkdownContent which
     *  re-parses as tokens arrive (no per-token fade). */
    isStreamingDraft?: boolean;
  ```

`isStreamingDraft` is still consumed by the reasoning-group `lastReasoningIdx` logic and passed to `ReasoningPill`, so the prop stays — only the text-path use is removed.

- [ ] **Step 3: Remove dead CSS**

In `apps/user-client/src/index.css`, delete the `.msg-text .token-fade` rule, the `@keyframes token-fade-in` block, and the reduced-motion `.msg-text .token-fade` override (the block around lines 829–855, including the leading comment describing per-chunk spans). Leave the rest of `.msg-text` intact.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @chatsundere/user-client typecheck`
Expected: PASS.

- [ ] **Step 5: Run the existing MessageBlock / ChatStream tests**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/components/chat/`
Expected: PASS. If a test asserted on `.token-fade` spans or on raw text spans inside `.msg-text`, update that assertion to match the new MarkdownContent output (markdown renders text inside a `<p>`); note any such change in the commit message.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/chat/MessageBlock.tsx apps/user-client/src/index.css
git commit -m "Render message text via MarkdownContent; drop per-token fade"
```

---

## Task 10: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck (CI gate)**

Run: `pnpm --filter @chatsundere/user-client typecheck`
Expected: PASS, no errors.

- [ ] **Step 2: Full test run**

Run: `pnpm --filter @chatsundere/user-client test`
Expected: PASS, including the new preprocess-math and diagnostic suites.

- [ ] **Step 3: Production build**

Run: `pnpm --filter @chatsundere/user-client build`
Expected: build succeeds. Confirm in the Vite output that `shiki` and `mermaid` appear as separate lazy chunks (not folded into the main entry) — they are dynamically imported.

- [ ] **Step 4: Manual verification (Chris, on-device)**

Hand off the spec's Manual Verification checklist
(`superpowers/specs/2026-06-01-message-rendering-design.md`): GFM table/lists/strikethrough; inline + display maths; maths-in-code rendered literally; highlighted + collapsible + copyable code; mermaid and latex fences; live streaming with no per-token flash; whole-message copy yields raw Markdown.

---

## Self-Review notes

- **Spec coverage:** preprocessMath/stripMathDelimiters + diagnostics (Task 2) ✓; shiki (Task 3) ✓; copy + collapse (Task 4) ✓; latex/mermaid fences (Task 5) ✓; highlighted code (Task 6) ✓; code dispatch (Task 7) ✓; live-markdown + memoisation (Task 8) ✓; MessageBlock integration + token-fade removal + security posture via no-rehype-raw (Task 9) ✓; build/lazy-chunks + manual verification (Task 10) ✓. Pills/reasoning untouched ✓. rehype pill plugins not ported ✓.
- **Type consistency:** `useHighlighter(): Highlighter | null` (Task 3) feeds `createMarkdownComponents(highlighter)` (Task 7) and `CodeBlock`'s `highlighter` prop (Task 6) — signatures aligned. `preprocessMath`/`stripMathDelimiters` names consistent across Tasks 2, 5, 8.
- **Deferred (Chris's styling pass):** all code-block / mermaid / KaTeX theming uses neutral functional utilities; shiki theme `github-dark-dimmed`, mermaid `dark` are placeholders.
```
