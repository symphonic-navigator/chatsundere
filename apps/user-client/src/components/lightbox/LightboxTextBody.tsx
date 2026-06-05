// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { MarkdownContent } from '../chat/markdown/MarkdownContent';
import type { ViewableItem } from './viewable-item';

/**
 * Preview/Source toggle body for text and markdown lightbox items.
 * Preview renders markdown via MarkdownContent (memoised); Source is a
 * monospace textarea that is read-only unless caps.editSource is true.
 * Edits are persisted via onEditText on blur.
 */
export function LightboxTextBody({
  item,
  onEditText,
}: {
  item: ViewableItem;
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
        item.kind === 'markdown' ? (
          <div className="lightbox-md">
            <MarkdownContent text={draft} />
          </div>
        ) : (
          <pre className="lightbox-plain">{draft}</pre>
        )
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
