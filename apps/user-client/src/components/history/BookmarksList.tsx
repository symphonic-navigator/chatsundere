// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { type BookmarkGroup, useSetBookmarkLabel } from '../../data/bookmarks.js';
import { useToggleBookmark } from '../../data/chats.js';
import { displayTitle } from '../../lib/chat-title.js';
import { PersonaAvatar } from '../PersonaAvatar.js';
import { OverflowMenu } from '../ui/OverflowMenu.js';
import { HistoryRowRenameInput } from './HistoryRowRenameInput.js';

interface Props {
  groups: BookmarkGroup[];
  /** Navigate into a chat focused on a message. */
  onJump: (chatId: string, messageId: string) => void;
}

/** Global bookmarks, grouped by chat (most-recently-active first), in the
 *  design language: an avatar-led group header per chat, then `cs-row` entries
 *  with a visible remove-star and a `⋯`-housed rename. */
export function BookmarksList(p: Props): JSX.Element {
  const setLabel = useSetBookmarkLabel();
  const toggleBookmark = useToggleBookmark();
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-5">
      {p.groups.map((g) => (
        <section key={g.chat.id} className="flex flex-col gap-1.5">
          <header className="flex items-center gap-2 px-1">
            {g.persona ? (
              <PersonaAvatar
                personaId={g.persona.id}
                name={g.persona.name}
                colour={g.persona.colour}
                size={28}
              />
            ) : null}
            <h3
              className="truncate font-display text-sm"
              style={g.persona?.colour ? { color: g.persona.colour } : undefined}
            >
              {displayTitle(g.chat)}
            </h3>
          </header>

          {g.bookmarks.map((b) => (
            <div className="cs-row" key={b.message.id}>
              {editingId === b.message.id ? (
                <div className="cs-row-main" data-static>
                  <span className="cs-row-body">
                    <HistoryRowRenameInput
                      initialValue={b.label}
                      maxLength={80}
                      sanitise={false}
                      onCommit={(next) => {
                        setEditingId(null);
                        void setLabel.mutateAsync({ messageId: b.message.id, label: next });
                      }}
                      onCancel={() => setEditingId(null)}
                    />
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  className="cs-row-main"
                  onClick={() => p.onJump(g.chat.id, b.message.id)}
                >
                  <span className="cs-row-body">
                    <span className="cs-row-title" data-compact>
                      {b.label}
                    </span>
                  </span>
                </button>
              )}

              <span className="cs-row-trailing">
                <button
                  type="button"
                  className="treasury-row-star"
                  data-active
                  aria-label="Remove bookmark"
                  onClick={() => void toggleBookmark.mutateAsync(b.message.id)}
                >
                  <span aria-hidden>★</span>
                </button>
                <OverflowMenu
                  triggerLabel="Bookmark actions"
                  items={[{ label: 'Rename', onSelect: () => setEditingId(b.message.id) }]}
                />
              </span>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
