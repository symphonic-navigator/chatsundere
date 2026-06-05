// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { type BookmarkGroup, useSetBookmarkLabel } from '../../data/bookmarks.js';
import { useToggleBookmark } from '../../data/chats.js';
import { displayTitle } from '../../lib/chat-title.js';

interface Props {
  groups: BookmarkGroup[];
  /** Navigate into a chat focused on a message. */
  onJump: (chatId: string, messageId: string) => void;
}

/** Global bookmarks, grouped by chat (most-recently-active first). Each entry
 *  can be renamed inline or removed (un-starred) in place. */
export function BookmarksList(p: Props): JSX.Element {
  const setLabel = useSetBookmarkLabel();
  const toggleBookmark = useToggleBookmark();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  // Escape sets this so the unmount-triggered blur does not re-commit.
  const [discarding, setDiscarding] = useState(false);

  function startRename(messageId: string, label: string): void {
    setDiscarding(false);
    setDraft(label);
    setEditingId(messageId);
  }
  function commitRename(messageId: string): void {
    if (discarding) {
      setEditingId(null);
      return;
    }
    const next = draft.trim();
    void setLabel.mutateAsync({ messageId, label: next === '' ? null : next });
    setEditingId(null);
  }

  if (p.groups.length === 0) {
    return (
      <div className="mt-8 grid place-items-center text-center text-paper-soft">
        <p className="font-display text-lg italic text-paper">No bookmarks yet.</p>
        <p className="mt-2 max-w-xs text-sm">Star a message in any chat to find it here.</p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-4">
      {p.groups.map((g) => (
        <li key={g.chat.id} className="bookmark-group">
          <h3
            className="bookmark-group-title"
            style={g.persona?.colour ? { color: g.persona.colour } : undefined}
          >
            {displayTitle(g.chat)}
          </h3>
          <ul className="bookmark-group-list">
            {g.bookmarks.map((b) => (
              <li key={b.message.id} className="bookmark-entry">
                {editingId === b.message.id ? (
                  <input
                    className="toc-entry-input"
                    // biome-ignore lint/a11y/noAutofocus: inline rename — focus is the intent
                    autoFocus
                    value={draft}
                    maxLength={80}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(b.message.id);
                      else if (e.key === 'Escape') setDiscarding(true);
                    }}
                    onBlur={() => commitRename(b.message.id)}
                  />
                ) : (
                  <button
                    type="button"
                    className="bookmark-row"
                    data-role={b.message.role}
                    onClick={() => p.onJump(g.chat.id, b.message.id)}
                  >
                    {b.label}
                  </button>
                )}
                <div className="toc-entry-actions">
                  <button
                    type="button"
                    className="toc-entry-rename"
                    aria-label="Rename bookmark"
                    onClick={() => startRename(b.message.id, b.label)}
                  >
                    <span aria-hidden>🖎</span>
                  </button>
                  <button
                    type="button"
                    className="toc-entry-star"
                    data-active
                    aria-label="Remove bookmark"
                    onClick={() => void toggleBookmark.mutateAsync(b.message.id)}
                  >
                    <span aria-hidden>★</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
