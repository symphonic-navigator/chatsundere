// SPDX-License-Identifier: AGPL-3.0-only
import { Bookmark } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';
import { useSetBookmarkLabel } from '../../../data/bookmarks.js';
import { useChat, useToggleBookmark } from '../../../data/chats.js';
import { type TocEntry, buildToc } from '../../../lib/toc.js';

/** Full-page view of this chat's bookmarks and table of contents. */
export function BookmarksPage(): JSX.Element {
  const { chatId = '' } = useParams();
  const { onHelp, helpOverlay } = useHelp('chat-bookmarks');
  const navigate = useNavigate();

  const { data } = useChat(chatId !== '' ? chatId : null);
  const toggleBookmark = useToggleBookmark();
  const setLabel = useSetBookmarkLabel();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const messages = data?.messages ?? [];
  const toc = buildToc(messages);

  function startRename(entry: TocEntry): void {
    setDraft(entry.isDefaultLabel ? '' : entry.label);
    setEditingId(entry.messageId);
  }

  function commitRename(messageId: string): void {
    const next = draft.trim();
    void setLabel.mutateAsync({ messageId, label: next === '' ? null : next });
    setEditingId(null);
  }

  /** Navigate to the chat view with the given message focused (PUSH). */
  function jump(messageId: string): void {
    navigate(`/app/chat/${chatId}?focus=${messageId}`);
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
          <span aria-hidden>&#x1F58E;</span>
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
    <PageScaffold
      crumbs={[{ label: 'Chat', to: `/app/chat/${chatId}` }, { label: 'Bookmarks' }]}
      back={`/app/chat/${chatId}`}
      onHelp={onHelp}
    >
      {helpOverlay}

      <div className="flex flex-col gap-6 px-4 pb-8 pt-4">
        <h1 className="flex items-center gap-2 text-lg font-medium text-paper">
          <Bookmark size={18} aria-hidden="true" />
          Bookmarks
        </h1>

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
      </div>
    </PageScaffold>
  );
}
