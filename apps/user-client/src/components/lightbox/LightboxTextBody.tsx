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
