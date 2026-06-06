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
