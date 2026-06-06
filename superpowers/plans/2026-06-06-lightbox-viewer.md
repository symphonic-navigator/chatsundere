# Lightbox Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the unified lightbox chatsune-grade rendering — standalone Code/HTML/SVG/Mermaid viewers, document-grade Aurora Markdown, a "how it works" chrome (format-override picker, copy, download), and a symmetric claude.ai-style close-zoom back to the origin.

**Architecture:** A text item's *preview format* is derived from its filename/MIME by a pure function; the lightbox body dispatches on that format to one small preview component each (reusing the existing `MarkdownContent`, `useHighlighter`, `MermaidBlock`). The open-zoom already exists; the close-zoom re-measures the origin thumb (resolved via a `data-attachment-thumb` attribute) and falls back to a downward zoom when it has scrolled away. Client-only; no auth/sync/proxy/crypto.

**Tech Stack:** React 18, TypeScript (strict), Vite, Vitest (tests under `apps/user-client/tests/`), shiki, mermaid, react-markdown, the existing `.lightbox-*` CSS in `index.css`.

**Working directory:** `apps/user-client`. Run tests with `pnpm vitest run <path>` from `apps/user-client`. Typecheck with `pnpm typecheck` from the repo root. All new files start with `// SPDX-License-Identifier: AGPL-3.0-only`. British English everywhere.

---

## Task 1: Format detection (pure)

**Files:**
- Create: `apps/user-client/src/components/lightbox/format-detect.ts`
- Test: `apps/user-client/tests/unit/format-detect.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  detectFormat,
  extensionToLang,
  formatToExtension,
  type PreviewFormat,
} from '../../src/components/lightbox/format-detect';

describe('detectFormat', () => {
  it('detects markdown by extension and mime', () => {
    expect(detectFormat('notes.md', '')).toBe<PreviewFormat>('markdown');
    expect(detectFormat('x', 'text/markdown')).toBe('markdown');
  });
  it('detects svg by extension and mime', () => {
    expect(detectFormat('logo.svg', '')).toBe('svg');
    expect(detectFormat('x', 'image/svg+xml')).toBe('svg');
  });
  it('detects html by extension and mime', () => {
    expect(detectFormat('page.HTML', '')).toBe('html');
    expect(detectFormat('x', 'text/html')).toBe('html');
  });
  it('detects mermaid by extension', () => {
    expect(detectFormat('flow.mmd', '')).toBe('mermaid');
    expect(detectFormat('flow.mermaid', '')).toBe('mermaid');
  });
  it('detects code by a known programming extension', () => {
    expect(detectFormat('app.ts', '')).toBe('code');
    expect(detectFormat('main.py', '')).toBe('code');
    expect(detectFormat('Component.tsx', '')).toBe('code');
  });
  it('falls back to plain for unknown/no extension', () => {
    expect(detectFormat('README', '')).toBe('plain');
    expect(detectFormat('data.txt', 'text/plain')).toBe('plain');
  });
});

describe('extensionToLang', () => {
  it('maps known extensions to shiki language ids', () => {
    expect(extensionToLang('app.ts')).toBe('typescript');
    expect(extensionToLang('Component.tsx')).toBe('tsx');
    expect(extensionToLang('main.py')).toBe('python');
    expect(extensionToLang('style.css')).toBe('css');
  });
  it('falls back to "text" for unknown extensions', () => {
    expect(extensionToLang('mystery.zzz')).toBe('text');
  });
});

describe('formatToExtension', () => {
  it('keeps the original filename extension when present', () => {
    expect(formatToExtension('app.ts', 'code')).toBe('app.ts');
  });
  it('appends a sensible extension when the name has none', () => {
    expect(formatToExtension('diagram', 'mermaid')).toBe('diagram.mmd');
    expect(formatToExtension('doc', 'markdown')).toBe('doc.md');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/format-detect.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// SPDX-License-Identifier: AGPL-3.0-only

/** The renderer a text attachment is shown with in the lightbox. */
export type PreviewFormat = 'markdown' | 'code' | 'html' | 'svg' | 'mermaid' | 'plain';

function ext(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** Extension → shiki language id. Mirrors the langs loaded in highlighter.ts. */
const LANG_BY_EXT: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  css: 'css',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  sql: 'sql',
  xml: 'xml',
  html: 'html',
  log: 'text',
};

const CODE_EXTS = new Set(Object.keys(LANG_BY_EXT));

/** Decide which preview renderer a text attachment uses, from its filename + MIME.
 *  Extension wins; MIME is the tiebreaker for the structural formats. */
export function detectFormat(fileName: string, mime: string): PreviewFormat {
  const e = ext(fileName);
  if (e === 'md' || e === 'markdown' || mime === 'text/markdown') return 'markdown';
  if (e === 'svg' || mime === 'image/svg+xml') return 'svg';
  if (e === 'html' || e === 'htm' || mime === 'text/html') return 'html';
  if (e === 'mmd' || e === 'mermaid') return 'mermaid';
  if (CODE_EXTS.has(e)) return 'code';
  return 'plain';
}

/** Extension → shiki language id, defaulting to 'text'. */
export function extensionToLang(fileName: string): string {
  return LANG_BY_EXT[ext(fileName)] ?? 'text';
}

const DEFAULT_EXT: Record<PreviewFormat, string> = {
  markdown: 'md',
  code: 'txt',
  html: 'html',
  svg: 'svg',
  mermaid: 'mmd',
  plain: 'txt',
};

/** A download filename: keep the existing extension, else append a format default. */
export function formatToExtension(fileName: string, format: PreviewFormat): string {
  return ext(fileName) ? fileName : `${fileName}.${DEFAULT_EXT[format]}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/format-detect.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/lightbox/format-detect.ts apps/user-client/tests/unit/format-detect.test.ts
git commit -m "Add lightbox preview-format detection"
```

---

## Task 2: Accept SVG and Mermaid uploads

**Files:**
- Modify: `apps/user-client/src/attachments/file-classify.ts` (the `TEXT_EXTENSIONS` set, lines 10-39)
- Modify: `apps/user-client/src/components/chat/Cockpit.tsx:221` (the picker `accept`)
- Test: `apps/user-client/tests/unit/file-classify.test.ts` (create if absent; otherwise add cases)

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { classifyFile } from '../../src/attachments/file-classify';

function file(name: string, type: string): File {
  return new File(['<svg/>'], name, { type });
}

describe('classifyFile — svg & mermaid', () => {
  it('accepts an .svg as text (XML), even with the image/svg+xml mime', () => {
    expect(classifyFile(file('logo.svg', 'image/svg+xml'))).toEqual({ ok: true, kind: 'text' });
    expect(classifyFile(file('logo.svg', ''))).toEqual({ ok: true, kind: 'text' });
  });
  it('accepts .mmd and .mermaid as text', () => {
    expect(classifyFile(file('flow.mmd', ''))).toEqual({ ok: true, kind: 'text' });
    expect(classifyFile(file('flow.mermaid', ''))).toEqual({ ok: true, kind: 'text' });
  });
  it('still rejects an unsupported binary type', () => {
    const r = classifyFile(file('a.bin', 'application/octet-stream'));
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/file-classify.test.ts`
Expected: FAIL — `.svg` currently returns `{ ok: false }`.

