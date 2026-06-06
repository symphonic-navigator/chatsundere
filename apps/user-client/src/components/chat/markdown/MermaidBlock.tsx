// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { SaveArtefactButton } from './SaveArtefactButton.js';
import { useArtefactSave } from './artefact-save-context.js';

let mermaidPromise: Promise<typeof import('mermaid')> | null = null;
let mermaidInitialised = false;
function loadMermaid(): Promise<typeof import('mermaid')> {
  if (!mermaidPromise) mermaidPromise = import('mermaid');
  return mermaidPromise;
}

/** Renders a ```mermaid fence as an SVG diagram via a lazily-imported mermaid.
 *  While the diagram is invalid — which includes every partial state during
 *  token streaming — the raw source is shown instead, never an error graphic.
 *  Theme is a functional default ('dark') — restyled in Chris's styling pass. */
export function MermaidBlock({ code }: { code: string }): JSX.Element {
  const [svg, setSvg] = useState<string | null>(null);
  const save = useArtefactSave();
  const saveOverlay = save ? (
    <div className="absolute right-2 top-2 z-10">
      <SaveArtefactButton onSave={() => save.saveCodeBlock({ content: code, lang: 'mermaid' })} />
    </div>
  ) : null;

  useEffect(() => {
    let cancelled = false;
    // A new (or growing, mid-stream) source invalidates any prior diagram.
    setSvg(null);
    loadMermaid().then(async (mod) => {
      if (cancelled) return;
      const mermaid = mod.default;
      if (!mermaidInitialised) {
        // suppressErrorRendering stops mermaid from injecting its own "bomb"
        // error SVG into the document on a parse failure (those nodes are not
        // cleaned up and would otherwise pile up — one per streamed token).
        mermaid.initialize({ startOnLoad: false, theme: 'dark', suppressErrorRendering: true });
        mermaidInitialised = true;
      }
      const id = `mermaid-inline-${Math.random().toString(36).slice(2)}`;
      try {
        // parse() with suppressErrors returns false (no throw, no DOM touch)
        // for invalid or still-incomplete input — the common case while a
        // fence streams in. Only a diagram that parses cleanly reaches
        // render(), so render() is never handed a broken source.
        const valid = await mermaid.parse(code, { suppressErrors: true });
        if (cancelled || !valid) return;
        const { svg: rendered } = await mermaid.render(id, code);
        if (!cancelled) setSvg(rendered);
      } catch {
        // Defensive: if render() still threw, drop any measurement node it left.
        document.getElementById(id)?.remove();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (!svg) {
    // No valid diagram (yet) — show the raw source. Covers both the
    // streaming-incomplete case and a genuinely malformed diagram, with no
    // alarming error box and nothing leaked into the DOM.
    return (
      <div className="relative">
        {saveOverlay}
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  // Mermaid render() output is sanitised via its built-in DOMPurify integration.
  return (
    <div className="relative">
      {saveOverlay}
      <div
        className="my-2 flex justify-center overflow-x-auto rounded-[12px] border border-white/10 bg-white/[0.03] p-4 [&_svg]:max-w-full"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid output is sanitised internally via DOMPurify
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}
