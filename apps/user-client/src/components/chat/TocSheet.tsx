// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import type { MessageRow } from '../../boot/client-data-db.js';
import { useSetBookmarkLabel } from '../../data/bookmarks.js';
import { useToggleBookmark } from '../../data/chats.js';
import { type TocEntry, buildToc } from '../../lib/toc.js';

interface Props {
  messages: MessageRow[];
  onClose: () => void;
  /** Jump to a message — caller closes the sheet, drops to Reading Mode, scrolls. */
  onJump: (messageId: string) => void;
}

/** Per-chat bookmarks & table-of-contents overlay. */
export function TocSheet(p: Props): JSX.Element {
  const toc = buildToc(p.messages);
  const toggleBookmark = useToggleBookmark();
  const setLabel = useSetBookmarkLabel();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  function startRename(entry: TocEntry): void {
    setDraft(entry.isDefaultLabel ? '' : entry.label);
    setEditingId(entry.messageId);
  }
  function commitRename(messageId: string): void {
    const next = draft.trim();
    void setLabel.mutateAsync({ messageId, label: next === '' ? null : next });
    setEditingId(null);
  }

  function jump(messageId: string): void {
    p.onJump(messageId);
    p.onClose();
  }

  const renderEntry = (entry: TocEntry): JSX.Element => (
    <li
      key={`${entry.messageId}-${entry.role}`}
      className="toc-entry"
      data-starred={entry.starred || undefined}
    >
      {editingId === entry.messageId ? (
        <input
          className="toc-entry-input"
          // biome-ignore lint/a11y/noAutofocus: inline rename — focus is the intent
          autoFocus
          value={draft}
          maxLength={80}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename(entry.messageId);
            else if (e.key === 'Escape') setEditingId(null);
          }}
          onBlur={() => commitRename(entry.messageId)}
        />
      ) : (
        <button type="button" className="toc-entry-label" onClick={() => jump(entry.messageId)}>
          {entry.label}
        </button>
      )}
      <div className="toc-entry-actions">
        <button
          type="button"
          className="toc-entry-rename"
          aria-label="Rename bookmark"
          onClick={() => startRename(entry)}
        >
          <span aria-hidden>🖎</span>
        </button>
        <button
          type="button"
          className="toc-entry-star"
          aria-label={entry.starred ? 'Remove bookmark' : 'Add bookmark'}
          data-active={entry.starred || undefined}
          onClick={() => void toggleBookmark.mutateAsync(entry.messageId)}
        >
          <span aria-hidden>{entry.starred ? '★' : '☆'}</span>
        </button>
      </div>
    </li>
  );

  return (
    <div className="toc-sheet-root">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop is a dismiss surface; the × button is the keyboard path */}
      <div className="toc-backdrop" data-testid="toc-backdrop" onClick={p.onClose} />
      <aside className="toc-sheet" aria-label="Bookmarks and contents">
        <header className="toc-sheet-header">
          <span className="toc-sheet-title">Bookmarks &amp; contents</span>
          <button type="button" className="toc-sheet-close" aria-label="Close" onClick={p.onClose}>
            <span aria-hidden>×</span>
          </button>
        </header>

        {toc.pinned.length > 0 ? (
          <section className="toc-section toc-pinned">
            <h3 className="toc-section-title">Pinned</h3>
            <ul className="toc-list">{toc.pinned.map(renderEntry)}</ul>
          </section>
        ) : null}

        <section className="toc-section toc-timeline">
          <h3 className="toc-section-title">In this chat</h3>
          {toc.timeline.length > 0 ? (
            <ul className="toc-list">{toc.timeline.map(renderEntry)}</ul>
          ) : (
            <p className="toc-empty">Your messages will appear here as you chat.</p>
          )}
        </section>
      </aside>
    </div>
  );
}