- [ ] **Step 3: Implement**

In `file-classify.ts`, add three entries to the `TEXT_EXTENSIONS` set (after `'log',`):

```ts
  'log',
  'svg',
  'mmd',
  'mermaid',
```

(The existing 4th `isText` clause `TEXT_EXTENSIONS.has(extension(file.name))` then catches `.svg` even when `file.type === 'image/svg+xml'`, because `IMAGE_MIMES` does not contain `image/svg+xml`.)

In `Cockpit.tsx:221`, extend the `accept` attribute:

```tsx
        accept="image/png,image/jpeg,image/webp,image/gif,text/*,.md,.json,.csv,.ts,.tsx,.js,.py,.svg,.mmd,.mermaid,.html,.css"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/file-classify.test.ts tests/unit/attachments-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/attachments/file-classify.ts apps/user-client/src/components/chat/Cockpit.tsx apps/user-client/tests/unit/file-classify.test.ts
git commit -m "Accept SVG and Mermaid file uploads as text"
```

---

## Task 3: Standalone preview components

**Files:**
- Create: `apps/user-client/src/components/lightbox/previews/CodePreview.tsx`
- Create: `apps/user-client/src/components/lightbox/previews/SvgPreview.tsx`
- Create: `apps/user-client/src/components/lightbox/previews/HtmlPreview.tsx`
- Create: `apps/user-client/src/components/lightbox/previews/MermaidPreview.tsx`
- Create: `apps/user-client/src/components/lightbox/previews/MarkdownDoc.tsx`
- Test: `apps/user-client/tests/unit/lightbox-previews.test.tsx`

These are standalone (props are plain strings); they do not depend on `ViewableItem`.

- [ ] **Step 1: Write the failing test**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HtmlPreview } from '../../src/components/lightbox/previews/HtmlPreview';
import { SvgPreview } from '../../src/components/lightbox/previews/SvgPreview';
import { MarkdownDoc } from '../../src/components/lightbox/previews/MarkdownDoc';

describe('SvgPreview', () => {
  it('renders the svg as a base64 data-uri image (no script execution path)', () => {
    const { container } = render(<SvgPreview content={'<svg xmlns="http://www.w3.org/2000/svg"/>'} />);
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toMatch(/^data:image\/svg\+xml;base64,/);
  });
});

describe('HtmlPreview', () => {
  it('renders a sandboxed iframe that cannot reach same-origin storage', () => {
    const { container } = render(<HtmlPreview content={'<p>hi</p>'} />);
    const iframe = container.querySelector('iframe');
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe?.getAttribute('sandbox')).not.toContain('allow-same-origin');
    // CSP that blocks all network is injected into the srcDoc.
    expect(iframe?.getAttribute('srcdoc')).toContain("default-src 'none'");
  });
});

