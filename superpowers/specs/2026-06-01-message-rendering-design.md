# Rich Message Rendering — Design

- **Date:** 2026-06-01
- **Author:** Liz (with Chris)
- **Status:** Approved (brainstorming) — pending implementation plan
- **Scope:** `apps/user-client` (frontend only — no Larissa gate)
- **Parity target:** `../chatsune/frontend` message renderer

## Problem

chatsundere renders assistant/user message text verbatim: `white-space: pre-wrap`,
one `<span>` per stream chunk carrying a `token-fade` animation. There is no
Markdown, no LaTeX/maths, no code highlighting. chatsune, by contrast, ships a
mature pipeline (Markdown + GFM + KaTeX maths + shiki highlighting + mermaid
diagrams) plus a substantial body of LaTeX *compatibility* transformations that
make real-world LLM output render correctly.

We want feature parity for the rendering surface, and in particular we must carry
over the LaTeX transformation work — it is the part that is hard-won and easy to
get wrong.

## Decision Summary

Two decisions were taken during brainstorming and are fixed:

1. **Live Markdown during streaming.** Markdown/LaTeX renders as tokens arrive
   (chatsune's model), re-parsing the active bubble per content delta. The
   existing per-token `fade-in` animation is **removed** — it is incompatible
   with DOM reflow from re-parsing — and replaced by the whole-bubble
   `message-entrance` animation.
2. **Full parity scope** in this round: GFM, KaTeX maths (incl. `preprocessMath`),
   shiki syntax highlighting (lazy), mermaid diagrams (lazy), `latex`/`tex` code
   fences, collapsible code (>15 lines), per-code-block copy button.

## Architectural Approach

### Pills stay separate — rehype pill plugins are NOT ported

chatsune embeds its pills (voice tags, integration markers) as **inline
placeholders inside the Markdown string** and resolves them with two bespoke
rehype plugins (`rehypeVoiceTags`, `rehypeIntegrationPills`), backed by a
`ResponseTagBuffer` / per-session Group registry / `messagePillContents` store.

chatsundere does not need any of this. Its content model is already a structured
array:

```ts
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'pill'; pillId: string }
  | { type: 'reasoning'; text: string };
```

Pills and reasoning are already first-class blocks rendered by dedicated
components (`Pill.tsx`, `ReasoningPill.tsx`). Therefore:

- We render Markdown **only over `text` groups**.
- `pill` and `reasoning` blocks remain untouched.
- `rehypeVoiceTags` and `rehypeIntegrationPills` are **not** ported, and neither
  is the `ResponseTagBuffer` / Group / `messagePillContents` machinery.

This is the cleaner architecture; porting chatsune's inline-tag approach would
regress chatsundere's superior data model.

### What we DO port (the value)

From `../chatsune/frontend/src/features/chat/`:

- **`preprocessMath()`** and **`stripMathDelimiters()`** from `markdownComponents.tsx`
  — verbatim logic, re-homed as pure functions. This is the LaTeX compatibility
  crown jewel:
  - `\( … \)` → `$ … $` (inline), with inner content trimmed (remark-math v6
    rejects inline maths bounded by whitespace — its anti-currency heuristic).
  - `\[ … \]` → `$$ … $$` (display); multi-line inner content emits a true block
    fence `\n\n$$\n<content>\n$$\n\n` (micromark-extension-math only treats `$$`
    as a display fence at line boundaries), single-line keeps compact `$$…$$`.
  - **Code masking:** fenced code blocks (``` ``` ```, `~~~`) and inline code
    spans are replaced with a NUL-sentinel placeholder before the maths
    substitutions run, then restored — so maths-like syntax typed inside code is
    never corrupted.
  - **`\\[Npt]` guard:** a negative look-behind on `\` prevents the `\[` rule
    from matching the `[` in a LaTeX line break with spacing (`\\[5pt]`).
- **shiki highlighter** singleton with lazy init (`createHighlighter`), `~18`
  languages, theme `github-dark-dimmed` (functional default — see Styling).
- **Code component dispatch**: `lang === 'mermaid'` → MermaidBlock;
  `lang === 'latex' | 'tex'` → LatexBlock (via `stripMathDelimiters` +
  `katex.renderToString({ displayMode: true, throwOnError: false })`);
  otherwise shiki highlight with an escaped-HTML fallback on shiki failure.
- **`CollapsibleCode`** (collapse threshold `COLLAPSE_LINE_THRESHOLD = 15`) and
  **`CopyButton`** (1500 ms "Copied" feedback).
- **mermaid** via lazy `import('mermaid')`, `theme: 'dark'`, rendering into
  `dangerouslySetInnerHTML` (mermaid sanitises its own output via DOMPurify);
  on render error, fall back to showing the raw code in a `<pre>`.

## Components & Files (new, under `apps/user-client/src`)

| File | Responsibility |
|---|---|
| `lib/markdown/preprocess-math.ts` | `preprocessMath()`, `stripMathDelimiters()` — pure, unit-tested |
| `lib/markdown/highlighter.ts` | shiki lazy singleton: `getHighlighter()`, `useHighlighter()` |
| `components/chat/markdown/MarkdownContent.tsx` | `ReactMarkdown` wrapper; applies `preprocessMath` to text; wires `remarkPlugins`/`rehypePlugins`/`components` |
| `components/chat/markdown/markdown-components.tsx` | `createMarkdownComponents(highlighter)` → `code` override dispatching to CodeBlock / MermaidBlock / LatexBlock |
| `components/chat/markdown/CodeBlock.tsx` | shiki highlight + `CopyButton` + `CollapsibleCode` |
| `components/chat/markdown/MermaidBlock.tsx` | lazy mermaid render |
| `components/chat/markdown/LatexBlock.tsx` | KaTeX display render |
| `components/chat/markdown/CopyButton.tsx`, `CollapsibleCode.tsx` | shared code-block chrome |

Plugin lists (mirroring chatsune, minus pill plugins):

```ts
remarkPlugins = [remarkGfm, remarkMath]
rehypePlugins = [[rehypeKatex, { throwOnError: false }]]
```

Naming follows existing conventions: components PascalCase, `lib/` modules
kebab-case (cf. `content-blocks.ts`, `persona-font.ts`).

## Integration into `MessageBlock.tsx`

`renderBlocks()` currently emits, for a `text` group, a `<span>` wrapping one
inner `<span>` per block (the `token-fade` carrier). Change:

- Concatenate the group's text blocks into a single string (Markdown needs the
  full text, not chunk fragments).
- Render `<MarkdownContent text={joined} />` instead of the nested spans.
- Drop the `token-fade` class from the text path. Remove the now-dead
  `.token-fade` CSS and its keyframes if nothing else uses them.
- The persona font continues to apply to **prose**; code blocks use the mono
  font (`--font-mono`), not the persona font. KaTeX uses its own font stack.

`reasoning` and `pill` group branches are unchanged.

## Streaming Behaviour

- The active streaming bubble renders the accumulated text live as Markdown,
  re-parsed on each content delta.
- **Performance:** wrap the message body in `React.memo` with a custom equality
  function modelled on chatsune's `AssistantMessage.areEqual` — compare `content`,
  streaming flag, persona, bookmark state, etc.; deliberately ignore inline
  callback props so historical bubbles do not re-run remark/rehype/shiki on every
  token of the active stream. Only the streaming bubble re-renders per delta.
- Incomplete Markdown mid-stream (unclosed fence, unclosed `$`) renders tolerantly
  via react-markdown; occasional flicker at block transitions is accepted (chatsune
  exhibits the same and it is not a problem in practice).

## Security Posture

- react-markdown@10 does **not** render raw HTML by default; we deliberately do
  **not** add `rehype-raw`. Malicious HTML/script in model or provider output is
  rendered as inert text. This is the primary XSS defence.
- `dangerouslySetInnerHTML` is used only for **library-generated** HTML:
  shiki (`codeToHtml`), KaTeX (`renderToString`), mermaid (self-sanitised via
  DOMPurify). No user/model-controlled string reaches it unescaped.
- Frontend-only change → no Larissa security gate required (per CLAUDE.md §9).

## Dependencies to add (`apps/user-client/package.json`)

Versions aligned with chatsune (verify latest-compatible at install time):

```
react-markdown ^10.1.0
remark-gfm     ^4.0.1
remark-math    ^6.0.0
rehype-katex   ^7.0.1
katex          ^0.16.45   (+ import 'katex/dist/katex.min.css')
shiki          ^4.0.2
mermaid        (lazy import; latest stable)
```

Bundle note: shiki and mermaid are lazy-loaded (dynamic import), so they do not
inflate the initial PWA bundle — they load on first code/diagram render.

## Testing (Vitest)

Port chatsune's LaTeX diagnostics as unit tests for the pure functions, under
`apps/user-client/tests/` (or the project's existing test location):

- `preprocessMath`:
  - `\(x\)` → `$x$`, `\( x \)` → `$x$` (whitespace trimmed)
  - `\[x\]` single-line → `$$x$$`
  - `\[ A\\B \]` multi-line inner → block fence with surrounding blank lines
  - maths-like text inside an inline code span / fenced block is left untouched
  - `\\[5pt]` is not rewritten to display maths
- `stripMathDelimiters`: each of `$$…$$`, `\[…\]`, `\(…\)`, `$…$` stripped to the
  bare expression; non-delimited input returned trimmed unchanged.

Visual rendering quality (KaTeX layout, shiki themes, mermaid diagrams, streaming
feel) is verified manually by Chris on-device per the Manual Verification section.

## Deferred — Chris's styling pass

Per "Mechanics first, styling later": code-block and KaTeX **theming** is left on
functional defaults (shiki `github-dark-dimmed`, mermaid `dark`). chatsune's
surface is dark (`#1a1528`); chatsundere reads lighter (`--color-paper #e8e6f5`).
Chris applies the opulent palette — code-surface background, KaTeX colour, glows —
as a separate pass once the mechanics land.

## Manual Verification (Chris, on-device)

1. Send/receive a message with **GFM**: a table, a task list, ~~strikethrough~~,
   nested lists — all render.
2. **Inline maths** `\(E=mc^2\)` and `$a^2+b^2$` render inline; **display maths**
   `\[ \int_0^1 x\,dx \]` and a multi-line `aligned`/matrix render as a block.
3. Maths-looking text inside a code span (`` `$x$` ``) renders **literally**, not
   as maths.
4. A fenced code block highlights (shiki), shows a working **Copy** button, and a
   >15-line block **collapses** with an "N lines — expand" control.
5. A ```` ```mermaid ```` block renders a diagram; a ```` ```latex ```` block
   renders display maths.
6. **Streaming:** formatting appears live as tokens arrive; no per-token flash;
   the bubble uses the entrance animation; historical messages do not visibly
   re-render while a new message streams.
7. Copying a whole message yields the raw Markdown text (unchanged behaviour).

## Out of Scope

- Porting `rehypeVoiceTags` / `rehypeIntegrationPills` / `ResponseTagBuffer` and
  the Group/`messagePillContents` machinery (chatsundere's pill architecture
  supersedes it).
- Final opulent theming (Chris's separate styling pass).
- Any change to the pill or reasoning rendering paths.