describe('MarkdownDoc', () => {
  it('renders markdown inside the document-grade container', () => {
    const { container } = render(<MarkdownDoc content={'# Title'} />);
    expect(container.querySelector('.lightbox-doc')).not.toBeNull();
    expect(container.querySelector('h1')?.textContent).toBe('Title');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/lightbox-previews.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the five components**

`SvgPreview.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

/** UTF-8-safe base64 (btoa alone mangles multi-byte characters). */
function utf8ToBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Renders an SVG file as a centred image via a data: URI. Rendering an SVG in
 *  an <img> does not execute any scripts it may contain — safe by construction. */
export function SvgPreview({ content }: { content: string }): JSX.Element {
  const src = `data:image/svg+xml;base64,${utf8ToBase64(content)}`;
  return (
    <div className="lightbox-svg">
      <img src={src} alt="SVG preview" />
    </div>
  );
}
```

`HtmlPreview.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

// Blocks ALL external network (no phone-home / IP-leak / tracking from previewed
// HTML); allows only inline style/script and data: images/fonts.
const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:;">`;
const SCROLLBAR = `<style>*::-webkit-scrollbar{width:8px;height:8px}*::-webkit-scrollbar-thumb{background:rgba(141,109,255,.3);border-radius:4px}*{scrollbar-width:thin;scrollbar-color:rgba(141,109,255,.3) transparent}</style>`;
// Bridge Escape inside the iframe out to the lightbox.
const ESCAPE = `<script>window.addEventListener('keydown',function(e){if(e.key==='Escape')window.parent.postMessage({type:'lightbox-escape'},'*')})</script>`;

/** Renders an HTML file in a hard-sandboxed iframe: `allow-scripts` WITHOUT
 *  `allow-same-origin`, so it runs at a null origin and cannot read cookies,
 *  localStorage or IndexedDB (where the MasterKey / ciphertext live). A strict
 *  CSP blocks every external request. */
export function HtmlPreview({ content }: { content: string }): JSX.Element {
  const head = `${CSP}${SCROLLBAR}${ESCAPE}`;
  const srcDoc = content.includes('</head>')
    ? content.replace('</head>', `${head}</head>`)
    : `${head}${content}`;
  return (
    <iframe className="lightbox-html" srcDoc={srcDoc} sandbox="allow-scripts" title="HTML preview" />
  );
}
```

`MermaidPreview.tsx` (reuse the existing chat `MermaidBlock`, which lazy-loads mermaid, parses defensively, and shows the raw source on failure):

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { MermaidBlock } from '../../chat/markdown/MermaidBlock';

/** Renders a whole file as one Mermaid diagram, reusing the chat MermaidBlock. */
export function MermaidPreview({ content }: { content: string }): JSX.Element {
  return (
    <div className="lightbox-mermaid">
      <MermaidBlock code={content} />
    </div>
  );
}
```

`CodePreview.tsx` — render the whole code file with shiki and inject the resulting
HTML string into a `<div className="lightbox-code">`. Use the **exact same injection
one-liner and `biome-ignore` comment as the existing `CodeBlock.tsx` (lines 36-39)** —
that pattern is already reviewed and safe because shiki output is library-generated,
not user HTML. Unlike `CodeBlock`, do NOT wrap in the copy/collapse chrome — a
dedicated viewer shows the whole file and scrolls; the toolbar Copy button handles
copying. Skeleton (fill the injection from `CodeBlock.tsx`):

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useHighlighter } from '../../../lib/markdown/highlighter';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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
  // Return: <div className="lightbox-code"> with `html` injected as inner HTML,
  // using the identical one-line pattern + biome-ignore from CodeBlock.tsx:36-39.
  return /* see CodeBlock.tsx for the injection line */ null as unknown as JSX.Element;
}
```

(The implementer replaces the final `return` with the real `<div className="lightbox-code">` carrying the injected `html`, copied verbatim from `CodeBlock.tsx`.)

`MarkdownDoc.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { MarkdownContent } from '../../chat/markdown/MarkdownContent';

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/lightbox-previews.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/lightbox/previews/ apps/user-client/tests/unit/lightbox-previews.test.tsx
git commit -m "Add standalone lightbox preview components (code/html/svg/mermaid/markdown-doc)"
```

---

## Task 4: Format-override dropdown

**Files:**
- Create: `apps/user-client/src/components/lightbox/FormatPicker.tsx`
- Test: `apps/user-client/tests/unit/format-picker.test.tsx`

Modelled exactly on `components/history/PersonaFilterDropdown.tsx` (button trigger + chevron + absolute list of option buttons; closes on outside-pointerdown / Escape).

- [ ] **Step 1: Write the failing test**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FormatPicker } from '../../src/components/lightbox/FormatPicker';

describe('FormatPicker', () => {
  it('shows the current format and offers the alternatives', () => {
    render(<FormatPicker value="code" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /format/i }).textContent).toMatch(/code/i);
    fireEvent.click(screen.getByRole('button', { name: /format/i }));
    expect(screen.getByText('Markdown')).toBeTruthy();
  });
  it('calls onChange with the picked format and closes', () => {
    const onChange = vi.fn();
    render(<FormatPicker value="plain" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /format/i }));
    fireEvent.click(screen.getByText('HTML'));
    expect(onChange).toHaveBeenCalledWith('html');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/format-picker.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react';
import type { PreviewFormat } from './format-detect';

const LABELS: Record<PreviewFormat, string> = {
  markdown: 'Markdown',
  code: 'Code',
  html: 'HTML',
  svg: 'SVG',
  mermaid: 'Mermaid',
  plain: 'Plain text',
};
const ORDER: PreviewFormat[] = ['markdown', 'code', 'html', 'svg', 'mermaid', 'plain'];

/** Custom dropdown to override the auto-detected preview format. A native
 *  <select> cannot be themed to the dark surface, so the list is hand-built —
 *  same structure as PersonaFilterDropdown. */
export function FormatPicker({
  value,
  onChange,
}: {
  value: PreviewFormat;
  onChange: (next: PreviewFormat) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onOutside = (e: Event): void => {
      const t = e.target as Node | null;
      if (t && rootRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  function pick(f: PreviewFormat): void {
    onChange(f);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="lb-fmt">
      <button
        type="button"
        aria-label="Format"
        aria-haspopup="true"
        aria-expanded={open}
        className="lb-fmt-trigger"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="lb-fmt-value">{LABELS[value]}</span>
        <span className="lb-fmt-chevron" data-open={open || undefined} aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div className="lb-fmt-list">
          {ORDER.map((f) => (
            <button
              key={f}
              type="button"
              className="lb-fmt-option"
              data-selected={value === f || undefined}
              onClick={() => pick(f)}
            >
              {LABELS[f]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

Note: the Escape handler calls `e.stopPropagation()` so closing the dropdown does not also close the lightbox.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/format-picker.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/lightbox/FormatPicker.tsx apps/user-client/tests/unit/format-picker.test.tsx
git commit -m "Add lightbox format-override dropdown"
```

---

## Task 5: Copy & download actions

**Files:**
- Create: `apps/user-client/src/components/lightbox/lightbox-actions.ts`
- Test: `apps/user-client/tests/unit/lightbox-actions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { copyText, downloadText } from '../../src/components/lightbox/lightbox-actions';

describe('copyText', () => {
  it('writes the text to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await copyText('hello');
    expect(writeText).toHaveBeenCalledWith('hello');
    vi.unstubAllGlobals();
  });
});

describe('downloadText', () => {
  it('creates and clicks an anchor with the right download name, then revokes', () => {
    const click = vi.fn();
    const createEl = vi.spyOn(document, 'createElement');
    const createUrl = vi.fn().mockReturnValue('blob:x');
    const revokeUrl = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: createUrl, revokeObjectURL: revokeUrl });
    createEl.mockImplementation((tag: string) => {
      const el = Object.assign(document.createElementNS('http://www.w3.org/1999/xhtml', tag), {
        click,
      });
      return el as HTMLElement;
    });

    downloadText('print("hi")', 'app.py');

    const anchor = createEl.mock.results[0].value as HTMLAnchorElement;
    expect(anchor.getAttribute('download')).toBe('app.py');
    expect(click).toHaveBeenCalled();
    expect(revokeUrl).toHaveBeenCalledWith('blob:x');
    createEl.mockRestore();
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/lightbox-actions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// SPDX-License-Identifier: AGPL-3.0-only

/** Copy raw text content to the clipboard. */
export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

/** Download text content as a file with the given filename. */
export function downloadText(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/lightbox-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/lightbox/lightbox-actions.ts apps/user-client/tests/unit/lightbox-actions.test.ts
git commit -m "Add lightbox copy & download helpers"
```

---

## Task 6: Aurora document styling + viewer/dropdown CSS

**Files:**
- Modify: `apps/user-client/src/index.css` (append a new block after the existing `.lightbox-source:focus` rule at line ~2444)

This is a styling task (no unit test — verified by typecheck/build and Chris's device pass).

- [ ] **Step 1: Append the CSS**

Add after line 2444 (`.lightbox-source:focus { ... }`):

```css
/* ===== Document-grade Markdown for the lightbox (MarkdownDoc) =====
   Mirrors .msg-text but with generous, document-grade spacing and its own
   code-surface rule (there is no .msg-text ancestor here). Aurora palette. */
.lightbox-doc {
  padding: 0 1rem 1.25rem;
  color: var(--color-paper);
  font-size: 0.95rem;
  line-height: 1.7;
  word-wrap: break-word;
}
.lightbox-doc > :first-child {
  margin-top: 0;
}
.lightbox-doc p {
  margin: 0.75em 0;
}
.lightbox-doc ul,
.lightbox-doc ol {
  margin: 0.75em 0;
  padding-left: 1.6em;
}
.lightbox-doc ul {
  list-style-type: disc;
}
.lightbox-doc ol {
  list-style-type: decimal;
}
.lightbox-doc li {
  margin: 0.25em 0;
}
.lightbox-doc h1,
.lightbox-doc h2,
.lightbox-doc h3,
.lightbox-doc h4,
.lightbox-doc h5,
.lightbox-doc h6 {
  font-family: var(--font-display);
  font-weight: 600;
  line-height: 1.25;
  margin: 1.4em 0 0.5em;
}
.lightbox-doc h1 {
  font-size: 1.6em;
}
.lightbox-doc h2 {
  font-size: 1.35em;
}
.lightbox-doc h3 {
  font-size: 1.15em;
}
.lightbox-doc h4 {
  font-size: 1.02em;
}
.lightbox-doc code:not(pre code) {
  background: rgba(255, 255, 255, 0.06);
  border-radius: 6px;
  padding: 0.1em 0.35em;
  font-family: var(--font-mono);
  font-size: 0.9em;
}
.lightbox-doc pre {
  margin: 1em 0;
  padding: 0.9em 1.05em;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: var(--color-ink-soft) !important;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.06), 0 8px 24px -16px rgba(141, 109, 255, 0.4);
  overflow-x: auto;
}
.lightbox-doc pre code {
  background: none;
  font-family: var(--font-mono);
  font-size: 0.84rem;
}
.lightbox-doc blockquote {
  border-left: 3px solid color-mix(in srgb, var(--color-aurora-500) 55%, transparent);
  padding-left: 1em;
  margin: 1em 0 1em 0;
  opacity: 0.85;
}
.lightbox-doc hr {
  border: none;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  margin: 1.4em 0;
}
.lightbox-doc table {
  border-collapse: collapse;
  margin: 1em 0;
  font-size: 0.9em;
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.lightbox-doc th,
.lightbox-doc td {
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 0.4em 0.7em;
}
.lightbox-doc th {
  background: rgba(255, 255, 255, 0.05);
  font-weight: 600;
}
.lightbox-doc a {
  color: var(--color-aurora-500);
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, var(--color-aurora-500) 35%, transparent);
  text-underline-offset: 2px;
}
.lightbox-doc a:hover {
  text-decoration-color: var(--color-aurora-500);
}
.lightbox-doc .katex-display {
  margin: 0.8em 0;
  padding: 0.25em 0;
  overflow-x: auto;
  overflow-y: hidden;
}

/* ===== Standalone viewers ===== */
.lightbox-code {
  align-self: stretch;
  width: 100%;
  padding: 0 1rem 1rem;
  font-size: 0.84rem;
  overflow: auto;
}
.lightbox-code pre {
  margin: 0;
  padding: 0.9em 1.05em;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: var(--color-ink-soft) !important;
  overflow-x: auto;
  font-family: var(--font-mono);
}
.lightbox-svg,
.lightbox-mermaid {
  align-self: stretch;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}
.lightbox-svg img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.lightbox-html {
  align-self: stretch;
  flex: 1;
  width: 100%;
  border: none;
  border-radius: 8px;
  background: #fff;
}

/* ===== Format-override dropdown (FormatPicker) — Aurora-tinted ===== */
.lb-fmt {
  position: relative;
}
.lb-fmt-trigger {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  border-radius: 8px;
  border: 1px solid rgba(141, 109, 255, 0.35);
  background: rgba(0, 0, 0, 0.3);
  padding: 3px 9px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-paper);
  cursor: pointer;
  white-space: nowrap;
}
.lb-fmt-trigger:hover {
  background: rgba(141, 109, 255, 0.1);
}
.lb-fmt-chevron {
  opacity: 0.55;
  transition: transform 160ms ease;
}
.lb-fmt-chevron[data-open] {
  transform: rotate(180deg);
}
.lb-fmt-list {
  position: absolute;
  z-index: 20;
  top: calc(100% + 0.3rem);
  right: 0;
  min-width: 9rem;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.3rem;
  border-radius: 0.5rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: var(--color-ink, #161616);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.5);
}
.lb-fmt-option {
  text-align: left;
  width: 100%;
  padding: 0.4rem 0.55rem;
  border-radius: 0.375rem;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-paper);
  cursor: pointer;
  transition: background 120ms ease;
}
.lb-fmt-option:hover {
  background: rgba(255, 255, 255, 0.06);
}
.lb-fmt-option[data-selected] {
  background: color-mix(in srgb, var(--color-aurora-500) 22%, transparent);
  color: var(--color-aurora-200);
}
```

- [ ] **Step 2: Verify typecheck/build is unaffected**

Run (from repo root): `pnpm typecheck`
Expected: 14/14 successful.

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/index.css
git commit -m "Add Aurora document & viewer styling for the lightbox"
```

---

## Task 7: ViewableItem format dispatch in the body

**Files:**
- Modify: `apps/user-client/src/components/lightbox/viewable-item.ts`
- Modify: `apps/user-client/src/components/lightbox/LightboxTextBody.tsx` (the format dispatch + Preview/Source)
- Modify: `apps/user-client/src/components/lightbox/Lightbox.tsx` (compute `format`, pass it to the body)
- Test: `apps/user-client/tests/unit/viewable-item.test.ts` (update), `apps/user-client/tests/unit/lightbox-body.test.tsx` (create)

This task changes `ViewableItem` (drop the eager `'markdown'` kind, add `mime` + `caps.copy`) and the body together so the tree stays green.

- [ ] **Step 1: Update `viewable-item.ts`**

Replace the `Caps` interface, the `ViewableItem` interface, and `attachmentToViewable` (drop `isMarkdown`/`MARKDOWN_EXTENSIONS`):

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { AttachmentRow } from '../../boot/client-data-db.js';

/** Per-item capability descriptor — drives which action buttons the lightbox renders. */
export interface Caps {
  /** Always true — every attachment can be renamed by the user. */
  rename: boolean;
  /** True only for upload-origin items that are still pending (not yet sent). */
  remove: boolean;
  /** True for text items — copy the raw content to the clipboard. */
  copy: boolean;
  /** True for text items — download the content as a file. */
  download: boolean;
  /** True for generated-origin items (Phase 2+; always false in v1). */
  delete: boolean;
  /** True for text items that are still pending — allows editing the source. */
  editSource: boolean;
}

/** Presentation item consumed by the lightbox — storage-agnostic. */
export interface ViewableItem {
  id: string;
  /** 'image' → `<img>`; 'text' → the format is derived from fileName/mime. */
  kind: 'image' | 'text';
  fileName: string;
  /** MIME type — used for preview-format detection and download. */
  mime: string;
  /** Blob object URL — only present for image items. Caller revokes. */
  imageUrl?: string;
  /** Text content — only present for text items. */
  text?: string;
  caps: Caps;
}

/**
 * Map a stored `AttachmentRow` to a `ViewableItem` + capability descriptor.
 * The preview format for text items is derived later (format-detect.ts) from
 * `fileName`/`mime`; this layer only carries the raw data + capabilities.
 */
export function attachmentToViewable(
  row: AttachmentRow,
  opts: { pending: boolean; objectUrl?: string },
): ViewableItem {
  const isText = row.kind === 'text';
  return {
    id: row.id,
    kind: row.kind,
    fileName: row.fileName,
    mime: row.mime,
    imageUrl: row.kind === 'image' ? opts.objectUrl : undefined,
    text: isText ? row.text : undefined,
    caps: {
      rename: true,
      remove: row.origin === 'upload' && opts.pending,
      copy: isText,
      download: isText,
      delete: row.origin === 'generated',
      editSource: isText && opts.pending,
    },
  };
}
```

- [ ] **Step 2: Update `viewable-item.test.ts`**

Adjust expectations: a `.md` upload now has `kind: 'text'` (not `'markdown'`); assert `mime` is carried and `caps.copy`/`caps.download` are `true` for text, `false` for image. Replace the markdown-kind assertions with:

```ts
it('maps a text row to kind "text" carrying mime, with copy/download caps', () => {
  const row = makeRow({ kind: 'text', fileName: 'notes.md', mime: 'text/markdown', text: '# Hi' });
  const v = attachmentToViewable(row, { pending: true });
  expect(v.kind).toBe('text');
  expect(v.mime).toBe('text/markdown');
  expect(v.caps.copy).toBe(true);
  expect(v.caps.download).toBe(true);
  expect(v.caps.editSource).toBe(true);
});

it('maps an image row with copy/download disabled', () => {
  const row = makeRow({ kind: 'image', fileName: 'p.jpg', mime: 'image/jpeg' });
  const v = attachmentToViewable(row, { pending: false, objectUrl: 'blob:x' });
  expect(v.kind).toBe('image');
  expect(v.caps.copy).toBe(false);
  expect(v.caps.download).toBe(false);
});
```

(Use the file's existing `makeRow` helper / row factory; keep its other passing cases. If a helper does not exist, build a minimal `AttachmentRow` literal inline with the required fields: `id, chatId, messageId, origin, kind, fileName, mime, order, state, createdAt`.)

- [ ] **Step 3: Rewrite `LightboxTextBody.tsx` as a format dispatch**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import type { PreviewFormat } from './format-detect';
import { extensionToLang } from './format-detect';
import { CodePreview } from './previews/CodePreview';
import { HtmlPreview } from './previews/HtmlPreview';
import { MarkdownDoc } from './previews/MarkdownDoc';
import { MermaidPreview } from './previews/MermaidPreview';
import { SvgPreview } from './previews/SvgPreview';
import type { ViewableItem } from './viewable-item';

function Preview({ item, format }: { item: ViewableItem; format: PreviewFormat }): JSX.Element {
  const text = item.text ?? '';
  switch (format) {
    case 'markdown':
      return <MarkdownDoc content={text} />;
    case 'code':
      return <CodePreview content={text} lang={extensionToLang(item.fileName)} />;
    case 'html':
      return <HtmlPreview content={text} />;
    case 'svg':
      return <SvgPreview content={text} />;
    case 'mermaid':
      return <MermaidPreview content={text} />;
    default:
      return <pre className="lightbox-plain">{text}</pre>;
  }
}

/**
 * Body for text lightbox items: a Preview/Source toggle. Preview dispatches on
 * the (possibly user-overridden) format; Source is the raw text, editable only
 * when caps.editSource is true.
 */
export function LightboxTextBody({
  item,
  format,
  onEditText,
}: {
  item: ViewableItem;
  format: PreviewFormat;
  onEditText: (id: string, text: string) => void;
}): JSX.Element {
  const [view, setView] = useState<'preview' | 'source'>('preview');
  const [draft, setDraft] = useState(item.text ?? '');

  return (
    <div className="lightbox-text">
      <div className="lightbox-seg" role="tablist">
        <button
          type="button"
          className={view === 'preview' ? 'on' : ''}
          onClick={() => setView('preview')}
        >
          Preview
        </button>
        <button
          type="button"
          className={view === 'source' ? 'on' : ''}
          onClick={() => setView('source')}
        >
          Source
        </button>
      </div>
      {view === 'preview' ? (
        <Preview item={{ ...item, text: draft }} format={format} />
      ) : (
        <textarea
          className="lightbox-source"
          value={draft}
          readOnly={!item.caps.editSource}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => item.caps.editSource && draft !== item.text && onEditText(item.id, draft)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Update `Lightbox.tsx` to compute + pass the format**

Add the import and compute the format for the current item; pass it to the body. (Full chrome wiring is Task 8 — here we keep `originRect` as-is.)

At the top of `Lightbox.tsx` add:

```tsx
import { detectFormat } from './format-detect';
```

Replace the body branch (lines ~156-161) with:

```tsx
        <div className="lightbox-body">
          {item.kind === 'image' ? (
            <img className="lightbox-img" src={item.imageUrl} alt={item.fileName} />
          ) : (
            <LightboxTextBody
              item={item}
              format={detectFormat(item.fileName, item.mime)}
              onEditText={p.onEditText}
            />
          )}
```

- [ ] **Step 5: Create `tests/unit/lightbox-body.test.tsx`**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LightboxTextBody } from '../../src/components/lightbox/LightboxTextBody';
import type { ViewableItem } from '../../src/components/lightbox/viewable-item';

function item(over: Partial<ViewableItem>): ViewableItem {
  return {
    id: '1',
    kind: 'text',
    fileName: 'x',
    mime: '',
    text: '',
    caps: { rename: true, remove: false, copy: true, download: true, delete: false, editSource: false },
    ...over,
  };
}

describe('LightboxTextBody dispatch', () => {
  it('renders markdown as a document', () => {
    const { container } = render(
      <LightboxTextBody item={item({ text: '# Hi', fileName: 'a.md' })} format="markdown" onEditText={() => {}} />,
    );
    expect(container.querySelector('.lightbox-doc h1')?.textContent).toBe('Hi');
  });
  it('renders svg as an image', () => {
    const { container } = render(
      <LightboxTextBody item={item({ text: '<svg/>', fileName: 'a.svg' })} format="svg" onEditText={() => {}} />,
    );
    expect(container.querySelector('.lightbox-svg img')).not.toBeNull();
  });
  it('renders html in a sandboxed iframe', () => {
    const { container } = render(
      <LightboxTextBody item={item({ text: '<p>x</p>', fileName: 'a.html' })} format="html" onEditText={() => {}} />,
    );
    expect(container.querySelector('iframe.lightbox-html')?.getAttribute('sandbox')).toBe('allow-scripts');
  });
});
```

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm vitest run tests/unit/viewable-item.test.ts tests/unit/lightbox-body.test.tsx tests/unit/lightbox.test.tsx`
Then (repo root): `pnpm typecheck`
Expected: all PASS; typecheck 14/14.

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/components/lightbox/viewable-item.ts apps/user-client/src/components/lightbox/LightboxTextBody.tsx apps/user-client/src/components/lightbox/Lightbox.tsx apps/user-client/tests/unit/viewable-item.test.ts apps/user-client/tests/unit/lightbox-body.test.tsx
git commit -m "Dispatch lightbox text body by detected preview format"
```

---

## Task 8: Lightbox chrome — format picker, copy, download

**Files:**
- Modify: `apps/user-client/src/components/lightbox/Lightbox.tsx`
- Test: `apps/user-client/tests/unit/lightbox.test.tsx` (add cases)

- [ ] **Step 1: Add override state + chrome wiring to `Lightbox.tsx`**

Add imports:

```tsx
import { FormatPicker } from './FormatPicker';
import { detectFormat, formatToExtension, type PreviewFormat } from './format-detect';
import { copyText, downloadText } from './lightbox-actions';
```

Add per-item override state (reset whenever the current item changes), and compute the effective format:

```tsx
  const [override, setOverride] = useState<PreviewFormat | null>(null);
  const [copied, setCopied] = useState(false);

  // Reset the format override + copied flash when the viewed item changes.
  useEffect(() => {
    setOverride(null);
    setCopied(false);
  }, [item?.id]);
```

Compute the effective format just before the return (after the `if (!item) return null;` guard):

```tsx
  const format: PreviewFormat =
    item.kind === 'text' ? (override ?? detectFormat(item.fileName, item.mime)) : 'plain';
```

In the toolbar, replace the existing static `Download` button block (the `item.caps.download && (...)` at lines ~133-137) with the picker + copy + download cluster:

```tsx
          {item.kind === 'text' && (
            <FormatPicker value={format} onChange={(f) => setOverride(f)} />
          )}
          {item.caps.copy && (
            <button
              type="button"
              className="lightbox-btn"
              onClick={() => {
                void copyText(item.text ?? '');
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
          {item.caps.download && (
            <button
              type="button"
              className="lightbox-btn"
              onClick={() => downloadText(item.text ?? '', formatToExtension(item.fileName, format))}
            >
              Download
            </button>
          )}
```

Pass the computed `format` to the body (replace the `detectFormat(...)` call added in Task 7 with the `format` variable):

```tsx
            <LightboxTextBody item={item} format={format} onEditText={p.onEditText} />
```

- [ ] **Step 2: Add chrome tests to `lightbox.test.tsx`**

```tsx
it('copies the raw content and flashes Copied', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  const items = [textItem({ text: 'print(1)', fileName: 'a.py' })];
  render(<Lightbox items={items} index={0} {...noopHandlers} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
  expect(writeText).toHaveBeenCalledWith('print(1)');
  vi.unstubAllGlobals();
});

it('overriding the format switches the rendered preview', () => {
  const items = [textItem({ text: '# H', fileName: 'note.txt' })]; // detects as plain
  const { container } = render(<Lightbox items={items} index={0} {...noopHandlers} />);
  expect(container.querySelector('.lightbox-plain')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /format/i }));
  fireEvent.click(screen.getByText('Markdown'));
  expect(container.querySelector('.lightbox-doc h1')?.textContent).toBe('H');
});
```

(Reuse / add a `textItem(...)` factory and a `noopHandlers` object in the test file mirroring the existing `lightbox.test.tsx` setup. `textItem` must set `kind:'text'`, a `mime`, and `caps` with `copy/download` true.)

- [ ] **Step 3: Run tests + typecheck**

Run: `pnpm vitest run tests/unit/lightbox.test.tsx`
Then (repo root): `pnpm typecheck`
Expected: PASS; 14/14.

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/components/lightbox/Lightbox.tsx apps/user-client/tests/unit/lightbox.test.tsx
git commit -m "Add lightbox chrome: format picker, copy, download"
```

---

## Task 9: Symmetric close-zoom with re-measure + downward fallback

**Files:**
- Modify: `apps/user-client/src/components/chat/AttachmentThumb.tsx` (add `data-attachment-thumb`; drop the rect from `onOpen`)
- Modify: `apps/user-client/src/components/chat/AttachmentStrip.tsx` (`onOpen(index)` only)
- Modify: `apps/user-client/src/components/chat/MessageBlock.tsx` (pass `getOriginRect`)
- Modify: `apps/user-client/src/components/chat/Cockpit.tsx` (pass `getOriginRect`)
- Modify: `apps/user-client/src/components/lightbox/Lightbox.tsx` (`getOriginRect` prop, open from it, close state machine, iframe Escape bridge)
- Test: `apps/user-client/tests/unit/lightbox-close.test.tsx` (create); update `attachment-strip.test.tsx`, `lightbox.test.tsx` for the new props.

- [ ] **Step 1: `AttachmentThumb.tsx` — data attribute + index-only onOpen**

Change the prop type and the click handler:

```tsx
export function AttachmentThumb({
  row,
  onOpen,
}: {
  row: AttachmentRow;
  onOpen: () => void;
}): JSX.Element {
```

```tsx
    <button
      type="button"
      className="attach-thumb"
      data-kind={row.kind}
      data-attachment-thumb={row.id}
      onClick={() => onOpen()}
      title={row.fileName}
    >
```

- [ ] **Step 2: `AttachmentStrip.tsx` — index-only onOpen**

```tsx
export function AttachmentStrip({
  attachments,
  onOpen,
}: {
  attachments: AttachmentRow[];
  onOpen: (index: number) => void;
}): JSX.Element | null {
  if (attachments.length === 0) return null;
  return (
    <div className="attach-strip">
      {attachments.map((row, i) => (
        <AttachmentThumb key={row.id} row={row} onOpen={() => onOpen(i)} />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: `Lightbox.tsx` — new prop, open from `getOriginRect`, close machine**

Replace the `originRect?: DOMRect` prop with:

```tsx
  /** Resolve the live rect of the origin thumbnail for item `id`, for the FLIP
   *  open/close zoom. Returns null when the origin is gone (scrolled away/detached).
   *  Implemented by the caller via `[data-attachment-thumb="<id>"]`. */
  getOriginRect?: (id: string) => DOMRect | null;
```

Add a closing guard ref near the other refs:

```tsx
  const closingRef = useRef(false);
```

Add the FLIP helpers + `requestClose` above the return (after `next`). Note: define `requestClose` and also store it in a ref so the keydown/message effects can call the latest version without re-subscribing:

```tsx
  const DURATION = 220;

  function reducedMotion(): boolean {
    return (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  function rectVisible(r: DOMRect | null): r is DOMRect {
    return (
      !!r &&
      r.width > 0 &&
      r.height > 0 &&
      r.bottom > 0 &&
      r.right > 0 &&
      r.top < window.innerHeight &&
      r.left < window.innerWidth
    );
  }

  // Map the surface el onto `target` (top-left origin) — the END state for close.
  function transformOnto(el: HTMLDivElement, target: DOMRect): void {
    const from = el.getBoundingClientRect();
    if (from.width === 0 || from.height === 0) return;
    const sx = target.width / from.width;
    const sy = target.height / from.height;
    const dx = target.left - from.left;
    const dy = target.top - from.top;
    el.style.transformOrigin = 'top left';
    el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    el.style.opacity = '0';
  }

  function requestClose(): void {
    if (closingRef.current) return;
    closingRef.current = true;
    const el = surfaceRef.current;
    if (!el || reducedMotion()) {
      p.onClose();
      return;
    }
    const live = p.getOriginRect?.(item.id) ?? null;
    // Visible → zoom back to the thumb; otherwise zoom downward off-screen.
    const target: DOMRect = rectVisible(live)
      ? live
      : ({
          left: window.innerWidth / 2 - 30,
          top: window.innerHeight + 40,
          width: 60,
          height: 60,
        } as DOMRect);
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      p.onClose();
    };
    el.addEventListener('transitionend', finish, { once: true });
    window.setTimeout(finish, DURATION + 60);
    requestAnimationFrame(() => {
      el.style.transition = `transform ${DURATION}ms ease, opacity ${DURATION}ms ease`;
      transformOnto(el, target);
    });
  }

  const closeRef = useRef(requestClose);
  closeRef.current = requestClose;
```

Change the open FLIP effect to read from `getOriginRect` once on mount (replace the `[p.originRect]` effect):

```tsx
  // FLIP open: map the surface onto the origin thumb, then animate to identity.
  // Runs once on mount; guards: reduced motion / missing or zero-size origin.
  // biome-ignore lint/correctness/useExhaustiveDependencies: open zoom is a mount-only effect
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el || reducedMotion()) return;
    const origin = p.getOriginRect?.(p.items[p.index]?.id ?? '') ?? null;
    if (!origin || origin.width === 0 || origin.height === 0) return;
    const to = el.getBoundingClientRect();
    if (to.width === 0 || to.height === 0) return;
    const sx = origin.width / to.width;
    const sy = origin.height / to.height;
    el.style.transformOrigin = 'top left';
    el.style.transform = `translate(${origin.left - to.left}px, ${origin.top - to.top}px) scale(${sx}, ${sy})`;
    el.style.opacity = '0.6';
    requestAnimationFrame(() => {
      el.style.transition = 'transform 220ms ease, opacity 220ms ease';
      el.style.transform = 'none';
      el.style.opacity = '1';
    });
  }, []);
```

In the keydown effect, change `if (e.key === 'Escape') p.onClose();` to `if (e.key === 'Escape') closeRef.current();`. Add a message-listener effect for the iframe Escape bridge:

```tsx
  // Bridge Escape from inside the HTML-preview iframe.
  useEffect(() => {
    const onMsg = (e: MessageEvent): void => {
      if (e.data?.type === 'lightbox-escape') closeRef.current();
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
```

Change the backdrop `onClick={p.onClose}` → `onClick={requestClose}` and the × `onClick={p.onClose}` → `onClick={requestClose}`.

- [ ] **Step 4: `MessageBlock.tsx` & `Cockpit.tsx` — pass `getOriginRect`, drop `originRect`**

In both files: remove the `originRect` state and the `setOriginRect` in `onOpen`; change `onOpen` to take only the index; add the `getOriginRect` prop on `<Lightbox>`.

`MessageBlock.tsx` (lines ~59-60, ~178-200): delete `const [originRect, setOriginRect] = useState<DOMRect | undefined>(undefined);`. Then:

```tsx
        <AttachmentStrip
          attachments={activeAttachments}
          onOpen={(i) => setLightboxIndex(i)}
        />
```

```tsx
      {isUser && lightboxIndex !== null && (
        <Lightbox
          items={lightboxItems}
          index={lightboxIndex}
          getOriginRect={(id) =>
            document
              .querySelector<HTMLElement>(`[data-attachment-thumb="${CSS.escape(id)}"]`)
              ?.getBoundingClientRect() ?? null
          }
          onRename={handleRename}
          onRemove={() => {}}
          onEditText={() => {}}
          onClose={() => setLightboxIndex(null)}
        />
      )}
```

`Cockpit.tsx` (lines ~98-99, ~319-359): delete the `originRect` state; then:

```tsx
      <AttachmentStrip attachments={pending} onOpen={(i) => setLightboxIndex(i)} />
```

```tsx
      {lightboxIndex !== null && (
        <Lightbox
          items={items}
          index={lightboxIndex}
          getOriginRect={(id) =>
            document
              .querySelector<HTMLElement>(`[data-attachment-thumb="${CSS.escape(id)}"]`)
              ?.getBoundingClientRect() ?? null
          }
          onRename={(id, name) => rename.mutate({ id, fileName: name })}
          onRemove={(id) => remove.mutate(id)}
          onEditText={(id, text) => editText.mutate({ id, text })}
          onClose={() => setLightboxIndex(null)}
        />
      )}
```

- [ ] **Step 5: Create `tests/unit/lightbox-close.test.tsx`**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Lightbox } from '../../src/components/lightbox/Lightbox';
import type { ViewableItem } from '../../src/components/lightbox/viewable-item';

const img: ViewableItem = {
  id: 'a',
  kind: 'image',
  fileName: 'p.jpg',
  mime: 'image/jpeg',
  imageUrl: 'blob:x',
  caps: { rename: true, remove: false, copy: false, download: false, delete: false, editSource: false },
};
const handlers = { onRename: () => {}, onRemove: () => {}, onEditText: () => {} };

describe('Lightbox close', () => {
  it('closes (calls onClose) on the × button', () => {
    const onClose = vi.fn();
    render(<Lightbox items={[img]} index={0} {...handlers} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
  it('consults getOriginRect for the current item on close', () => {
    const getOriginRect = vi.fn().mockReturnValue(null);
    const onClose = vi.fn();
    render(
      <Lightbox items={[img]} index={0} getOriginRect={getOriginRect} {...handlers} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

Note on jsdom: `window.matchMedia` is typically undefined in the test env; `reducedMotion()` then returns false, and `surfaceRef.getBoundingClientRect()` returns zeros so `transformOnto` no-ops, while the `setTimeout(finish)` still fires `onClose`. If the runner needs it, wrap the click in `vi.useFakeTimers()` + `vi.runAllTimers()`; otherwise the timeout resolves. Keep the assertion to "onClose was called".

- [ ] **Step 6: Update prop-shape in existing tests**

In `attachment-strip.test.tsx`, change the `onOpen` mock expectation to receive a single index argument (no rect). In `lightbox.test.tsx` / `lightbox-body` factories, ensure no test still passes `originRect`. Run the touched suites.

- [ ] **Step 7: Run tests + typecheck**

Run: `pnpm vitest run tests/unit/lightbox-close.test.tsx tests/unit/lightbox.test.tsx tests/unit/attachment-strip.test.tsx tests/unit/cockpit-attachments.test.tsx tests/unit/message-block-attachments.test.tsx`
Then (repo root): `pnpm typecheck`
Expected: PASS; 14/14.

- [ ] **Step 8: Commit**

```bash
git add apps/user-client/src/components/chat/AttachmentThumb.tsx apps/user-client/src/components/chat/AttachmentStrip.tsx apps/user-client/src/components/chat/MessageBlock.tsx apps/user-client/src/components/chat/Cockpit.tsx apps/user-client/src/components/lightbox/Lightbox.tsx apps/user-client/tests/unit/lightbox-close.test.tsx apps/user-client/tests/unit/attachment-strip.test.tsx
git commit -m "Add symmetric close-zoom with origin re-measure and downward fallback"
```

---

## Task 10: Security & follow-up notes

**Files:**
- Modify: `obsidian/insights/security-deferrals.md` (append)
- Modify: `obsidian/insights/follow-ups-index.md` (append)

Doc-only — use `[skip ci]`.

- [ ] **Step 1: Append to `security-deferrals.md`**

Add a dated entry recording the new client-side surfaces introduced by the lightbox viewer:
- HTML preview runs untrusted file content in an iframe with `sandbox="allow-scripts"` and **no** `allow-same-origin` (null origin → no access to cookies/localStorage/IndexedDB, where the MasterKey and ciphertext live), plus a strict CSP (`default-src 'none'`) that blocks all external network requests (no IP-leak/tracking). SVG renders via a `data:` URI `<img>` (no script execution). No auth/sync/proxy/crypto touched — not a Larissa gate.

- [ ] **Step 2: Append to `follow-ups-index.md`**

Add the JSX/SPA reminder (Chris's explicit ask): the JSX / React single-page-app preview belongs to the artefact-generation work and is core functionality for many users (build a concept, demo it, try it). It must use a **locally-bundled** transpiler (sucrase or esbuild-wasm, lazy-loaded) + React from our own deps inlined into a hard-sandboxed iframe — never a third-party CDN (the chatsune `unpkg` approach was rejected on zero-knowledge grounds).

- [ ] **Step 3: Commit**

```bash
git add obsidian/insights/security-deferrals.md obsidian/insights/follow-ups-index.md
git commit -m "Log lightbox viewer surfaces + JSX/SPA artefact follow-up [skip ci]"
```

---

## Task 11: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Typecheck**

Run (repo root): `pnpm typecheck`
Expected: 14/14 successful.

- [ ] **Step 2: Build**

Run (repo root): `pnpm run build`
Expected: 9/9 successful; shiki/mermaid remain lazy chunks.

- [ ] **Step 3: Full user-client vitest**

Run (from `apps/user-client`): `pnpm vitest run`
Expected: all green **except** the known pre-existing `cockpit-draft`/`chat-page`/`chat-route` localStorage-jsdom baseline failures (confirm the count matches `master` — do NOT count those as regressions). Every new/modified lightbox/attachment test passes.

- [ ] **Step 4: Biome**

Run (repo root): `pnpm biome check apps/user-client/src` (or the project's lint script).
Expected: clean on all touched files.

- [ ] **Step 5: Report**

Summarise the measured results (typecheck N/N, build N/N, vitest pass/fail with the baseline noted, biome). Do not claim success without the command output. Hand back to Liz for the STATUS update, squash, and Chris's device test.

---

## Self-Review

**Spec coverage:**
- §3 format dispatch → Task 1 (detect) + Task 7 (dispatch). ✓
- §3 ViewableItem/Caps changes (mime, copy, drop markdown kind, caps for uploads) → Task 7. ✓
- §4 viewers (markdown-doc/code/html/svg/mermaid/plain) → Task 3 + Task 7. ✓
- §5 chrome (picker/copy/download) → Task 4, Task 5, Task 8. ✓
- §6 custom dropdown → Task 4. ✓
- §7 Aurora doc styling → Task 6. ✓
- §8 security (sandbox/CSP/svg-img/escape bridge) → Task 3 (HtmlPreview/SvgPreview) + Task 9 (escape bridge) + Task 10 (log). ✓
- §9 close animation (getOriginRect, re-measure, downward fallback) → Task 9. ✓
- §10 upload classify (.svg/.mmd/.mermaid) → Task 2. ✓
- §11 JSX/SPA reminder → Task 10. ✓
- §13 testing + manual verification → Tasks 1-9 unit tests + Task 11 full verification; manual steps stay in the spec for Chris. ✓

**Placeholder scan:** Task 3's `CodePreview` deliberately defers one injection line to the existing `CodeBlock.tsx` pattern (a security-hook constraint on the planning tool, not a vague placeholder — the exact source line is named). Everything else shows complete code. ✓

**Type consistency:** `PreviewFormat` is defined once (Task 1) and imported everywhere. `Caps` gains `copy` (Task 7) and is constructed consistently in `attachmentToViewable` and in test factories. `LightboxTextBody` signature `(item, format, onEditText)` matches its call in `Lightbox.tsx`. `getOriginRect: (id: string) => DOMRect | null` matches both call sites and the prop. `onOpen` is `(index: number) => void` in `AttachmentStrip` and `() => void` in `AttachmentThumb` consistently. ✓
